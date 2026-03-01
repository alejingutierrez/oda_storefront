import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG } from "@/lib/catalog-cache";
import { HOME_CONFIG_DEFAULTS } from "@/lib/home-types";
import type {
  BrandLogo,
  CategoryHighlight,
  ColorCombo,
  HomeCoverageStats,
  HomeConfigMap,
  HomeHeroSlide,
  HomePriceDropCardData,
  HomeTrendingDailyCardData,
  MegaMenuData,
  MenuCategory,
  ProductCard,
  StyleGroup,
} from "@/lib/home-types";
import {
  CATEGORY_GROUPS,
  GenderKey,
  buildCategoryHref,
  labelize,
} from "@/lib/navigation";
import { buildEffectiveVariantPriceCopExpr } from "@/lib/catalog-query";
import { CATALOG_MAX_VALID_PRICE } from "@/lib/catalog-price";
import {
  getDisplayRoundingUnitCop,
  getFxRatesToCop,
  getPricingConfig,
  getSupportedCurrencies,
} from "@/lib/pricing";
import { shouldApplyMarketingRounding, toDisplayedCop } from "@/lib/price-display";

export type {
  BrandLogo,
  CategoryHighlight,
  ColorCombo,
  HomeCoverageStats,
  HomeHeroSlide,
  HomePriceDropCardData,
  HomeTrendingDailyCardData,
  HomeProductCardData,
  HomeConfigMap,
  MegaMenuData,
  MenuCategory,
  MenuSubcategory,
  ProductCard,
  StyleGroup,
} from "@/lib/home-types";
export { HOME_CONFIG_DEFAULTS } from "@/lib/home-types";

export function getHomeConfigValue(config: HomeConfigMap, key: string): string {
  return config[key] ?? HOME_CONFIG_DEFAULTS[key] ?? "";
}

export function getHomeConfigInt(config: HomeConfigMap, key: string): number {
  const raw = config[key] ?? HOME_CONFIG_DEFAULTS[key];
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : parseInt(HOME_CONFIG_DEFAULTS[key] ?? "0", 10);
}

export const getHomeConfig = unstable_cache(
  async (): Promise<HomeConfigMap> => {
    try {
      const rows = await prisma.homeConfig.findMany();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch (error) {
      if (!isMissingTableError(error, "home_config")) throw error;
      console.warn("home.config.table_missing_fallback", { table: "home_config" });
      return { ...HOME_CONFIG_DEFAULTS };
    }
  },
  ["home-config"],
  { revalidate: 60 * 60, tags: ["home-config"] },
);

const HOME_REVALIDATE_SECONDS = 60 * 60;
// Bump to invalidate `unstable_cache` entries when the home queries/semantics change.
const HOME_CACHE_VERSION = 11;
const HOME_SECTION_TIMEOUT_MS = 12_000;
const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;
const HOME_STYLE_PRODUCTS_LIMIT = 6;
const HOME_HERO_IMAGE_POOL_LIMIT = 8;

type HomePricingContext = {
  pricing: {
    fxRatesToCop: Record<string, number>;
    supportedCurrencies: string[];
  };
  displayUnitCop: number;
};

type HomeResilientSectionCandidate<T> = {
  source: string;
  fetch: () => Promise<T[]>;
  minItems?: number;
  timeoutMs?: number;
};

export function getRotationSeed(now = new Date()): number {
  return Math.floor(now.getTime() / THREE_DAYS_MS);
}

function toFiniteNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCopDisplayString(input: {
  value: string | number | null | undefined;
  unitCop: number;
  sourceCurrency: string | null | undefined;
  brandOverrideUsd: boolean;
}) {
  const numeric = toFiniteNumber(input.value);
  const applyMarketingRounding = shouldApplyMarketingRounding({
    brandOverride: input.brandOverrideUsd,
    sourceCurrency: input.sourceCurrency,
  });
  const displayed = toDisplayedCop({
    effectiveCop: numeric,
    applyMarketingRounding,
    unitCop: input.unitCop,
  });
  return displayed ? String(displayed) : null;
}

function sqlExcludeProductIds(ids: string[]) {
  if (!ids.length) return Prisma.empty;
  return Prisma.sql`and p.id not in (${Prisma.join(ids)})`;
}

function sqlIsActiveCatalogProduct() {
  return Prisma.sql`
    p."imageCoverUrl" is not null
    and p."hasInStock" = true
    and b."isActive" = true
    and (p.status is null or lower(p.status) <> 'archived')
  `;
}

function sqlHomeCategoryCase() {
  return Prisma.sql`
    case
      when p.category='tops' and p.subcategory='camisetas' then 'camisetas_y_tops'
      when p.category='tops' and p.subcategory in ('blusas','camisas') then 'camisas_y_blusas'
      when p.category='bottoms' and p.subcategory='jeans' then 'jeans_y_denim'
      when p.category='bottoms' and p.subcategory='pantalones' then 'pantalones_no_denim'
      when p.category='bottoms' and p.subcategory='faldas' then 'faldas'
      when p.category='bottoms' and p.subcategory='shorts' then 'shorts_y_bermudas'
      when p.category='outerwear' and p.subcategory='blazers' then 'blazers_y_sastreria'
      when p.category='outerwear' and p.subcategory='buzos' then 'buzos_hoodies_y_sueteres'
      when p.category='outerwear' and p.subcategory in ('chaquetas','abrigos') then 'chaquetas_y_abrigos'
      when p.category='knitwear' then 'buzos_hoodies_y_sueteres'
      when p.category in ('ropa_interior','ropa interior') then 'ropa_interior_basica'
      when p.category='trajes_de_bano' then 'trajes_de_bano_y_playa'
      when p.category='deportivo' then 'ropa_deportiva_y_performance'
      when p.category='enterizos' then 'enterizos_y_overoles'
      when p.category='accesorios' and p.subcategory='bolsos' then 'bolsos_y_marroquineria'
      else p.category
    end
  `;
}

export type HomeSelectionRegistry = {
  usedIds: Set<string>;
};

export type HomeResilientSectionResult<T> = {
  items: T[];
  source: string;
  degraded: boolean;
  durationMs: number;
};

export function createHomeSelectionRegistry(initialIds: string[] = []): HomeSelectionRegistry {
  return {
    usedIds: new Set(initialIds.filter(Boolean)),
  };
}

export function collectUniqueProducts<T extends { id: string }>(
  products: T[],
  registry: HomeSelectionRegistry,
  limit = products.length,
): T[] {
  const next: T[] = [];
  for (const product of products) {
    if (!product?.id || registry.usedIds.has(product.id)) continue;
    registry.usedIds.add(product.id);
    next.push(product);
    if (next.length >= limit) break;
  }
  return next;
}

async function getHomePricingContext(): Promise<HomePricingContext> {
  const cached = unstable_cache(
    async () => {
      const pricingConfig = await getPricingConfig();
      return {
        pricing: {
          fxRatesToCop: getFxRatesToCop(pricingConfig),
          supportedCurrencies: getSupportedCurrencies(pricingConfig),
        },
        displayUnitCop: getDisplayRoundingUnitCop(pricingConfig),
      };
    },
    [`home-v${HOME_CACHE_VERSION}-pricing`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`HOME_SECTION_TIMEOUT:${label}`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function executeResilientSection<T>(
  section: string,
  candidates: HomeResilientSectionCandidate<T>[],
  timeoutMs = HOME_SECTION_TIMEOUT_MS,
): Promise<HomeResilientSectionResult<T>> {
  const startedAt = Date.now();
  let lastError: string | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateTimeout = candidate.timeoutMs ?? timeoutMs;
    try {
      const items = await runWithTimeout(candidate.fetch(), candidateTimeout, `${section}:${candidate.source}`);
      const minItems = candidate.minItems ?? 1;
      if (items.length >= minItems || index === candidates.length - 1) {
        return {
          items,
          source: candidate.source,
          degraded: index > 0,
          durationMs: Date.now() - startedAt,
        };
      }
      lastError = `LOW_COUNT:${items.length}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  console.error("home.resilient_section.failed", {
    section,
    lastError,
    durationMs: Date.now() - startedAt,
  });

  return {
    items: [],
    source: "empty",
    degraded: true,
    durationMs: Date.now() - startedAt,
  };
}

export async function getMegaMenuData(): Promise<MegaMenuData> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{
          gender_bucket: GenderKey;
          category: string;
          subcategory: string | null;
          cnt: bigint;
        }>
      >(
        Prisma.sql`
          with bucketed as (
            select
              case
                when lower(gender) in ('femenino','mujer') then 'Femenino'
                when lower(gender) in ('masculino','hombre','male') then 'Masculino'
                when lower(gender) in ('infantil','nino') then 'Infantil'
                when lower(gender) in ('no_binario_unisex','unisex','unknown','') then 'Unisex'
                when gender is null then 'Unisex'
                else 'Unisex'
              end as gender_bucket,
              case
                when p.category='tops' and p.subcategory='camisetas' then 'camisetas_y_tops'
                when p.category='tops' and p.subcategory in ('blusas','camisas') then 'camisas_y_blusas'
                when p.category='bottoms' and p.subcategory='jeans' then 'jeans_y_denim'
                when p.category='bottoms' and p.subcategory='pantalones' then 'pantalones_no_denim'
                when p.category='bottoms' and p.subcategory='faldas' then 'faldas'
                when p.category='bottoms' and p.subcategory='shorts' then 'shorts_y_bermudas'
                when p.category='outerwear' and p.subcategory='blazers' then 'blazers_y_sastreria'
                when p.category='outerwear' and p.subcategory='buzos' then 'buzos_hoodies_y_sueteres'
                when p.category='outerwear' and p.subcategory in ('chaquetas','abrigos') then 'chaquetas_y_abrigos'
                when p.category='knitwear' then 'buzos_hoodies_y_sueteres'
                when p.category in ('ropa_interior','ropa interior') then 'ropa_interior_basica'
                when p.category='trajes_de_bano' then 'trajes_de_bano_y_playa'
                when p.category='deportivo' then 'ropa_deportiva_y_performance'
                when p.category='enterizos' then 'enterizos_y_overoles'
                when p.category='accesorios' and p.subcategory='bolsos' then 'bolsos_y_marroquineria'
                else p.category
              end as category,
              p.subcategory as subcategory
            from products p
            where p.category is not null and p.category <> ''
              and p."imageCoverUrl" is not null
              and (p."metadata" -> 'enrichment') is not null
              and p."hasInStock" = true
          )
          select gender_bucket, category, subcategory, count(*) as cnt
          from bucketed
          group by 1,2,3
          order by gender_bucket, cnt desc
        `
      );

      const byGender = new Map<GenderKey, Map<string, { count: number; sub: Map<string, number> }>>();

      for (const row of rows) {
        const gender = row.gender_bucket;
        const category = row.category;
        const subcategory = row.subcategory ?? "";
        const count = Number(row.cnt);
        if (!byGender.has(gender)) {
          byGender.set(gender, new Map());
        }
        const catMap = byGender.get(gender)!;
        if (!catMap.has(category)) {
          catMap.set(category, { count: 0, sub: new Map() });
        }
        const entry = catMap.get(category)!;
        entry.count += count;
        if (subcategory) {
          entry.sub.set(subcategory, (entry.sub.get(subcategory) ?? 0) + count);
        }
      }

      const genders: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];
      const result = {} as MegaMenuData;

      for (const gender of genders) {
        const catMap = byGender.get(gender) ?? new Map();
        const buildColumn = (
          column: "Superiores" | "Completos" | "Inferiores" | "Accesorios" | "Lifestyle"
        ): MenuCategory[] => {
          const categories = CATEGORY_GROUPS[column];
          const items: MenuCategory[] = [];

          for (const category of categories) {
            const entry = catMap.get(category);
            if (!entry || entry.count <= 0) {
              continue;
            }

            items.push({
              key: category,
              label: labelize(category),
              count: entry.count,
              href: buildCategoryHref(gender, category),
            });
          }

          return items;
        };

        result[gender] = {
          Superiores: buildColumn("Superiores"),
          Completos:  buildColumn("Completos"),
          Inferiores: buildColumn("Inferiores"),
          Accesorios: buildColumn("Accesorios"),
          Lifestyle:  buildColumn("Lifestyle"),
        };
      }

      return result;
    },
    [`home-v${HOME_CACHE_VERSION}-mega-menu`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getHeroProduct(seed: number): Promise<ProductCard | null> {
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricingContext.pricing);
      const rows = await prisma.$queryRaw<
        Array<ProductCard & { sourceCurrency: string | null; brandOverrideUsd: boolean }>
      >(
        Prisma.sql`
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p.category,
            p.subcategory,
            p."sourceUrl",
            (
              select min(case when ${priceCopExpr} > 0 and ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} then ${priceCopExpr} end)
              from variants v
              where v."productId" = p.id
            ) as "minPrice",
            p.currency as "sourceCurrency",
            (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
            'COP' as currency
          from products p
          join brands b on b.id = p."brandId"
          where p."imageCoverUrl" is not null
          order by md5(concat(p.id::text, ${seed}::text))
          limit 1
        `
      );
      const row = rows[0] ?? null;
      if (!row) return null;
      const { sourceCurrency, brandOverrideUsd, ...baseRow } = row;
      return {
        ...baseRow,
        minPrice: toCopDisplayString({
          value: row.minPrice,
          unitCop: pricingContext.displayUnitCop,
          sourceCurrency,
          brandOverrideUsd,
        }),
        currency: "COP",
      };
    },
    [`home-v${HOME_CACHE_VERSION}-hero-${seed}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getNewArrivals(seed: number, limit = 8): Promise<ProductCard[]> {
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();

      const rows = await prisma.$queryRaw<
        Array<ProductCard & { sourceCurrency: string | null; brandOverrideUsd: boolean }>
      >(
        Prisma.sql`
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p.category,
            p.subcategory,
            p."sourceUrl",
            case
              when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
              else null
            end as "minPrice",
            p.currency as "sourceCurrency",
            (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
            'COP' as currency
          from products p
          join brands b on b.id = p."brandId"
          where ${sqlIsActiveCatalogProduct()}
          order by md5(concat(p.id::text, ${seed}::text, 'new'))
          limit ${limit}
        `
      );

      return rows.map(({ sourceCurrency, brandOverrideUsd, ...row }) => ({
        ...row,
        minPrice: toCopDisplayString({
          value: row.minPrice,
          unitCop: pricingContext.displayUnitCop,
          sourceCurrency,
          brandOverrideUsd,
        }),
        currency: "COP",
      }));
    },
    [`home-v${HOME_CACHE_VERSION}-new-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getTrendingPicks(seed: number, limit = 8): Promise<ProductCard[]> {
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();

      const rows = await prisma.$queryRaw<
        Array<ProductCard & { sourceCurrency: string | null; brandOverrideUsd: boolean }>
      >(
        Prisma.sql`
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p.category,
            p.subcategory,
            p."sourceUrl",
            case
              when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
              else null
            end as "minPrice",
            p.currency as "sourceCurrency",
            (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
            'COP' as currency
          from products p
          join brands b on b.id = p."brandId"
          where ${sqlIsActiveCatalogProduct()}
          order by md5(concat(p.id::text, ${seed}::text, 'picks'))
          limit ${limit}
        `
      );

      return rows.map(({ sourceCurrency, brandOverrideUsd, ...row }) => ({
        ...row,
        minPrice: toCopDisplayString({
          value: row.minPrice,
          unitCop: pricingContext.displayUnitCop,
          sourceCurrency,
          brandOverrideUsd,
        }),
        currency: "COP",
      }));
    },
    [`home-v${HOME_CACHE_VERSION}-picks-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getCategoryHighlights(
  seed: number,
  limit = 8,
  options?: { preferBlob?: boolean },
): Promise<CategoryHighlight[]> {
  const preferBlob = options?.preferBlob === true;
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{ category: string; imageCoverUrl: string }>
      >(
        Prisma.sql`
          with normalized as (
            select
              p.id,
              p."imageCoverUrl",
              ${sqlHomeCategoryCase()} as category
            from products p
            join brands b on b.id = p."brandId"
            where ${sqlIsActiveCatalogProduct()}
              and p.category is not null
              and p.category <> ''
          ),
          ranked as (
            select
              n.category,
              n."imageCoverUrl",
              count(*) over (partition by n.category) as category_count,
              row_number() over (
                partition by n.category
                order by md5(concat(n.id::text, ${seed}::text, n.category::text))
              ) as image_rank
            from normalized n
          ),
          picked as (
            select
              r.category,
              r."imageCoverUrl",
              row_number() over (order by r.category_count desc, r.category asc) as category_rank
            from ranked r
            where r.image_rank = 1
              and r.category is not null
              and r.category <> ''
          )
          select
            p.category,
            p."imageCoverUrl"
          from picked p
          where p.category_rank <= ${limit}
          order by p.category_rank asc
        `
      );

      return finalizeCategoryHighlights(rows, preferBlob);
    },
    [`home-v${HOME_CACHE_VERSION}-categories-${seed}-${limit}-${preferBlob ? "blob-first" : "default"}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

function finalizeCategoryHighlights(
  rows: Array<{ category: string; imageCoverUrl: string }>,
  preferBlob: boolean,
): CategoryHighlight[] {
  const mapped = rows.map((row) => ({
    category: row.category,
    label: labelize(row.category),
    imageCoverUrl: row.imageCoverUrl,
    href: buildCategoryHref("Unisex", row.category),
  }));

  if (!preferBlob) return mapped;

  return [...mapped].sort((a, b) => {
    const aBlob = a.imageCoverUrl.includes("blob.vercel-storage.com") ? 1 : 0;
    const bBlob = b.imageCoverUrl.includes("blob.vercel-storage.com") ? 1 : 0;
    return bBlob - aBlob;
  });
}

async function getCategoryHighlightsFallback(
  seed: number,
  limit = 12,
  options?: { preferBlob?: boolean },
): Promise<CategoryHighlight[]> {
  const preferBlob = options?.preferBlob === true;
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<Array<{ category: string; imageCoverUrl: string }>>(
        Prisma.sql`
          with normalized as (
            select
              ${sqlHomeCategoryCase()} as category,
              p."imageCoverUrl",
              p."updatedAt"
            from products p
            join brands b on b.id = p."brandId"
            where ${sqlIsActiveCatalogProduct()}
              and p.category is not null
              and p.category <> ''
          ),
          ranked as (
            select
              n.category,
              n."imageCoverUrl",
              count(*) over (partition by n.category) as category_count,
              row_number() over (
                partition by n.category
                order by n."updatedAt" desc nulls last, n."imageCoverUrl" asc
              ) as image_rank
            from normalized n
          )
          select
            r.category,
            r."imageCoverUrl"
          from ranked r
          where r.image_rank = 1
            and r.category is not null
            and r.category <> ''
          order by r.category_count desc, r.category asc
          limit ${limit}
        `,
      );

      return finalizeCategoryHighlights(rows, preferBlob);
    },
    [`home-v${HOME_CACHE_VERSION}-categories-fallback-${seed}-${limit}-${preferBlob ? "blob-first" : "default"}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

export async function getStyleGroups(seed: number, limit = 3): Promise<StyleGroup[]> {
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricingContext.pricing);

      const rows = await prisma.$queryRaw<
        Array<
          ProductCard & {
            styleKey: string;
            styleOrder: number;
            rowRank: number;
            sourceCurrency: string | null;
            brandOverrideUsd: boolean;
          }
        >
      >(
        Prisma.sql`
          with style_counts as (
            select p."stylePrimary" as style_key, count(*)::int as cnt
            from products p
            where p."stylePrimary" is not null and p."stylePrimary" <> ''
            group by 1
          ),
          top_styles as (
            select
              sc.style_key,
              row_number() over (order by sc.cnt desc, sc.style_key asc) as style_order
            from style_counts sc
            order by sc.cnt desc, sc.style_key asc
            limit ${limit}
          ),
          ranked as (
            select
              ts.style_key as "styleKey",
              ts.style_order as "styleOrder",
              p.id,
              p.name,
              p."imageCoverUrl",
              b.name as "brandName",
              p.category,
              p.subcategory,
              p."sourceUrl",
              (
                select min(case when ${priceCopExpr} > 0 and ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} then ${priceCopExpr} end)
                from variants v
                where v."productId" = p.id
              ) as "minPrice",
              p.currency as "sourceCurrency",
              (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
              row_number() over (
                partition by ts.style_key
                order by md5(concat(p.id::text, ${seed}::text, ts.style_key::text))
              ) as "rowRank"
            from top_styles ts
            join products p on p."stylePrimary" = ts.style_key and p."imageCoverUrl" is not null
            join brands b on b.id = p."brandId"
          )
          select
            "styleKey",
            "styleOrder",
            "rowRank",
            id,
            name,
            "imageCoverUrl",
            "brandName",
            category,
            subcategory,
            "sourceUrl",
            "minPrice",
            "sourceCurrency",
            "brandOverrideUsd",
            'COP' as currency
          from ranked
          where "rowRank" <= ${HOME_STYLE_PRODUCTS_LIMIT}
          order by "styleOrder" asc, "rowRank" asc
        `
      );

      const grouped = new Map<
        string,
        {
          styleOrder: number;
          products: ProductCard[];
        }
      >();

      for (const row of rows) {
        const styleKey = row.styleKey;
        const styleOrder = Number(row.styleOrder);
        const product: ProductCard = {
          id: row.id,
          name: row.name,
          imageCoverUrl: row.imageCoverUrl,
          brandName: row.brandName,
          category: row.category,
          subcategory: row.subcategory,
          sourceUrl: row.sourceUrl,
          minPrice: toCopDisplayString({
            value: row.minPrice,
            unitCop: pricingContext.displayUnitCop,
            sourceCurrency: row.sourceCurrency,
            brandOverrideUsd: row.brandOverrideUsd,
          }),
          currency: "COP",
        };

        const bucket = grouped.get(styleKey);
        if (!bucket) {
          grouped.set(styleKey, { styleOrder: Number.isFinite(styleOrder) ? styleOrder : 0, products: [product] });
        } else {
          bucket.products.push(product);
        }
      }

      return Array.from(grouped.entries())
        .sort((a, b) => a[1].styleOrder - b[1].styleOrder)
        .map(([styleKey, value]) => ({
          styleKey,
          label: labelize(styleKey),
          products: value.products,
        }));
    },
    [`home-v${HOME_CACHE_VERSION}-styles-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getColorCombos(seed: number, limit = 6): Promise<ColorCombo[]> {
  const cached = unstable_cache(
    async () => {
      const combos = await prisma.$queryRaw<
        Array<{
          id: string;
          comboKey: string;
          detectedLayout: string | null;
          colorsJson: Prisma.JsonValue | string | null;
        }>
      >(
        Prisma.sql`
          select
            c.id,
            c."comboKey",
            c."detectedLayout",
            c."colorsJson"
          from color_combinations c
          where c."colorsJson" is not null
          order by md5(concat(c.id::text, ${seed}::text, 'colors'))
          limit ${limit}
        `
      );

      return combos.map((combo) => {
        let colors: Array<{ hex: string; role?: string | null }> = [];
        if (combo.colorsJson) {
          if (typeof combo.colorsJson === "string") {
            try {
              colors = JSON.parse(combo.colorsJson) as Array<{
                hex: string;
                role?: string | null;
              }>;
            } catch {
              colors = [];
            }
          } else if (Array.isArray(combo.colorsJson)) {
            colors = combo.colorsJson as Array<{ hex: string; role?: string | null }>;
          }
        }
        return {
          id: combo.id,
          comboKey: combo.comboKey,
          detectedLayout: combo.detectedLayout,
          colors: colors.map((color) => ({
            hex: color.hex,
            role: color.role ?? null,
            pantoneName: null,
          })),
        };
      });
    },
    [`home-v${HOME_CACHE_VERSION}-colors-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getBrandLogos(seed: number, limit = 24): Promise<BrandLogo[]> {
  const cached = unstable_cache(
    async () => {
      return prisma.$queryRaw<BrandLogo[]>(
        Prisma.sql`
          with brand_metrics as (
            select
              p."brandId" as brand_id,
              count(*)::int as "productCount",
              count(distinct case when p.category is not null and p.category <> '' then p.category end)::int as "categoryCount"
            from products p
            join brands b on b.id = p."brandId"
            where p."imageCoverUrl" is not null
              and b."isActive" = true
              and (p.status is null or lower(p.status) <> 'archived')
            group by 1
          ),
          brand_cover as (
            select
              q."brandId" as brand_id,
              q."imageCoverUrl" as "heroImageUrl"
            from (
              select
                p."brandId",
                p."imageCoverUrl",
                row_number() over (
                  partition by p."brandId"
                  order by md5(concat(p.id::text, ${seed}::text, 'brand-cover'))
                ) as rn
              from products p
              join brands b on b.id = p."brandId"
              where p."imageCoverUrl" is not null
                and b."isActive" = true
                and (p.status is null or lower(p.status) <> 'archived')
            ) q
            where q.rn = 1
          )
          select
            b.id,
            b.slug,
            b.name,
            b."logoUrl",
            coalesce(m."productCount", 0)::int as "productCount",
            coalesce(m."categoryCount", 0)::int as "categoryCount",
            c."heroImageUrl"
          from brands b
          join brand_metrics m on m.brand_id = b.id
          left join brand_cover c on c.brand_id = b.id
          where b."logoUrl" is not null
            and b.slug is not null
            and b.slug <> ''
            and b."isActive" = true
          order by md5(concat(b.id::text, ${seed}::text, 'brands'))
          limit ${limit}
        `
      );
    },
    [`home-v${HOME_CACHE_VERSION}-brands-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

export async function getHomeCoverageStats(): Promise<HomeCoverageStats | null> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{
          productCount: number | bigint;
          brandCount: number | bigint;
          categoryCount: number | bigint;
          lastUpdatedAt: Date | string | null;
        }>
      >(
        Prisma.sql`
          with eligible_products as (
            select
              p.id,
              p."brandId",
              p.category,
              p."updatedAt"
            from products p
            join brands b on b.id = p."brandId"
            where p."imageCoverUrl" is not null
              and b."isActive" = true
              and (p.status is null or lower(p.status) <> 'archived')
          )
          select
            count(*)::int as "productCount",
            count(distinct "brandId")::int as "brandCount",
            count(distinct case when category is not null and category <> '' then category end)::int as "categoryCount",
            max("updatedAt") as "lastUpdatedAt"
          from eligible_products
        `
      );

      const row = rows[0];
      if (!row) return null;

      const productCount = Number(row.productCount ?? 0);
      const brandCount = Number(row.brandCount ?? 0);
      const categoryCount = Number(row.categoryCount ?? 0);
      const lastUpdatedAt =
        row.lastUpdatedAt instanceof Date
          ? row.lastUpdatedAt.toISOString()
          : row.lastUpdatedAt
            ? new Date(row.lastUpdatedAt).toISOString()
            : null;

      return {
        productCount,
        brandCount,
        categoryCount,
        lastUpdatedAt,
      };
    },
    [`home-v${HOME_CACHE_VERSION}-coverage`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
  );

  return cached();
}

type HomeProductQueryRow = ProductCard & {
  sourceCurrency: string | null;
  brandOverrideUsd: boolean;
};

function mapHomeProductRows(
  rows: HomeProductQueryRow[],
  pricingContext: HomePricingContext,
): ProductCard[] {
  return rows.map(({ sourceCurrency, brandOverrideUsd, ...row }) => ({
    ...row,
    minPrice: toCopDisplayString({
      value: row.minPrice,
      unitCop: pricingContext.displayUnitCop,
      sourceCurrency,
      brandOverrideUsd,
    }),
    currency: "COP",
  }));
}

function normalizeHomeImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildHomeImageOrderKey(seed: number, productId: string, imageUrl: string): string {
  return createHash("sha1").update(`${seed}:${productId}:${imageUrl}`).digest("hex");
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021") return false;

  const metaTable = typeof error.meta?.table === "string" ? error.meta.table : null;
  if (metaTable?.toLowerCase().includes(tableName.toLowerCase())) return true;
  return error.message.toLowerCase().includes(tableName.toLowerCase());
}

async function getHeroImageUrlsByProduct(
  seed: number,
  products: Array<Pick<ProductCard, "id" | "imageCoverUrl">>,
): Promise<Map<string, string[]>> {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (!productIds.length) return new Map();

  const variants = await prisma.variant.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, images: true },
  });

  const imageSetByProduct = new Map<string, Set<string>>();
  for (const variant of variants) {
    let set = imageSetByProduct.get(variant.productId);
    if (!set) {
      set = new Set<string>();
      imageSetByProduct.set(variant.productId, set);
    }
    for (const imageUrl of variant.images) {
      const normalized = normalizeHomeImageUrl(imageUrl);
      if (!normalized) continue;
      set.add(normalized);
    }
  }

  const urlsByProduct = new Map<string, string[]>();
  for (const product of products) {
    const coverUrl = normalizeHomeImageUrl(product.imageCoverUrl);
    const imageSet = imageSetByProduct.get(product.id) ?? new Set<string>();
    if (coverUrl) imageSet.add(coverUrl);

    const sortedUrls = Array.from(imageSet).sort((left, right) => {
      if (coverUrl) {
        if (left === coverUrl && right !== coverUrl) return -1;
        if (right === coverUrl && left !== coverUrl) return 1;
      }

      const leftKey = buildHomeImageOrderKey(seed, product.id, left);
      const rightKey = buildHomeImageOrderKey(seed, product.id, right);
      if (leftKey !== rightKey) return leftKey.localeCompare(rightKey);
      return left.localeCompare(right);
    });

    urlsByProduct.set(product.id, sortedUrls.slice(0, HOME_HERO_IMAGE_POOL_LIMIT));
  }

  return urlsByProduct;
}

export async function getHeroSlides(
  seed: number,
  count = 4,
  excludeIds: string[] = [],
): Promise<HomeHeroSlide[]> {
  const now = new Date();

  // 1. Collect active hero pins ordered by position
  let heroPins: Array<{ productId: string }> = [];
  try {
    heroPins = await prisma.homeHeroPin.findMany({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { position: "asc" },
      select: { productId: true },
      take: count,
    });
  } catch (error) {
    if (!isMissingTableError(error, "home_hero_pins")) throw error;
    console.warn("home.hero_pins.table_missing_fallback", { table: "home_hero_pins" });
  }

  const pinnedProductIds = heroPins.map((p) => p.productId);

  // 2. Fetch pinned products if any exist
  let pinnedProducts: ProductCard[] = [];
  if (pinnedProductIds.length > 0) {
    const pricingContext = await getHomePricingContext();
    const rows = await prisma.$queryRaw<HomeProductQueryRow[]>(Prisma.sql`
      select
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name as "brandName",
        p.category,
        p.subcategory,
        p."sourceUrl",
        p.currency as "sourceCurrency",
        coalesce(b."metadata"->>'overrideAllPricesToUsd', 'false')::boolean as "brandOverrideUsd",
        ${buildEffectiveVariantPriceCopExpr(pricingContext.pricing)} as "minPrice"
      from products p
      join brands b on b.id = p."brandId"
      where p.id = any(${pinnedProductIds}::uuid[])
        and p."imageCoverUrl" is not null
        and b."isActive" = true
        and (p.status is null or lower(p.status) <> 'archived')
    `);

    // Maintain pin order
    const rowsById = new Map(rows.map((r) => [r.id, r]));
    for (const productId of pinnedProductIds) {
      const row = rowsById.get(productId);
      if (!row) continue;
      const sourceCurrency = row.sourceCurrency;
      const brandOverrideUsd = Boolean(row.brandOverrideUsd);
      pinnedProducts.push({
        id: row.id,
        name: row.name,
        imageCoverUrl: row.imageCoverUrl,
        brandName: row.brandName,
        category: row.category,
        subcategory: row.subcategory,
        sourceUrl: row.sourceUrl,
        minPrice: toCopDisplayString({
          value: row.minPrice,
          unitCop: pricingContext.displayUnitCop,
          sourceCurrency,
          brandOverrideUsd,
        }),
        currency: "COP",
      });
    }
  }

  // 3. Fill remaining slots with automatic new arrivals
  const remainingCount = Math.max(0, count - pinnedProducts.length);
  const allExcludeIds = [...excludeIds, ...pinnedProducts.map((p) => p.id)];
  let autoSlides: ProductCard[] = [];
  if (remainingCount > 0) {
    const pool = await getNewArrivals(seed, Math.max(36, remainingCount * 10));
    const registry = createHomeSelectionRegistry(allExcludeIds);
    autoSlides = collectUniqueProducts(pool, registry, remainingCount);
  }

  const allSlides = [...pinnedProducts, ...autoSlides];
  const heroImageUrlsByProduct = await getHeroImageUrlsByProduct(seed, allSlides);

  return allSlides.map((item, index) => {
    const fallbackCover = normalizeHomeImageUrl(item.imageCoverUrl);
    const heroImageUrls = heroImageUrlsByProduct.get(item.id) ?? [];
    return {
      ...item,
      slideOrder: index + 1,
      heroImageUrls: heroImageUrls.length > 0 ? heroImageUrls : fallbackCover ? [fallbackCover] : [],
    };
  });
}

export async function getFocusPicks(
  seed: number,
  options?: {
    limit?: number;
    subcategoryLimit?: number;
    excludeIds?: string[];
  },
): Promise<ProductCard[]> {
  const limit = options?.limit ?? 24;
  const subcategoryLimit = options?.subcategoryLimit ?? 12;
  const excludeIds = options?.excludeIds ?? [];
  const pool = await getTrendingPicks(seed, Math.max(limit * 5, 120));
  const filtered = pool.filter((item) => !excludeIds.includes(item.id));
  const bucketed = new Map<string, ProductCard[]>();
  for (const item of filtered) {
    const key = (item.subcategory || item.category || "otros").trim();
    if (!bucketed.has(key)) bucketed.set(key, []);
    bucketed.get(key)!.push(item);
  }
  const selectedBuckets = Array.from(bucketed.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, subcategoryLimit);
  const registry = createHomeSelectionRegistry(excludeIds);
  const picks: ProductCard[] = [];
  let cursor = 0;
  while (picks.length < limit) {
    let addedInRound = false;
    for (const [, items] of selectedBuckets) {
      const candidate = items[cursor];
      if (!candidate) continue;
      if (registry.usedIds.has(candidate.id)) continue;
      registry.usedIds.add(candidate.id);
      picks.push(candidate);
      addedInRound = true;
      if (picks.length >= limit) break;
    }
    if (!addedInRound) break;
    cursor += 1;
  }
  return picks;
}

export async function getPriceDropPicks(
  seed: number,
  options?: {
    limit?: number;
    days?: number;
    minDropPercent?: number;
    excludeIds?: string[];
  },
): Promise<HomePriceDropCardData[]> {
  const limit = options?.limit ?? 12;
  const days = options?.days ?? 7;
  const minDropPercent = options?.minDropPercent ?? 5;
  const excludeIds = options?.excludeIds ?? [];
  const candidatePoolLimit = Math.max(limit * 12, 180);
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const rows = await prisma.$queryRaw<
        Array<
          HomeProductQueryRow & {
            previousPrice: number | null;
            dropPercent: number | null;
            priceChangedAt: Date | string | null;
          }
        >
      >(
        Prisma.sql`
          with candidates as (
            select
              p.id,
              p.name,
              p."imageCoverUrl",
              b.name as "brandName",
              p.category,
              p.subcategory,
              p."sourceUrl",
              p.currency as "sourceCurrency",
              (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
              p."minPriceCop" as current_price,
              p."priceChangeAt"
            from products p
            join brands b on b.id = p."brandId"
            where ${sqlIsActiveCatalogProduct()}
              and p."priceChangeDirection" = 'down'
              and p."priceChangeAt" >= (now() - make_interval(days => ${days}))
              ${sqlExcludeProductIds(excludeIds)}
            order by p."priceChangeAt" desc nulls last
            limit ${candidatePoolLimit}
          ),
          variant_history as (
            select
              v."productId" as product_id,
              max(case when ph.price > 0 and ph.price <= ${CATALOG_MAX_VALID_PRICE} then ph.price end)::numeric as previous_price
            from variants v
            join "price_history" ph on ph."variantId" = v.id
            where v."productId" in (select c.id from candidates c)
              and ph."capturedAt" >= (now() - make_interval(days => ${days}))
            group by v."productId"
          ),
          ranked as (
            select
              c.id,
              c.name,
              c."imageCoverUrl",
              c."brandName",
              c.category,
              c.subcategory,
              c."sourceUrl",
              case
                when c.current_price > 0 and c.current_price <= ${CATALOG_MAX_VALID_PRICE} then c.current_price
                else null
              end as "minPrice",
              c."sourceCurrency",
              c."brandOverrideUsd",
              vh.previous_price as "previousPrice",
              case
                when vh.previous_price is null or vh.previous_price <= 0 or c.current_price is null then null
                else round(((vh.previous_price - c.current_price) / vh.previous_price) * 100.0, 2)
              end as "dropPercent",
              c."priceChangeAt" as "priceChangedAt"
            from candidates c
            left join variant_history vh on vh.product_id = c.id
          )
          select
            r.id,
            r.name,
            r."imageCoverUrl",
            r."brandName",
            r.category,
            r.subcategory,
            r."sourceUrl",
            r."minPrice",
            r."sourceCurrency",
            r."brandOverrideUsd",
            r."previousPrice",
            r."dropPercent",
            r."priceChangedAt",
            'COP' as currency
          from ranked r
          where r."minPrice" is not null
            and r."previousPrice" is not null
            and r."previousPrice" > r."minPrice"
            and r."dropPercent" >= ${minDropPercent}
          order by
            r."dropPercent" desc nulls last,
            md5(concat(r.id::text, ${seed}::text, 'price-drop'))
          limit ${limit}
        `
      );
      const cards = mapHomeProductRows(rows, pricingContext);
      const rowById = new Map(rows.map((row) => [row.id, row]));
      return cards.map((card) => {
        const row = rowById.get(card.id);
        const previousPrice = row
          ? toCopDisplayString({
              value: row.previousPrice,
              unitCop: pricingContext.displayUnitCop,
              sourceCurrency: row.sourceCurrency,
              brandOverrideUsd: row.brandOverrideUsd,
            })
          : null;
        const priceChangedAt =
          row?.priceChangedAt instanceof Date
            ? row.priceChangedAt.toISOString()
            : row?.priceChangedAt
              ? new Date(row.priceChangedAt).toISOString()
              : null;
        return {
          ...card,
          previousPrice,
          dropPercent: row?.dropPercent ? Number(row.dropPercent) : null,
          priceChangedAt,
        };
      });
    },
    [`home-v${HOME_CACHE_VERSION}-price-drop-${seed}-${limit}-${days}-${minDropPercent}-${excludeIds.join(",")}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );
  return cached();
}

export async function getMostFavoritedPicks(
  seed: number,
  options?: {
    limit?: number;
    windowDays?: number;
    excludeIds?: string[];
  },
): Promise<ProductCard[]> {
  const limit = options?.limit ?? 12;
  const windowDays = options?.windowDays ?? 30;
  const excludeIds = options?.excludeIds ?? [];
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricingContext.pricing);
      const rows = await prisma.$queryRaw<HomeProductQueryRow[]>(
        Prisma.sql`
          with favorites_rank as (
            select
              uf."productId" as product_id,
              count(*)::int as favorite_count
            from "user_favorites" uf
            where uf."createdAt" >= (now() - make_interval(days => ${windowDays}))
            group by uf."productId"
          )
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p.category,
            p.subcategory,
            p."sourceUrl",
            (
              select min(case when ${priceCopExpr} > 0 and ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} then ${priceCopExpr} end)
              from variants v
              where v."productId" = p.id
            ) as "minPrice",
            p.currency as "sourceCurrency",
            (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
            'COP' as currency
          from favorites_rank fr
          join products p on p.id = fr.product_id
          join brands b on b.id = p."brandId"
          where p."imageCoverUrl" is not null
            and p."hasInStock" = true
            ${sqlExcludeProductIds(excludeIds)}
          order by fr.favorite_count desc, md5(concat(p.id::text, ${seed}::text, 'favorites'))
          limit ${limit}
        `
      );
      return mapHomeProductRows(rows, pricingContext);
    },
    [`home-v${HOME_CACHE_VERSION}-most-favorites-${seed}-${limit}-${windowDays}-${excludeIds.join(",")}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );
  return cached();
}

export async function getUserFavoritePicks(
  userId: string,
  options?: {
    limit?: number;
    excludeIds?: string[];
  },
): Promise<ProductCard[]> {
  const limit = options?.limit ?? 12;
  const excludeIds = options?.excludeIds ?? [];
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricingContext.pricing);
      const rows = await prisma.$queryRaw<HomeProductQueryRow[]>(
        Prisma.sql`
          with ranked as (
            select
              uf."productId",
              row_number() over (partition by uf."productId" order by uf."createdAt" desc) as rn,
              max(uf."createdAt") over (partition by uf."productId") as latest
            from "user_favorites" uf
            where uf."userId" = ${userId}
          )
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p.category,
            p.subcategory,
            p."sourceUrl",
            (
              select min(case when ${priceCopExpr} > 0 and ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} then ${priceCopExpr} end)
              from variants v
              where v."productId" = p.id
            ) as "minPrice",
            p.currency as "sourceCurrency",
            (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
            'COP' as currency
          from ranked r
          join products p on p.id = r."productId"
          join brands b on b.id = p."brandId"
          where r.rn = 1
            and p."imageCoverUrl" is not null
            and p."hasInStock" = true
            ${sqlExcludeProductIds(excludeIds)}
          order by r.latest desc
          limit ${limit}
        `
      );
      return mapHomeProductRows(rows, pricingContext);
    },
    [`home-v${HOME_CACHE_VERSION}-user-favorites-${userId}-${limit}-${excludeIds.join(",")}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );
  return cached();
}

export async function getDailyTrendingPicks(
  seed: number,
  options?: {
    limit?: number;
    excludeIds?: string[];
  },
): Promise<HomeTrendingDailyCardData[]> {
  const limit = options?.limit ?? 12;
  const excludeIds = options?.excludeIds ?? [];
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      let rows: Array<
        HomeProductQueryRow & {
          clickCount: number;
          snapshotDate: Date | string | null;
        }
      > = [];
      try {
        rows = await prisma.$queryRaw<
          Array<
            HomeProductQueryRow & {
              clickCount: number;
              snapshotDate: Date | string | null;
            }
          >
        >(
          Prisma.sql`
            with latest as (
              select max(htd."snapshotDate") as snapshot_date
              from "home_trending_daily" htd
            )
            select
              p.id,
              p.name,
              p."imageCoverUrl",
              b.name as "brandName",
              p.category,
              p.subcategory,
              p."sourceUrl",
              case
                when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
                else null
              end as "minPrice",
              p.currency as "sourceCurrency",
              (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
              htd."clickCount" as "clickCount",
              htd."snapshotDate" as "snapshotDate",
              'COP' as currency
            from latest l
            join "home_trending_daily" htd on htd."snapshotDate" = l.snapshot_date
            join products p on p.id = htd."productId"
            join brands b on b.id = p."brandId"
            where p."imageCoverUrl" is not null
              and p."hasInStock" = true
              ${sqlExcludeProductIds(excludeIds)}
            order by htd.rank asc, htd."clickCount" desc
            limit ${limit}
          `
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (!message.includes("home_trending_daily") || !message.includes("does not exist")) {
          throw error;
        }
      }

      if (rows.length === 0) {
        const liveRows = await prisma.$queryRaw<
          Array<
            HomeProductQueryRow & {
              clickCount: number;
              snapshotDate: Date | string | null;
            }
          >
        >(
          Prisma.sql`
            with clicks as (
              select
                ee."productId" as product_id,
                count(*)::int as click_count
              from "experience_events" ee
              join products p on p.id = ee."productId"
              join brands b on b.id = p."brandId"
              where ee.type = 'product_click'
                and ee."productId" is not null
                and ee."createdAt" >= (now() - make_interval(days => 7))
                and ${sqlIsActiveCatalogProduct()}
                ${sqlExcludeProductIds(excludeIds)}
              group by ee."productId"
            )
            select
              p.id,
              p.name,
              p."imageCoverUrl",
              b.name as "brandName",
              p.category,
              p.subcategory,
              p."sourceUrl",
              case
                when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
                else null
              end as "minPrice",
              p.currency as "sourceCurrency",
              (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
              c.click_count as "clickCount",
              null::timestamptz as "snapshotDate",
              'COP' as currency
            from clicks c
            join products p on p.id = c.product_id
            join brands b on b.id = p."brandId"
            order by c.click_count desc, md5(concat(p.id::text, ${seed}::text, 'daily-live'))
            limit ${limit}
          `,
        );

        if (liveRows.length > 0) {
          rows = liveRows;
        }
      }

      if (rows.length === 0) {
        return [];
      }

      const cards = mapHomeProductRows(rows, pricingContext);
      const rowById = new Map(rows.map((row) => [row.id, row]));
      return cards.map((card) => {
        const row = rowById.get(card.id);
        const snapshotDate =
          row?.snapshotDate instanceof Date
            ? row.snapshotDate.toISOString()
            : row?.snapshotDate
              ? new Date(row.snapshotDate).toISOString()
              : null;
        return {
          ...card,
          clickCount: Number(row?.clickCount ?? 0),
          snapshotDate,
        };
      });
    },
    [`home-v${HOME_CACHE_VERSION}-daily-trending-${seed}-${limit}-${excludeIds.join(",")}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );
  return cached();
}

async function getPriceDropSignalFallback(
  seed: number,
  options?: {
    limit?: number;
    days?: number;
    minDropPercent?: number;
    excludeIds?: string[];
  },
): Promise<HomePriceDropCardData[]> {
  const limit = options?.limit ?? 12;
  const days = options?.days ?? 20;
  const minDropPercent = options?.minDropPercent ?? 0;
  const excludeIds = options?.excludeIds ?? [];

  const pricingContext = await getHomePricingContext();
  const rows = await prisma.$queryRaw<
    Array<
      HomeProductQueryRow & {
        previousPrice: number | null;
        dropPercent: number | null;
        priceChangedAt: Date | string | null;
      }
    >
  >(
    Prisma.sql`
      with candidates as (
        select
          p.id,
          p.name,
          p."imageCoverUrl",
          b.name as "brandName",
          p.category,
          p.subcategory,
          p."sourceUrl",
          p.currency as "sourceCurrency",
          (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
          case
            when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
            else null
          end as "minPrice",
          case
            when p."maxPriceCop" > p."minPriceCop" and p."maxPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."maxPriceCop"
            else null
          end as "previousPrice",
          p."priceChangeAt" as "priceChangedAt"
        from products p
        join brands b on b.id = p."brandId"
        where ${sqlIsActiveCatalogProduct()}
          and p."priceChangeDirection" = 'down'
          and p."priceChangeAt" >= (now() - make_interval(days => ${days}))
          ${sqlExcludeProductIds(excludeIds)}
      )
      select
        c.id,
        c.name,
        c."imageCoverUrl",
        c."brandName",
        c.category,
        c.subcategory,
        c."sourceUrl",
        c."minPrice",
        c."sourceCurrency",
        c."brandOverrideUsd",
        c."previousPrice",
        case
          when c."previousPrice" is null or c."previousPrice" <= 0 or c."minPrice" is null then null
          else round(((c."previousPrice" - c."minPrice") / c."previousPrice") * 100.0, 2)
        end as "dropPercent",
        c."priceChangedAt",
        'COP' as currency
      from candidates c
      where c."minPrice" is not null
        and (
          c."previousPrice" is null
          or (
            c."previousPrice" > c."minPrice"
            and ((c."previousPrice" - c."minPrice") / nullif(c."previousPrice", 0)) * 100 >= ${minDropPercent}
          )
        )
      order by c."priceChangedAt" desc nulls last, md5(concat(c.id::text, ${seed}::text, 'price-drop-signal'))
      limit ${limit}
    `,
  );

  const cards = mapHomeProductRows(rows, pricingContext);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return cards.map((card) => {
    const row = rowById.get(card.id);
    const previousPrice = row
      ? toCopDisplayString({
          value: row.previousPrice,
          unitCop: pricingContext.displayUnitCop,
          sourceCurrency: row.sourceCurrency,
          brandOverrideUsd: row.brandOverrideUsd,
        })
      : null;
    const priceChangedAt =
      row?.priceChangedAt instanceof Date
        ? row.priceChangedAt.toISOString()
        : row?.priceChangedAt
          ? new Date(row.priceChangedAt).toISOString()
          : null;

    return {
      ...card,
      previousPrice,
      dropPercent: row?.dropPercent ? Number(row.dropPercent) : null,
      priceChangedAt,
    };
  });
}

async function getFastEditorialPicks(
  seed: number,
  limit: number,
  excludeIds: string[] = [],
): Promise<ProductCard[]> {
  const pricingContext = await getHomePricingContext();
  const rows = await prisma.$queryRaw<HomeProductQueryRow[]>(
    Prisma.sql`
      select
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name as "brandName",
        p.category,
        p.subcategory,
        p."sourceUrl",
        case
          when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
          else null
        end as "minPrice",
        p.currency as "sourceCurrency",
        (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
        'COP' as currency
      from products p
      join brands b on b.id = p."brandId"
      where ${sqlIsActiveCatalogProduct()}
        ${sqlExcludeProductIds(excludeIds)}
      order by p."updatedAt" desc nulls last, md5(concat(p.id::text, ${seed}::text, 'fast-home-pool'))
      limit ${limit}
    `,
  );

  return mapHomeProductRows(rows, pricingContext);
}

export async function getResilientNewArrivals(
  seed: number,
  options?: {
    limit?: number;
  },
): Promise<HomeResilientSectionResult<ProductCard>> {
  const limit = options?.limit ?? 18;
  return executeResilientSection("new_arrivals", [
    {
      source: "new_arrivals",
      fetch: () => getNewArrivals(seed, limit),
      minItems: Math.min(limit, 8),
    },
    {
      source: "trending_picks",
      fetch: () => getTrendingPicks(seed + 11, limit),
      minItems: Math.min(limit, 8),
    },
    {
      source: "most_favorited",
      fetch: () =>
        getMostFavoritedPicks(seed + 19, {
          limit,
          windowDays: 30,
        }),
      minItems: Math.min(limit, 8),
    },
  ]);
}

export async function getResilientCategoryHighlights(
  seed: number,
  options?: {
    limit?: number;
    preferBlob?: boolean;
  },
): Promise<HomeResilientSectionResult<CategoryHighlight>> {
  const limit = options?.limit ?? 24;
  const preferBlob = options?.preferBlob === true;
  return executeResilientSection("category_highlights", [
    {
      source: "category_highlights",
      fetch: () => getCategoryHighlights(seed, limit, { preferBlob }),
      minItems: Math.min(limit, 12),
    },
    {
      source: "category_highlights_fallback",
      fetch: () => getCategoryHighlightsFallback(seed, Math.max(12, Math.floor(limit / 2)), { preferBlob }),
      minItems: 8,
    },
  ]);
}

export async function getResilientFocusPicks(
  seed: number,
  options?: {
    limit?: number;
    subcategoryLimit?: number;
    excludeIds?: string[];
  },
): Promise<HomeResilientSectionResult<ProductCard>> {
  const limit = options?.limit ?? 24;
  const subcategoryLimit = options?.subcategoryLimit ?? 12;
  const excludeIds = options?.excludeIds ?? [];
  return executeResilientSection("focus_picks", [
    {
      source: "focus_picks",
      fetch: () =>
        getFocusPicks(seed, {
          limit,
          subcategoryLimit,
          excludeIds,
        }),
      minItems: Math.min(limit, 8),
    },
    {
      source: "trending_picks",
      fetch: async () => (await getTrendingPicks(seed + 23, Math.max(limit, 12))).filter((item) => !excludeIds.includes(item.id)),
      minItems: Math.min(limit, 8),
    },
    {
      source: "most_favorited",
      fetch: () =>
        getMostFavoritedPicks(seed + 31, {
          limit: Math.max(limit, 12),
          windowDays: 30,
          excludeIds,
        }),
      minItems: 8,
    },
  ]);
}

export async function getResilientPriceDropPicks(
  seed: number,
  options?: {
    limit?: number;
    excludeIds?: string[];
  },
): Promise<HomeResilientSectionResult<HomePriceDropCardData>> {
  const limit = options?.limit ?? 12;
  const excludeIds = options?.excludeIds ?? [];
  return executeResilientSection("price_drop", [
    {
      source: "price_drop_7d_5pct",
      fetch: () =>
        getPriceDropPicks(seed, {
          limit,
          days: 7,
          minDropPercent: 5,
          excludeIds,
        }),
      minItems: 1,
    },
    {
      source: "price_drop_20d_5pct",
      fetch: () =>
        getPriceDropPicks(seed + 1, {
          limit,
          days: 20,
          minDropPercent: 5,
          excludeIds,
        }),
      minItems: 1,
    },
    {
      source: "price_drop_20d_2pct",
      fetch: () =>
        getPriceDropPicks(seed + 2, {
          limit,
          days: 20,
          minDropPercent: 2,
          excludeIds,
        }),
      minItems: 1,
    },
    {
      source: "price_drop_signal_recent",
      fetch: () =>
        getPriceDropSignalFallback(seed + 3, {
          limit,
          days: 20,
          minDropPercent: 0,
          excludeIds,
        }),
      minItems: 1,
    },
  ]);
}

export async function getResilientDailyTrendingPicks(
  seed: number,
  options?: {
    limit?: number;
    excludeIds?: string[];
  },
): Promise<HomeResilientSectionResult<HomeTrendingDailyCardData>> {
  const limit = options?.limit ?? 12;
  const excludeIds = options?.excludeIds ?? [];
  return executeResilientSection("daily_trending", [
    {
      source: "daily_trending_snapshot_or_live",
      fetch: () =>
        getDailyTrendingPicks(seed, {
          limit,
          excludeIds,
        }),
      minItems: 1,
      timeoutMs: 14_000,
    },
    {
      source: "trending_picks",
      fetch: async () => {
        const fallback = await getTrendingPicks(seed + 43, limit);
        return fallback
          .filter((item) => !excludeIds.includes(item.id))
          .map((item) => ({
            ...item,
            clickCount: 0,
            snapshotDate: null,
          }));
      },
      minItems: 1,
      timeoutMs: 14_000,
    },
    {
      source: "fast_editorial_pool",
      fetch: async () => {
        const fallback = await getFastEditorialPicks(seed + 47, limit, excludeIds);
        return fallback.map((item) => ({
          ...item,
          clickCount: 0,
          snapshotDate: null,
        }));
      },
      minItems: 1,
      timeoutMs: 10_000,
    },
  ]);
}
