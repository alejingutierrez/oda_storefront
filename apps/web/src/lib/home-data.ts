import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG } from "@/lib/catalog-cache";
import { HOME_CONFIG_DEFAULTS } from "@/lib/home-types";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";
import { MENU_GROUP_VALUES, resolveCategoryMenuGroup } from "@/lib/taxonomy/menu-groups";
import type {
  BrandLogo,
  CategoryHighlight,
  ColorCombo,
  HomeActionableColorEntry,
  HomeBrandFeature,
  HomeCoverageStats,
  HomeConfigMap,
  HomeHeroSlide,
  HomePagePayload,
  HomePriceDropCardData,
  HomeQuickDiscoveryCard,
  HomeStyleSpotlight,
  HomeTrustStrip,
  HomeTrendingDailyCardData,
  HomeUtilityTab,
  MegaMenuData,
  ProductCard,
  StyleGroup,
} from "@/lib/home-types";
import {
  GenderKey,
  buildCategoryHref,
  labelize,
} from "@/lib/navigation";
import { REAL_STYLE_LABELS, type RealStyleKey } from "@/lib/real-style/constants";
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
  HomeActionableColorEntry,
  HomeBrandFeature,
  BrandLogo,
  CategoryHighlight,
  ColorCombo,
  HomeCoverageStats,
  HomeHeroSlide,
  HomePagePayload,
  HomePriceDropCardData,
  HomeQuickDiscoveryCard,
  HomeStyleSpotlight,
  HomeTrustStrip,
  HomeTrendingDailyCardData,
  HomeProductCardData,
  HomeConfigMap,
  HomeUtilityTab,
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
const HOME_CACHE_VERSION = 17;
const HOME_SECTION_TIMEOUT_MS = 12_000;
const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;
const HOME_STYLE_PRODUCTS_LIMIT = 8;
const HOME_STYLE_SPOTLIGHT_PRODUCT_LIMIT = 8;
const HOME_UTILITY_TAB_PRODUCT_LIMIT = 8;
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

function sqlIsPublishedCatalogProduct() {
  return Prisma.sql`
    p."imageCoverUrl" is not null
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

function clamp01(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.min(Math.max(Number(value), 0), 1);
}

function formatHomeCount(value: number) {
  return new Intl.NumberFormat("es-CO").format(Math.max(0, Math.round(value)));
}

function ratioToPct(value: number | null | undefined) {
  return Math.round(clamp01(value) * 100);
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = HOME_SECTION_TIMEOUT_MS): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

function limitItemsPerBrand<T extends { brandName: string }>(
  items: T[],
  limit: number,
  maxPerBrand: number,
): T[] {
  const counts = new Map<string, number>();
  const next: T[] = [];
  for (const item of items) {
    const brandKey = item.brandName.trim().toLowerCase();
    const seen = counts.get(brandKey) ?? 0;
    if (seen >= maxPerBrand) continue;
    counts.set(brandKey, seen + 1);
    next.push(item);
    if (next.length >= limit) break;
  }
  return next;
}

function buildCatalogHref(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    search.set(key, value);
  }
  const query = search.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
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
  const taxonomy = await getPublishedTaxonomyOptions();
  const activeTaxonomyCategories = (taxonomy.data.categories ?? [])
    .filter((category) => category && category.isActive !== false)
    .map((category) => ({
      key: category.key,
      label: taxonomy.categoryLabels[category.key] ?? category.label ?? labelize(category.key),
      menuGroup: taxonomy.categoryMenuGroups[category.key] ?? resolveCategoryMenuGroup({ categoryKey: category.key }),
    }));
  const inactiveTaxonomyCategories = new Set(
    (taxonomy.data.categories ?? [])
      .filter((category) => category && category.isActive === false)
      .map((category) => category.key),
  );

  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{
          gender_bucket: GenderKey;
          category: string;
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
              end as category
            from products p
            where p.category is not null and p.category <> ''
              and p."imageCoverUrl" is not null
              and (p."metadata" -> 'enrichment') is not null
              and p."hasInStock" = true
          )
          select gender_bucket, category, count(*) as cnt
          from bucketed
          group by 1,2
          order by gender_bucket, cnt desc
        `
      );

      const byGender = new Map<GenderKey, Map<string, number>>();

      for (const row of rows) {
        const gender = row.gender_bucket;
        const category = row.category;
        const count = Number(row.cnt);
        if (!byGender.has(gender)) {
          byGender.set(gender, new Map());
        }
        const catMap = byGender.get(gender)!;
        catMap.set(category, (catMap.get(category) ?? 0) + count);
      }

      const genders: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];
      const result = {} as MegaMenuData;

      for (const gender of genders) {
        const catMap = byGender.get(gender) ?? new Map();
        const sections: MegaMenuData[GenderKey] = {
          Superiores: [],
          Completos: [],
          Inferiores: [],
          Accesorios: [],
          Lifestyle: [],
        };
        const seen = new Set<string>();

        for (const group of MENU_GROUP_VALUES) {
          const items = sections[group];
          const groupCategories = activeTaxonomyCategories.filter((category) => category.menuGroup === group);
          for (const category of groupCategories) {
            const count = catMap.get(category.key) ?? 0;
            if (count <= 0) continue;
            items.push({
              key: category.key,
              label: category.label,
              count,
              href: buildCategoryHref(gender, category.key),
            });
            seen.add(category.key);
          }
        }

        const unknownCategories = Array.from(catMap.entries())
          .filter(
            ([category, count]) => count > 0 && !seen.has(category) && !inactiveTaxonomyCategories.has(category),
          )
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

        for (const [category, count] of unknownCategories) {
          const menuGroup = resolveCategoryMenuGroup({ categoryKey: category });
          sections[menuGroup].push({
            key: category,
            label: taxonomy.categoryLabels[category] ?? labelize(category),
            count,
            href: buildCategoryHref(gender, category),
          });
        }

        result[gender] = sections;
      }

      return result;
    },
    [`home-v${HOME_CACHE_VERSION}-mega-menu-taxonomy-v${taxonomy.version}`],
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
            b.slug as "brandSlug",
            p.slug,
            p.category,
            p.subcategory,
            p."sourceUrl",
            p.real_style as "realStyle",
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
          order by ((p."random_sort_key" * 1000000 + ${seed})::bigint % 1000000)
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
            b.slug as "brandSlug",
            p.slug,
            p.category,
            p.subcategory,
            p."sourceUrl",
            p.real_style as "realStyle",
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
          order by ((p."random_sort_key" * 1000000 + ${seed + 1001})::bigint % 1000000)
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
            b.slug as "brandSlug",
            p.slug,
            p.category,
            p.subcategory,
            p."sourceUrl",
            p.real_style as "realStyle",
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
          order by ((p."random_sort_key" * 1000000 + ${seed + 2003})::bigint % 1000000)
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
              p."random_sort_key",
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
                order by ((n."random_sort_key" * 1000000 + ${seed + 3007})::bigint % 1000000)
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

export async function getStyleGroups(seed: number, limit = 3, config?: HomeConfigMap): Promise<StyleGroup[]> {
  // Read admin-selected real styles
  const configuredStylesRaw = config?.["section.curated_looks.real_styles"];
  let configuredStyles: string[] = [];
  if (configuredStylesRaw) {
    try {
      configuredStyles = JSON.parse(configuredStylesRaw);
      if (!Array.isArray(configuredStyles)) configuredStyles = [];
    } catch { configuredStyles = []; }
  }

  const cacheKey = `home-v${HOME_CACHE_VERSION}-styles-realstyle-${seed}-${limit}-${configuredStyles.join(",")}`;

  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricingContext.pricing);

      const hasConfigured = configuredStyles.length > 0;

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
            select p.real_style as style_key, count(*)::int as cnt
            from products p
            where p.real_style is not null and p.real_style <> ''
            group by 1
          ),
          top_styles as (
            select
              sc.style_key,
              ${hasConfigured
                ? Prisma.sql`array_position(array[${Prisma.join(configuredStyles)}]::text[], sc.style_key)::int as style_order`
                : Prisma.sql`(row_number() over (order by sc.cnt desc, sc.style_key asc))::int as style_order`
              }
            from style_counts sc
            ${hasConfigured
              ? Prisma.sql`where sc.style_key = any(array[${Prisma.join(configuredStyles)}]::text[])`
              : Prisma.empty
            }
            order by ${hasConfigured
              ? Prisma.sql`array_position(array[${Prisma.join(configuredStyles)}]::text[], sc.style_key) asc nulls last`
              : Prisma.sql`sc.cnt desc, sc.style_key asc`
            }
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
              b.slug as "brandSlug",
              p.slug,
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
                order by
                  case when p."editorialTopPickRank" is not null or p."editorialFavoriteRank" is not null then 0 else 1 end asc,
                  coalesce(p."editorialTopPickRank", 999999) asc,
                  coalesce(p."editorialFavoriteRank", 999999) asc,
                  ((p."random_sort_key" * 1000000 + ${seed + 4001})::bigint % 1000000)
              ) as "rowRank"
            from top_styles ts
            join products p on p.real_style = ts.style_key and p."imageCoverUrl" is not null
            join brands b on b.id = p."brandId"
          )
          select
            "styleKey",
            "styleOrder",
            "rowRank",
            id,
            name,
            slug,
            "imageCoverUrl",
            "brandName",
            "brandSlug",
            category,
            subcategory,
            "sourceUrl",
            "styleKey" as "realStyle",
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
          brandSlug: row.brandSlug ?? null,
          slug: row.slug ?? null,
          category: row.category,
          subcategory: row.subcategory,
          sourceUrl: row.sourceUrl,
          realStyle: row.styleKey ?? null,
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
          label: (REAL_STYLE_LABELS as Record<string, string>)[styleKey] ?? labelize(styleKey),
          products: value.products,
        }));
    },
    [cacheKey],
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
          order by hashtext(c.id::text || ${seed}::text)
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
                  order by ((p."random_sort_key" * 1000000 + ${seed + 5003})::bigint % 1000000)
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
            and trim(b."logoUrl") <> ''
            and b."logoUrl" ~ '^https?://'
            and b.slug is not null
            and b.slug <> ''
            and b."isActive" = true
          order by hashtext(b.id::text || ${seed}::text)
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
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug ?? null,
    imageCoverUrl: row.imageCoverUrl,
    brandName: row.brandName,
    brandSlug: row.brandSlug ?? null,
    category: row.category,
    subcategory: row.subcategory,
    sourceUrl: row.sourceUrl,
    realStyle: row.realStyle ?? null,
    minPrice: toCopDisplayString({
      value: row.minPrice,
      unitCop: pricingContext.displayUnitCop,
      sourceCurrency: row.sourceCurrency,
      brandOverrideUsd: row.brandOverrideUsd,
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
  const pinnedProducts: ProductCard[] = [];
  if (pinnedProductIds.length > 0) {
    const pricingContext = await getHomePricingContext();
    const rows = await prisma.$queryRaw<HomeProductQueryRow[]>(Prisma.sql`
      select
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name as "brandName",
        b.slug as "brandSlug",
        p.slug,
        p.category,
        p.subcategory,
        p."sourceUrl",
        p.real_style as "realStyle",
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
        brandSlug: row.brandSlug ?? null,
        slug: row.slug ?? null,
        category: row.category,
        subcategory: row.subcategory,
        sourceUrl: row.sourceUrl,
        realStyle: row.realStyle ?? null,
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
              b.slug as "brandSlug",
              p.slug,
              p.category,
              p.subcategory,
              p."sourceUrl",
              p.real_style as "realStyle",
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
              c."brandSlug",
              c.slug,
              c.category,
              c.subcategory,
              c."sourceUrl",
              c."realStyle",
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
            r."brandSlug",
            r.slug,
            r.category,
            r.subcategory,
            r."sourceUrl",
            r."realStyle",
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
            r."priceChangedAt" desc nulls last,
            r."dropPercent" desc nulls last,
            hashtext(r.id::text || ${seed}::text)
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
            b.slug as "brandSlug",
            p.slug,
            p.category,
            p.subcategory,
            p."sourceUrl",
            p.real_style as "realStyle",
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
          order by fr.favorite_count desc, ((p."random_sort_key" * 1000000 + ${seed + 7001})::bigint % 1000000)
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
            b.slug as "brandSlug",
            p.slug,
            p.category,
            p.subcategory,
            p."sourceUrl",
            p.real_style as "realStyle",
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
              b.slug as "brandSlug",
              p.slug,
              p.category,
              p.subcategory,
              p."sourceUrl",
              p.real_style as "realStyle",
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
              b.slug as "brandSlug",
              p.slug,
              p.category,
              p.subcategory,
              p."sourceUrl",
              p.real_style as "realStyle",
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
            order by c.click_count desc, ((p."random_sort_key" * 1000000 + ${seed + 8003})::bigint % 1000000)
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
          b.slug as "brandSlug",
          p.slug,
          p.category,
          p.subcategory,
          p."sourceUrl",
          p.real_style as "realStyle",
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
        c."brandSlug",
        c.slug,
        c.category,
        c.subcategory,
        c."sourceUrl",
        c."realStyle",
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
      order by c."priceChangedAt" desc nulls last, hashtext(c.id::text || ${seed}::text)
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
        b.slug as "brandSlug",
        p.slug,
        p.category,
        p.subcategory,
        p."sourceUrl",
        p.real_style as "realStyle",
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
      order by p."updatedAt" desc nulls last, ((p."random_sort_key" * 1000000 + ${seed + 10007})::bigint % 1000000)
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
      source: "price_drop_14d_3pct",
      fetch: () =>
        getPriceDropPicks(seed, {
          limit,
          days: 14,
          minDropPercent: 3,
          excludeIds,
        }),
      minItems: 1,
    },
    {
      source: "price_drop_30d_3pct",
      fetch: () =>
        getPriceDropPicks(seed + 1, {
          limit,
          days: 30,
          minDropPercent: 3,
          excludeIds,
        }),
      minItems: 1,
    },
    {
      source: "price_drop_30d_1pct",
      fetch: () =>
        getPriceDropPicks(seed + 2, {
          limit,
          days: 30,
          minDropPercent: 1,
          excludeIds,
        }),
      minItems: 1,
    },
    {
      source: "price_drop_signal_recent",
      fetch: () =>
        getPriceDropSignalFallback(seed + 3, {
          limit,
          days: 30,
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

type HomeBehaviorSignals = {
  productClicks7d: number;
  clickedProducts7d: number;
  favorites30d: number;
  favoritedProducts30d: number;
};

type QuickDiscoveryDefinition = {
  key: string;
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  hrefParams: Record<string, string>;
  where: Prisma.Sql;
};

const QUICK_DISCOVERY_DEFINITIONS: QuickDiscoveryDefinition[] = [
  {
    key: "rebajas_reales",
    eyebrow: "Descubrir rápido",
    title: "Rebajas con stock",
    description: "Piezas que bajaron de precio y todavía están disponibles para comprar hoy.",
    ctaLabel: "Ver ahora",
    hrefParams: { price_change: "down", in_stock: "true" },
    where: Prisma.sql`p."priceChangeDirection" = 'down'`,
  },
  {
    key: "oficina_sin_rodeo",
    eyebrow: "Descubrir rápido",
    title: "Oficina sin rodeo",
    description: "Selección para trabajo y reuniones sin tener que descifrar la taxonomía.",
    ctaLabel: "Explorar selección",
    hrefParams: { occasion: "oficina_business_casual", in_stock: "true" },
    where: Prisma.sql`coalesce(p."occasionTags", array[]::text[]) && array['oficina_business_casual']::text[]`,
  },
  {
    key: "maleta_de_viaje",
    eyebrow: "Descubrir rápido",
    title: "Maleta de viaje",
    description: "Piezas ligeras para calor, escapadas y playa con salida directa a producto.",
    ctaLabel: "Comprar esta edición",
    hrefParams: { occasion: "vacaciones_viaje", in_stock: "true" },
    where: Prisma.sql`coalesce(p."occasionTags", array[]::text[]) && array['vacaciones_viaje','playa_piscina']::text[]`,
  },
  {
    key: "algodon_que_resuelve",
    eyebrow: "Descubrir rápido",
    title: "Algodón que resuelve",
    description: "Básicos cómodos y repetibles para el día a día, respaldados por volumen real.",
    ctaLabel: "Ver ahora",
    hrefParams: { material: "algodon", in_stock: "true" },
    where: Prisma.sql`coalesce(p."materialTags", array[]::text[]) && array['algodon']::text[]`,
  },
  {
    key: "accesorios_para_regalar",
    eyebrow: "Descubrir rápido",
    title: "Accesorios para regalar",
    description: "Una entrada rápida a joyas y detalles con alta variedad de marcas.",
    ctaLabel: "Explorar selección",
    hrefParams: { category: "joyeria_y_bisuteria", in_stock: "true" },
    where: Prisma.sql`${sqlHomeCategoryCase()} = 'joyeria_y_bisuteria'`,
  },
  {
    key: "movimiento_funcional",
    eyebrow: "Descubrir rápido",
    title: "Movimiento funcional",
    description: "Opciones listas para entrenar, moverte y repetir sin perder utilidad.",
    ctaLabel: "Ver ahora",
    hrefParams: { occasion: "deportivo_gym", in_stock: "true" },
    where: Prisma.sql`
      coalesce(p."occasionTags", array[]::text[]) && array['deportivo_gym','running_entrenamiento']::text[]
      or p."stylePrimary" in ('21_gym_funcional','22_athleisure_premium')
    `,
  },
];

type QuickDiscoveryCandidateRow = HomeProductQueryRow & {
  productCount: number | bigint;
  brandCount: number | bigint;
  priceCoverage: number | string | null;
  inventoryRatio: number | string | null;
  freshnessRatio: number | string | null;
  rowRank: number | bigint;
};

function scoreQuickDiscoveryCandidate(input: {
  brandCount: number;
  inventoryRatio: number;
  freshnessRatio: number;
  priceCoverage: number;
}) {
  return (
    clamp01(input.inventoryRatio) * 0.35
    + clamp01(input.freshnessRatio) * 0.25
    + clamp01(input.brandCount / 28) * 0.2
    + clamp01(input.priceCoverage) * 0.2
  );
}

async function getHomeBehaviorSignals(): Promise<HomeBehaviorSignals> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{
          productClicks7d: number | bigint;
          clickedProducts7d: number | bigint;
          favorites30d: number | bigint;
          favoritedProducts30d: number | bigint;
        }>
      >(Prisma.sql`
        with click_stats as (
          select
            count(*)::bigint as "productClicks7d",
            count(distinct ee."productId")::bigint as "clickedProducts7d"
          from "experience_events" ee
          where ee.type = 'product_click'
            and ee."productId" is not null
            and ee."createdAt" >= (now() - interval '7 days')
        ),
        favorite_stats as (
          select
            count(*)::bigint as "favorites30d",
            count(distinct uf."productId")::bigint as "favoritedProducts30d"
          from "user_favorites" uf
          where uf."createdAt" >= (now() - interval '30 days')
        )
        select
          cs."productClicks7d",
          cs."clickedProducts7d",
          fs."favorites30d",
          fs."favoritedProducts30d"
        from click_stats cs
        cross join favorite_stats fs
      `);

      const row = rows[0];
      return {
        productClicks7d: Number(row?.productClicks7d ?? 0),
        clickedProducts7d: Number(row?.clickedProducts7d ?? 0),
        favorites30d: Number(row?.favorites30d ?? 0),
        favoritedProducts30d: Number(row?.favoritedProducts30d ?? 0),
      };
    },
    [`home-v${HOME_CACHE_VERSION}-behavior-signals`],
    { revalidate: 60 * 15, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

async function getQuickDiscoveryCandidate(
  definition: QuickDiscoveryDefinition,
  seed: number,
  excludeIds: string[] = [],
): Promise<(HomeQuickDiscoveryCard & { score: number }) | null> {
  const cached = unstable_cache(
    async () => {
      const pricingContext = await getHomePricingContext();
      const rows = await prisma.$queryRaw<QuickDiscoveryCandidateRow[]>(
        Prisma.sql`
          with matched as (
            select
              p.id,
              p.name,
              p."imageCoverUrl",
              b.name as "brandName",
              b.slug as "brandSlug",
              p.slug,
              p.category,
              p.subcategory,
              p."sourceUrl",
              coalesce(nullif(p.real_style, ''), nullif(p."stylePrimary", '')) as "realStyle",
              case
                when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
                else null
              end as "minPrice",
              p.currency as "sourceCurrency",
              (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
              p."brandId" as brand_id,
              p."updatedAt" as updated_at,
              p."hasInStock" as has_stock
            from products p
            join brands b on b.id = p."brandId"
            where ${sqlIsPublishedCatalogProduct()}
              and (${definition.where})
              ${sqlExcludeProductIds(excludeIds)}
          ),
          stats as (
            select
              count(*)::int as "productCount",
              count(distinct brand_id)::int as "brandCount",
              avg(case when "minPrice" is not null then 1 else 0 end)::numeric as "priceCoverage",
              avg(case when has_stock then 1 else 0 end)::numeric as "inventoryRatio",
              avg(case when updated_at >= (now() - interval '45 days') then 1 else 0 end)::numeric as "freshnessRatio"
            from matched
          ),
          ranked as (
            select
              m.*,
              row_number() over (
                order by
                  case when m.has_stock then 0 else 1 end asc,
                  case when m."minPrice" is null then 1 else 0 end asc,
                  m.updated_at desc nulls last,
                  hashtext(m.id::text || ${seed}::text)
              ) as "rowRank"
            from matched m
          )
          select
            r.id,
            r.name,
            r.slug,
            r."imageCoverUrl",
            r."brandName",
            r."brandSlug",
            r.category,
            r.subcategory,
            r."sourceUrl",
            r."realStyle",
            r."minPrice",
            r."sourceCurrency",
            r."brandOverrideUsd",
            s."productCount",
            s."brandCount",
            s."priceCoverage",
            s."inventoryRatio",
            s."freshnessRatio",
            r."rowRank",
            'COP' as currency
          from ranked r
          cross join stats s
          where s."productCount" >= 500
          order by r."rowRank" asc
          limit 3
        `,
      );

      if (rows.length === 0) return null;
      const productCount = Number(rows[0]?.productCount ?? 0);
      const brandCount = Number(rows[0]?.brandCount ?? 0);
      if (productCount < 500 || brandCount < 3) return null;

      const priceCoverage = clamp01(toFiniteNumber(rows[0]?.priceCoverage));
      const inventoryRatio = clamp01(toFiniteNumber(rows[0]?.inventoryRatio));
      const freshnessRatio = clamp01(toFiniteNumber(rows[0]?.freshnessRatio));
      if (priceCoverage < 0.55) return null;

      const products = mapHomeProductRows(rows, pricingContext);
      return {
        key: definition.key,
        eyebrow: definition.eyebrow,
        title: definition.title,
        description: definition.description,
        href: buildCatalogHref(definition.hrefParams),
        ctaLabel: definition.ctaLabel,
        productCount,
        brandCount,
        products,
        score: scoreQuickDiscoveryCandidate({
          brandCount,
          inventoryRatio,
          freshnessRatio,
          priceCoverage,
        }),
      };
    },
    [`home-v${HOME_CACHE_VERSION}-quick-discovery-${definition.key}-${seed}-${excludeIds.join(",")}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

export async function getQuickDiscoveryCards(
  seed: number,
  options?: {
    limit?: number;
    excludeIds?: string[];
  },
): Promise<HomeQuickDiscoveryCard[]> {
  const limit = options?.limit ?? 4;
  const excludeIds = options?.excludeIds ?? [];
  const cards = await Promise.all(
    QUICK_DISCOVERY_DEFINITIONS.map((definition) =>
      getQuickDiscoveryCandidate(definition, seed, excludeIds),
    ),
  );

  return cards
    .filter((card): card is HomeQuickDiscoveryCard & { score: number } => Boolean(card))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((card) => {
      const next = { ...card } as HomeQuickDiscoveryCard & { score?: number };
      delete next.score;
      return next;
    });
}

type StyleSpotlightQueryRow = HomeProductQueryRow & {
  styleKey: string;
  styleOrder: number | bigint;
  productCount: number | bigint;
  brandCount: number | bigint;
  priceCoverage: number | string | null;
  availabilityRatio: number | string | null;
  freshnessRatio: number | string | null;
  rowRank: number | bigint;
};

export async function getStyleSpotlights(
  seed: number,
  limit = 8,
  config?: HomeConfigMap,
): Promise<HomeStyleSpotlight[]> {
  const configuredStylesRaw = config?.["section.curated_looks.real_styles"];
  let configuredStyles: string[] = [];
  if (configuredStylesRaw) {
    try {
      configuredStyles = JSON.parse(configuredStylesRaw);
      if (!Array.isArray(configuredStyles)) configuredStyles = [];
    } catch {
      configuredStyles = [];
    }
  }

  const cacheKey = `home-v${HOME_CACHE_VERSION}-style-spotlights-${seed}-${limit}-${configuredStyles.join(",")}`;
  const cached = unstable_cache(
    async () => {
      const [pricingContext, taxonomy] = await Promise.all([
        getHomePricingContext(),
        getPublishedTaxonomyOptions(),
      ]);
      const rows = await prisma.$queryRaw<StyleSpotlightQueryRow[]>(
        Prisma.sql`
          with style_base as (
            select
              coalesce(nullif(p.real_style, ''), nullif(p."stylePrimary", '')) as style_key,
              p.id,
              p.name,
              p.slug,
              p."imageCoverUrl",
              b.name as "brandName",
              b.slug as "brandSlug",
              p.category,
              p.subcategory,
              p."sourceUrl",
              case
                when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then p."minPriceCop"
                else null
              end as "minPrice",
              p.currency as "sourceCurrency",
              (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') as "brandOverrideUsd",
              p."brandId" as brand_id,
              p."updatedAt" as updated_at,
              p."hasInStock" as has_stock,
              case when p.real_style is not null and p.real_style <> '' then 1 else 0 end as real_style_priority,
              p."editorialTopPickRank",
              p."editorialFavoriteRank",
              p."random_sort_key"
            from products p
            join brands b on b.id = p."brandId"
            where ${sqlIsPublishedCatalogProduct()}
              and coalesce(nullif(p.real_style, ''), nullif(p."stylePrimary", '')) is not null
          ),
          style_stats as (
            select
              style_key,
              count(*)::int as "productCount",
              count(distinct brand_id)::int as "brandCount",
              avg(case when "minPrice" is not null then 1 else 0 end)::numeric as "priceCoverage",
              avg(case when has_stock then 1 else 0 end)::numeric as "availabilityRatio",
              avg(case when updated_at >= (now() - interval '45 days') then 1 else 0 end)::numeric as "freshnessRatio"
            from style_base
            group by style_key
            having count(*) >= 60
              and count(distinct brand_id) >= 3
              and avg(case when "minPrice" is not null then 1 else 0 end) >= 0.7
          ),
          ranked_styles as (
            select
              ss.style_key,
              ss."productCount",
              ss."brandCount",
              ss."priceCoverage",
              ss."availabilityRatio",
              ss."freshnessRatio",
              row_number() over (
                order by
                  ${
                    configuredStyles.length > 0
                      ? Prisma.sql`case when ss.style_key = any(array[${Prisma.join(configuredStyles)}]::text[]) then 0 else 1 end asc,`
                      : Prisma.empty
                  }
                  (
                    (coalesce(ss."freshnessRatio", 0) * 0.35) +
                    (least(ss."brandCount"::numeric / 18.0, 1) * 0.30) +
                    (coalesce(ss."availabilityRatio", 0) * 0.20) +
                    (coalesce(ss."priceCoverage", 0) * 0.15)
                  ) desc,
                  ss."productCount" desc,
                  ss.style_key asc
              ) as style_order
            from style_stats ss
          ),
          ranked_products as (
            select
              rs.style_key as "styleKey",
              rs.style_order as "styleOrder",
              rs."productCount",
              rs."brandCount",
              rs."priceCoverage",
              rs."availabilityRatio",
              rs."freshnessRatio",
              sb.id,
              sb.name,
              sb.slug,
              sb."imageCoverUrl",
              sb."brandName",
              sb."brandSlug",
              sb.category,
              sb.subcategory,
              sb."sourceUrl",
              sb.style_key as "realStyle",
              sb."minPrice",
              sb."sourceCurrency",
              sb."brandOverrideUsd",
              row_number() over (
                partition by rs.style_key
                order by
                  sb.real_style_priority desc,
                  case when sb.has_stock then 0 else 1 end asc,
                  case when sb."editorialTopPickRank" is not null or sb."editorialFavoriteRank" is not null then 0 else 1 end asc,
                  coalesce(sb."editorialTopPickRank", 999999) asc,
                  coalesce(sb."editorialFavoriteRank", 999999) asc,
                  sb.updated_at desc nulls last,
                  ((sb."random_sort_key" * 1000000 + ${seed + 913})::bigint % 1000000)
              ) as "rowRank"
            from ranked_styles rs
            join style_base sb on sb.style_key = rs.style_key
            where rs.style_order <= ${limit}
          )
          select
            rp."styleKey",
            rp."styleOrder",
            rp."productCount",
            rp."brandCount",
            rp."priceCoverage",
            rp."availabilityRatio",
            rp."freshnessRatio",
            rp.id,
            rp.name,
            rp.slug,
            rp."imageCoverUrl",
            rp."brandName",
            rp."brandSlug",
            rp.category,
            rp.subcategory,
            rp."sourceUrl",
            rp."realStyle",
            rp."minPrice",
            rp."sourceCurrency",
            rp."brandOverrideUsd",
            rp."rowRank",
            'COP' as currency
          from ranked_products rp
          where rp."rowRank" <= ${HOME_STYLE_SPOTLIGHT_PRODUCT_LIMIT}
          order by rp."styleOrder" asc, rp."rowRank" asc
        `,
      );

      const grouped = new Map<
        string,
        {
          styleOrder: number;
          productCount: number;
          brandCount: number;
          products: ProductCard[];
        }
      >();

      for (const row of rows) {
        const styleKey = row.styleKey;
        const product = mapHomeProductRows([row], pricingContext)[0];
        if (!product) continue;

        const bucket = grouped.get(styleKey);
        if (!bucket) {
          grouped.set(styleKey, {
            styleOrder: Number(row.styleOrder ?? 0),
            productCount: Number(row.productCount ?? 0),
            brandCount: Number(row.brandCount ?? 0),
            products: [{ ...product, realStyle: styleKey }],
          });
          continue;
        }
        bucket.products.push({ ...product, realStyle: styleKey });
      }

      return Array.from(grouped.entries())
        .sort((a, b) => a[1].styleOrder - b[1].styleOrder)
        .map(([styleKey, bucket]) => ({
          styleKey,
          label:
            REAL_STYLE_LABELS[styleKey as RealStyleKey]
            ?? taxonomy.styleProfileLabels[styleKey]
            ?? labelize(styleKey),
          href: buildCatalogHref({ style: styleKey, in_stock: "true" }),
          description: `${formatHomeCount(bucket.productCount)} productos de ${bucket.brandCount} marcas`,
          productCount: bucket.productCount,
          brandCount: bucket.brandCount,
          products: bucket.products.slice(0, HOME_STYLE_SPOTLIGHT_PRODUCT_LIMIT),
        }));
    },
    [cacheKey],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

type HomeActionableColorQueryRow = {
  colorId: string;
  family: string;
  label: string;
  hex: string;
  productCount: number | bigint;
  brandCount: number | bigint;
  priceCoverage: number | string | null;
  freshnessRatio: number | string | null;
  imageCoverUrl: string;
};

export async function getActionableColorEntries(
  seed: number,
  limit = 4,
): Promise<HomeActionableColorEntry[]> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<HomeActionableColorQueryRow[]>(
        Prisma.sql`
          with color_products as (
            select distinct on (sc.id, p.id)
              sc.id as "colorId",
              sc.family,
              sc.name as label,
              sc.hex,
              p.id as product_id,
              p."brandId" as brand_id,
              p."imageCoverUrl",
              p."updatedAt" as updated_at,
              case
                when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then 1
                else 0
              end as has_price
            from standard_colors sc
            join variants v on v."standardColorId" = sc.id
            join products p on p.id = v."productId"
            join brands b on b.id = p."brandId"
            where ${sqlIsPublishedCatalogProduct()}
              and v."standardColorId" is not null
            order by sc.id, p.id, p."updatedAt" desc nulls last
          ),
          color_stats as (
            select
              cp."colorId",
              count(*)::int as "productCount",
              count(distinct cp.brand_id)::int as "brandCount",
              avg(cp.has_price)::numeric as "priceCoverage",
              avg(case when cp.updated_at >= (now() - interval '45 days') then 1 else 0 end)::numeric as "freshnessRatio"
            from color_products cp
            group by cp."colorId"
            having count(*) >= 500 and count(distinct cp.brand_id) >= 5
          ),
          ranked_colors as (
            select
              cs."colorId",
              row_number() over (
                order by
                  (
                    least(cs."productCount"::numeric / 2200.0, 1) * 0.45 +
                    least(cs."brandCount"::numeric / 30.0, 1) * 0.25 +
                    coalesce(cs."priceCoverage", 0) * 0.15 +
                    coalesce(cs."freshnessRatio", 0) * 0.15
                  ) desc,
                  cs."productCount" desc,
                  cs."colorId" asc
              ) as color_order
            from color_stats cs
          ),
          hero as (
            select
              cp."colorId",
              cp.family,
              cp.label,
              cp.hex,
              cp."imageCoverUrl",
              row_number() over (
                partition by cp."colorId"
                order by cp.updated_at desc nulls last, hashtext(cp.product_id::text || ${seed}::text)
              ) as hero_rank
            from color_products cp
            join ranked_colors rc on rc."colorId" = cp."colorId"
            where rc.color_order <= ${limit}
          )
          select
            h."colorId",
            h.family,
            h.label,
            h.hex,
            cs."productCount",
            cs."brandCount",
            cs."priceCoverage",
            cs."freshnessRatio",
            h."imageCoverUrl",
            rc.color_order
          from hero h
          join color_stats cs on cs."colorId" = h."colorId"
          join ranked_colors rc on rc."colorId" = h."colorId"
          where h.hero_rank = 1
          order by rc.color_order asc
        `,
      );

      return rows.map((row) => ({
        colorId: row.colorId,
        family: row.family,
        label: row.label,
        hex: row.hex,
        productCount: Number(row.productCount ?? 0),
        brandCount: Number(row.brandCount ?? 0),
        href: buildCatalogHref({ color: row.colorId, in_stock: "true" }),
        imageCoverUrl: row.imageCoverUrl,
      }));
    },
    [`home-v${HOME_CACHE_VERSION}-actionable-colors-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

type BrandFeatureQueryRow = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string;
  heroImageUrl: string | null;
  productCount: number | bigint;
  categoryCount: number | bigint;
  priceCoverage: number | string | null;
  dropShare: number | string | null;
  freshnessRatio: number | string | null;
};

type HomeBrandFeatureSet = {
  spotlight: HomeBrandFeature | null;
  features: HomeBrandFeature[];
};

function toBrandFeature(row: BrandFeatureQueryRow, badge: string, blurb: string): HomeBrandFeature {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: row.logoUrl,
    heroImageUrl: row.heroImageUrl ?? null,
    productCount: Number(row.productCount ?? 0),
    categoryCount: Number(row.categoryCount ?? 0),
    badge,
    blurb,
  };
}

async function getHomeBrandFeatures(seed: number, limit = 3): Promise<HomeBrandFeatureSet> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<BrandFeatureQueryRow[]>(
        Prisma.sql`
          with brand_base as (
            select
              b.id,
              b.slug,
              b.name,
              b."logoUrl",
              p.id as product_id,
              p.category,
              p."imageCoverUrl",
              p."updatedAt" as updated_at,
              case
                when p."minPriceCop" > 0 and p."minPriceCop" <= ${CATALOG_MAX_VALID_PRICE} then 1
                else 0
              end as has_price,
              case when p."priceChangeDirection" = 'down' then 1 else 0 end as has_drop
            from brands b
            join products p on p."brandId" = b.id
            where ${sqlIsPublishedCatalogProduct()}
              and b."logoUrl" is not null
              and trim(b."logoUrl") <> ''
              and b.slug is not null
              and b.slug <> ''
          ),
          brand_stats as (
            select
              bb.id,
              bb.slug,
              bb.name,
              bb."logoUrl",
              count(distinct bb.product_id)::int as "productCount",
              count(distinct case when bb.category is not null and bb.category <> '' then bb.category end)::int as "categoryCount",
              avg(bb.has_price)::numeric as "priceCoverage",
              avg(bb.has_drop)::numeric as "dropShare",
              avg(case when bb.updated_at >= (now() - interval '45 days') then 1 else 0 end)::numeric as "freshnessRatio"
            from brand_base bb
            group by bb.id, bb.slug, bb.name, bb."logoUrl"
            having count(distinct bb.product_id) >= 30
          ),
          brand_hero as (
            select
              bb.id,
              bb."imageCoverUrl" as "heroImageUrl",
              row_number() over (
                partition by bb.id
                order by bb.updated_at desc nulls last, hashtext(bb.product_id::text || ${seed}::text)
              ) as hero_rank
            from brand_base bb
          )
          select
            bs.id,
            bs.slug,
            bs.name,
            bs."logoUrl",
            bh."heroImageUrl",
            bs."productCount",
            bs."categoryCount",
            bs."priceCoverage",
            bs."dropShare",
            bs."freshnessRatio"
          from brand_stats bs
          left join brand_hero bh on bh.id = bs.id and bh.hero_rank = 1
        `,
      );

      if (rows.length === 0) {
        return { spotlight: null, features: [] };
      }

      const spotlightSorted = [...rows].sort((a, b) => {
        const scoreA =
          clamp01(Number(a.productCount ?? 0) / 500) * 0.35
          + clamp01(Number(a.categoryCount ?? 0) / 10) * 0.25
          + clamp01(toFiniteNumber(a.priceCoverage)) * 0.2
          + clamp01(toFiniteNumber(a.freshnessRatio)) * 0.2;
        const scoreB =
          clamp01(Number(b.productCount ?? 0) / 500) * 0.35
          + clamp01(Number(b.categoryCount ?? 0) / 10) * 0.25
          + clamp01(toFiniteNumber(b.priceCoverage)) * 0.2
          + clamp01(toFiniteNumber(b.freshnessRatio)) * 0.2;
        return scoreB - scoreA;
      });

      const spotlightRow = spotlightSorted[0] ?? null;
      const spotlight = spotlightRow
        ? toBrandFeature(
            spotlightRow,
            "Marca destacada",
            `${formatHomeCount(Number(spotlightRow.productCount ?? 0))} productos y ${formatHomeCount(Number(spotlightRow.categoryCount ?? 0))} categorías activas.`,
          )
        : null;

      const used = new Set<string>(spotlightRow ? [spotlightRow.id] : []);
      const features: HomeBrandFeature[] = [];
      const pick = (
        source: BrandFeatureQueryRow[],
        badge: string,
        blurbFactory: (row: BrandFeatureQueryRow) => string,
      ) => {
        const row = source.find((candidate) => !used.has(candidate.id));
        if (!row) return;
        used.add(row.id);
        features.push(toBrandFeature(row, badge, blurbFactory(row)));
      };

      pick(
        [...rows].sort((a, b) => clamp01(toFiniteNumber(b.dropShare)) - clamp01(toFiniteNumber(a.dropShare))),
        "En rebaja",
        (row) => `${Math.round(clamp01(toFiniteNumber(row.dropShare)) * 100)}% del mix reciente con descuentos activos.`,
      );
      pick(
        [...rows].sort((a, b) => Number(b.categoryCount ?? 0) - Number(a.categoryCount ?? 0)),
        "Más variedad",
        (row) => `${formatHomeCount(Number(row.categoryCount ?? 0))} categorías para entrar por intención y no por logo.`,
      );
      pick(
        [...rows].sort((a, b) => clamp01(toFiniteNumber(b.priceCoverage)) - clamp01(toFiniteNumber(a.priceCoverage))),
        "Cobertura fuerte",
        (row) => `${Math.round(clamp01(toFiniteNumber(row.priceCoverage)) * 100)}% de precio visible sobre el catálogo elegible.`,
      );
      pick(
        [...rows].sort((a, b) => clamp01(toFiniteNumber(b.freshnessRatio)) - clamp01(toFiniteNumber(a.freshnessRatio))),
        "Nueva energía",
        (row) => `${Math.round(clamp01(toFiniteNumber(row.freshnessRatio)) * 100)}% del catálogo actualizado en las últimas semanas.`,
      );

      return {
        spotlight,
        features: features.slice(0, limit),
      };
    },
    [`home-v${HOME_CACHE_VERSION}-brand-features-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

function buildHomeTrustStrip(stats: HomeCoverageStats | null): HomeTrustStrip {
  const safeStats: HomeCoverageStats = {
    productCount: stats?.productCount ?? 0,
    brandCount: stats?.brandCount ?? 0,
    categoryCount: stats?.categoryCount ?? 0,
    lastUpdatedAt: stats?.lastUpdatedAt ?? null,
  };

  const lastUpdated = safeStats.lastUpdatedAt
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(safeStats.lastUpdatedAt))
    : null;

  return {
    eyebrow: "Confianza ODA",
    badge: lastUpdated ? `Actualizado ${lastUpdated}` : "Catálogo vivo",
    items: [
      {
        label: "Productos activos",
        value: formatHomeCount(safeStats.productCount),
        hint: "Con salida a tienda oficial",
      },
      {
        label: "Marcas colombianas",
        value: formatHomeCount(safeStats.brandCount),
        hint: "Catálogo agregado en un solo lugar",
      },
      {
        label: "Categorías navegables",
        value: formatHomeCount(safeStats.categoryCount),
        hint: "Exploración útil antes que decoración",
      },
    ],
  };
}

function normalizeUtilityDefaultTab(value: string | null | undefined): HomeUtilityTab["key"] {
  if (value === "favorites" || value === "new_with_stock") return "new_with_stock";
  if (value === "trending" || value === "momentum") return "momentum";
  return "price_drops";
}

function toMomentumCards(products: ProductCard[]): HomeTrendingDailyCardData[] {
  return products.map((product) => ({
    ...product,
    clickCount: 0,
    snapshotDate: null,
  }));
}

export async function getHomePagePayload(input: {
  seed: number;
  heroIds?: string[];
  config?: HomeConfigMap;
}): Promise<HomePagePayload> {
  const { seed, heroIds = [], config } = input;
  const registry = createHomeSelectionRegistry(heroIds);
  const newArrivalsLimit = getHomeConfigInt(config ?? {}, "section.new_arrivals.limit");

  const [
    categoryHighlightsResult,
    coverageStats,
    newArrivalsResult,
    priceDropResult,
    dailyTrendingResult,
    mostFavoritedRaw,
    quickDiscoveryRaw,
    styleSpotlightsRaw,
    actionableColorsRaw,
    brandFeatureSet,
    storyPoolRaw,
    behaviorSignals,
  ] = await Promise.all([
    getResilientCategoryHighlights(seed, { limit: 6, preferBlob: true }),
    withTimeout(getHomeCoverageStats(), null),
    getResilientNewArrivals(seed, { limit: Math.max(18, newArrivalsLimit * 2) }),
    getResilientPriceDropPicks(seed, {
      limit: HOME_UTILITY_TAB_PRODUCT_LIMIT * 12,
      excludeIds: Array.from(registry.usedIds),
    }),
    getResilientDailyTrendingPicks(seed, {
      limit: HOME_UTILITY_TAB_PRODUCT_LIMIT * 2,
      excludeIds: Array.from(registry.usedIds),
    }),
    withTimeout(
      getMostFavoritedPicks(seed, {
        windowDays: 30,
        limit: HOME_UTILITY_TAB_PRODUCT_LIMIT * 2,
        excludeIds: Array.from(registry.usedIds),
      }),
      [],
    ),
    getQuickDiscoveryCards(seed, { limit: 4, excludeIds: Array.from(registry.usedIds) }),
    getStyleSpotlights(seed, 8, config),
    withTimeout(getActionableColorEntries(seed, 4), []),
    withTimeout(getHomeBrandFeatures(seed, 3), { spotlight: null, features: [] }),
    withTimeout(getTrendingPicks(seed + 19, 24), []),
    withTimeout(getHomeBehaviorSignals(), {
      productClicks7d: 0,
      clickedProducts7d: 0,
      favorites30d: 0,
      favoritedProducts30d: 0,
    }),
  ]);

  const quickDiscovery = quickDiscoveryRaw
    .map((card) => ({
      ...card,
      products: collectUniqueProducts(card.products, registry, 3),
    }))
    .filter((card) => card.products.length >= 2);

  const utilityRegistry = createHomeSelectionRegistry();
  const priceDropProducts = limitItemsPerBrand(priceDropResult.items, HOME_UTILITY_TAB_PRODUCT_LIMIT, 2);
  const priceDropTabProducts = collectUniqueProducts(
    priceDropProducts,
    utilityRegistry,
    HOME_UTILITY_TAB_PRODUCT_LIMIT,
  );

  const newWithStockPool = newArrivalsResult.items.filter((item) => item.minPrice && Number(item.minPrice) > 0);
  const newWithStockProducts = collectUniqueProducts(
    newWithStockPool,
    utilityRegistry,
    HOME_UTILITY_TAB_PRODUCT_LIMIT,
  );

  const behaviorQualified =
    behaviorSignals.productClicks7d >= 100 && behaviorSignals.clickedProducts7d >= 60;
  const momentumPool = behaviorQualified
    ? dailyTrendingResult.items
    : toMomentumCards(
        collectUniqueProducts(
          [
            ...mostFavoritedRaw,
            ...newArrivalsResult.items,
            ...storyPoolRaw,
          ],
          createHomeSelectionRegistry(Array.from(utilityRegistry.usedIds)),
          HOME_UTILITY_TAB_PRODUCT_LIMIT * 2,
        ),
      );

  const momentumProducts = collectUniqueProducts(
    behaviorQualified ? dailyTrendingResult.items : momentumPool,
    utilityRegistry,
    HOME_UTILITY_TAB_PRODUCT_LIMIT,
  );
  const momentumSnapshotDate = behaviorQualified
    ? momentumProducts.find((item) => item.snapshotDate)?.snapshotDate ?? null
    : null;

  const utilityTabsBase: HomeUtilityTab[] = [
    {
      key: "price_drops",
      label: "Rebajas reales",
      heading: "Rebajas reales",
      description: "Descuentos con mezcla de marcas, no una sola marca repitiéndose en fila.",
      kind: "price_drop",
      products: priceDropTabProducts,
    },
    {
      key: "new_with_stock",
      label: "Nuevos con stock",
      heading: "Nuevos con stock",
      description: "Lo más reciente que ya puedes comprar sin encontrar producto agotado.",
      kind: "product",
      products: newWithStockProducts,
    },
    {
      key: "momentum",
      label: behaviorQualified ? "Moviéndose hoy" : "Descubriendo ahora",
      heading: behaviorQualified ? "Moviéndose hoy" : "Descubriendo ahora",
      description: behaviorQualified
        ? "Lectura real de movimiento reciente con suficiente señal conductual."
        : "Mezcla útil de frescura, guardados y variedad mientras la señal social crece.",
      kind: "momentum",
      products: momentumProducts,
      behaviorQualified,
      snapshotDate: momentumSnapshotDate,
    },
  ];
  const utilityTabs = utilityTabsBase.filter((tab) => tab.products.length > 0);
  for (const tab of utilityTabs) {
    for (const product of tab.products) {
      if (product?.id) registry.usedIds.add(product.id);
    }
  }

  const newArrivals = collectUniqueProducts(newArrivalsResult.items, registry, newArrivalsLimit);

  const styleSpotlights = styleSpotlightsRaw
    .map((spotlight) => ({
      ...spotlight,
      products: collectUniqueProducts(spotlight.products, registry, HOME_STYLE_SPOTLIGHT_PRODUCT_LIMIT),
    }))
    .filter((spotlight) => spotlight.products.length > 0);

  const storyProduct =
    collectUniqueProducts(
      [...storyPoolRaw, ...mostFavoritedRaw, ...newArrivalsResult.items],
      registry,
      1,
    )[0]
    ?? null;

  const criticalSections = {
    quickDiscovery: quickDiscovery.length,
    utilityTabs: utilityTabs.length,
    newArrivals: newArrivals.length,
  };

  if ((coverageStats?.productCount ?? 0) > 0 && Object.values(criticalSections).some((count) => count === 0)) {
    console.error("home.guard.redesign_core_empty", {
      seed,
      coverage: coverageStats?.productCount ?? 0,
      criticalSections,
    });
    throw new Error("HOME_REDESIGN_CORE_EMPTY");
  }

  return {
    quickDiscovery,
    utilityTabs,
    defaultUtilityTab: normalizeUtilityDefaultTab(
      config?.["section.smart_rails.default_tab"] ?? HOME_CONFIG_DEFAULTS["section.smart_rails.default_tab"],
    ),
    newArrivals,
    categories: categoryHighlightsResult.items.slice(0, 6),
    colors: actionableColorsRaw,
    brandSpotlight: brandFeatureSet.spotlight,
    brandFeatures: brandFeatureSet.features,
    styleSpotlights,
    trustStrip: buildHomeTrustStrip(coverageStats),
    storyProduct,
    coverageStats,
  };
}
