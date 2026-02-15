import "server-only";

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { labelize, labelizeSubcategory, normalizeGender, type GenderKey } from "@/lib/navigation";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";
import type { TaxonomyOptions } from "@/lib/taxonomy/types";
import {
  buildOrderBy,
  buildProductConditions,
  buildVariantConditions,
  buildWhere,
  type CatalogFilters,
} from "@/lib/catalog-query";

const CATALOG_REVALIDATE_SECONDS = 60 * 30;
// Products can change frequently (stock/price), but we still want to avoid DB spikes on filters.
// Keep this short so the catalog stays fresh while being resilient.
const CATALOG_PRODUCTS_REVALIDATE_SECONDS = 60;
export const CATALOG_PAGE_SIZE = 24;
// Bump to invalidate `unstable_cache` entries when query semantics change (e.g. category canonicalization).
const CATALOG_CACHE_VERSION = 4;

// Canonicalize legacy category keys at query time so facets/filters stay consistent without rewriting the DB.
const CATEGORY_CANON_EXPR = Prisma.sql`
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

export type CatalogStats = {
  brandCount: number;
  productCount: number;
  variantCount: number;
  colorCount: number;
  comboCount: number;
};

export type CatalogFacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
  group?: string | null;
  // Solo aplica a `subcategories` por ahora: permite renderizar chips con imagen representativa.
  previewImageUrl?: string | null;
  previewProductId?: string | null;
};

export type CatalogFacets = {
  categories: CatalogFacetItem[];
  genders: CatalogFacetItem[];
  brands: CatalogFacetItem[];
  colors: CatalogFacetItem[];
  sizes: CatalogFacetItem[];
  fits: CatalogFacetItem[];
  materials: CatalogFacetItem[];
  patterns: CatalogFacetItem[];
  occasions: CatalogFacetItem[];
  seasons: CatalogFacetItem[];
  styles: CatalogFacetItem[];
};

export type CatalogFacetsLite = Pick<
  CatalogFacets,
  "categories" | "genders" | "brands" | "colors" | "materials" | "patterns"
>;

export type { CatalogFilters };

export type CatalogProduct = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brandName: string;
  sourceUrl: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
};

export type CatalogProductResult = {
  items: CatalogProduct[];
  totalCount: number;
};

export type CatalogProductPageResult = {
  items: CatalogProduct[];
  pageSize: number;
};

export type CatalogPriceBounds = {
  min: number | null;
  max: number | null;
};

export type CatalogPriceHistogram = {
  bucketCount: number;
  buckets: number[];
};

export type CatalogPriceStats = {
  count: number;
  min: number;
  max: number;
  p02: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p98: number | null;
};

export type CatalogPriceInsights = {
  bounds: CatalogPriceBounds;
  histogram: CatalogPriceHistogram | null;
  stats: CatalogPriceStats | null;
};

function normalizeArray(values?: string[]) {
  if (!values || values.length === 0) return undefined;
  return Array.from(new Set(values)).sort();
}

function normalizePriceRanges(ranges?: Array<{ min?: number; max?: number }>) {
  if (!ranges || ranges.length === 0) return undefined;
  const tokens = ranges
    .map((range) => {
      const min = typeof range.min === "number" && Number.isFinite(range.min) ? Math.floor(range.min) : null;
      const max = typeof range.max === "number" && Number.isFinite(range.max) ? Math.floor(range.max) : null;
      if (min === null && max === null) return null;
      if (min !== null && max !== null && max < min) return null;
      return `${min ?? ""}:${max ?? ""}`;
    })
    .filter((token): token is string => Boolean(token));
  if (tokens.length === 0) return undefined;
  return Array.from(new Set(tokens)).sort();
}

function buildFacetsCacheKey(filters: CatalogFilters) {
  const key: Record<string, unknown> = {};
  if (filters.q) key.q = filters.q.toLowerCase();
  if (filters.categories?.length) key.categories = normalizeArray(filters.categories);
  if (filters.subcategories?.length) key.subcategories = normalizeArray(filters.subcategories);
  if (filters.genders?.length) key.genders = normalizeArray(filters.genders);
  if (filters.brandIds?.length) key.brandIds = normalizeArray(filters.brandIds);
  if (filters.colors?.length) key.colors = normalizeArray(filters.colors);
  if (filters.sizes?.length) key.sizes = normalizeArray(filters.sizes);
  if (filters.fits?.length) key.fits = normalizeArray(filters.fits);
  if (filters.materials?.length) key.materials = normalizeArray(filters.materials);
  if (filters.patterns?.length) key.patterns = normalizeArray(filters.patterns);
  if (filters.occasions?.length) key.occasions = normalizeArray(filters.occasions);
  if (filters.seasons?.length) key.seasons = normalizeArray(filters.seasons);
  if (filters.styles?.length) key.styles = normalizeArray(filters.styles);
  const priceRanges = normalizePriceRanges(filters.priceRanges);
  if (priceRanges) {
    key.priceRanges = priceRanges;
  } else {
    if (filters.priceMin !== undefined) key.priceMin = filters.priceMin;
    if (filters.priceMax !== undefined) key.priceMax = filters.priceMax;
  }
  if (filters.inStock) key.inStock = 1;
  if (filters.enrichedOnly) key.enrichedOnly = 1;
  return JSON.stringify(key);
}

function getPriceStep(max: number) {
  if (!Number.isFinite(max) || max <= 0) return 1000;
  if (max <= 200_000) return 1000;
  if (max <= 900_000) return 5000;
  return 10_000;
}

function omitFilters(filters: CatalogFilters, keys: (keyof CatalogFilters)[]): CatalogFilters {
  const next: CatalogFilters = { ...filters };
  for (const key of keys) {
    next[key] = undefined;
  }
  return next;
}

function buildProductWhere(filters: CatalogFilters) {
  const conditions = buildProductConditions(filters);
  return Prisma.sql`where ${Prisma.join(conditions, " and ")}`;
}

function buildVariantWhere(filters: CatalogFilters) {
  const productWhere = buildProductWhere(filters);
  const variantConditions = buildVariantConditions(filters);
  const variantWhere =
    variantConditions.length > 0
      ? Prisma.sql`and ${Prisma.join(variantConditions, " and ")}`
      : Prisma.empty;
  return { productWhere, variantWhere };
}


export async function getCatalogStats(): Promise<CatalogStats> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{
          brand_count: bigint;
          product_count: bigint;
          variant_count: bigint;
          color_count: bigint;
          combo_count: bigint;
        }>
      >(
        Prisma.sql`
          select
            (select count(*) from brands) as brand_count,
            (select count(*) from products) as product_count,
            (select count(*) from variants) as variant_count,
            (select count(distinct color) from variants where color is not null and btrim(color) <> '') as color_count,
            (select count(*) from color_combinations) as combo_count
        `
      );
      const row = rows[0];
      return {
        brandCount: Number(row?.brand_count ?? 0),
        productCount: Number(row?.product_count ?? 0),
        variantCount: Number(row?.variant_count ?? 0),
        colorCount: Number(row?.color_count ?? 0),
        comboCount: Number(row?.combo_count ?? 0),
      };
    },
    ["catalog-stats", `cache-v${CATALOG_CACHE_VERSION}`],
    { revalidate: CATALOG_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getCatalogFacets(filters: CatalogFilters): Promise<CatalogFacets> {
  const taxonomy = await getPublishedTaxonomyOptions();
  const cacheKey = buildFacetsCacheKey(filters);
  const cached = unstable_cache(
    async () => computeCatalogFacets(filters, taxonomy),
    ["catalog-facets", `cache-v${CATALOG_CACHE_VERSION}`, `taxonomy-v${taxonomy.version}`, cacheKey],
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );

  return cached();
}

export async function getCatalogFacetsLite(filters: CatalogFilters): Promise<CatalogFacetsLite> {
  const taxonomy = await getPublishedTaxonomyOptions();
  const cacheKey = buildFacetsCacheKey(filters);
  const cached = unstable_cache(
    async () => computeCatalogFacetsLite(filters, taxonomy),
    ["catalog-facets-lite", `cache-v${CATALOG_CACHE_VERSION}`, `taxonomy-v${taxonomy.version}`, cacheKey],
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );

  return cached();
}

export async function getCatalogFacetsStatic(): Promise<CatalogFacetsLite> {
  const taxonomy = await getPublishedTaxonomyOptions();
  const cached = unstable_cache(
    async () => {
      const [brands, colors] = await Promise.all([
        prisma.brand.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.standardColor.findMany({
          select: { id: true, family: true, name: true, hex: true },
          orderBy: [{ family: "asc" }, { name: "asc" }],
        }),
      ]);

      const categories = (taxonomy.data.categories ?? [])
        .filter((entry) => entry && entry.isActive !== false)
        .map((entry) => ({
          value: entry.key,
          label: taxonomy.categoryLabels[entry.key] ?? labelize(entry.key),
          count: 1,
        }));

      const materials = (taxonomy.data.materials ?? [])
        .filter((entry) => entry && entry.isActive !== false)
        .map((entry) => ({
          value: entry.key,
          label: taxonomy.materialLabels[entry.key] ?? labelize(entry.key),
          count: 1,
        }));

      const patterns = (taxonomy.data.patterns ?? [])
        .filter((entry) => entry && entry.isActive !== false)
        .map((entry) => ({
          value: entry.key,
          label: taxonomy.patternLabels[entry.key] ?? labelize(entry.key),
          count: 1,
        }));

      return {
        categories,
        genders: (["Femenino", "Masculino", "Unisex", "Infantil"] as GenderKey[]).map((gender) => ({
          value: gender,
          label: gender,
          count: 1,
        })),
        brands: brands.map((row) => ({ value: row.id, label: row.name, count: 1 })),
        colors: colors.map((row) => ({
          value: row.id,
          label: row.name,
          count: 1,
          swatch: row.hex,
          group: row.family,
        })),
        materials,
        patterns,
      };
    },
    ["catalog-facets-static", `cache-v${CATALOG_CACHE_VERSION}`, `taxonomy-v${taxonomy.version}`],
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );

  return cached();
}

export async function getCatalogSubcategories(filters: CatalogFilters): Promise<CatalogFacetItem[]> {
  if (!filters.categories || filters.categories.length === 0) {
    return [];
  }
  const taxonomy = await getPublishedTaxonomyOptions();
  const cacheKey = buildFacetsCacheKey(filters);
  const cached = unstable_cache(
    async () => computeCatalogSubcategories(filters, taxonomy),
    ["catalog-subcategories", `cache-v${CATALOG_CACHE_VERSION}`, `taxonomy-v${taxonomy.version}`, cacheKey],
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );

  return cached();
}

export async function getCatalogPriceBounds(filters: CatalogFilters): Promise<CatalogPriceBounds> {
  // El slider debe mostrar el rango disponible segun filtros (pero sin que el propio rango limite el dominio).
  const boundsFilters = omitFilters(filters, ["priceMin", "priceMax", "priceRanges"]);
  const cacheKey = buildFacetsCacheKey(boundsFilters);
  const cached = unstable_cache(
    async () => {
      const { productWhere, variantWhere } = buildVariantWhere(boundsFilters);
      const rows = await prisma.$queryRaw<Array<{ min_price: string | null; max_price: string | null }>>(
        Prisma.sql`
          select
            min(v.price) as min_price,
            max(v.price) as max_price
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
          ${productWhere}
          ${variantWhere}
          and v.price > 0
        `,
      );
      const row = rows[0];
      const min = row?.min_price ? Number(row.min_price) : null;
      const max = row?.max_price ? Number(row.max_price) : null;
      return {
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
      };
    },
    ["catalog-price-bounds", `cache-v${CATALOG_CACHE_VERSION}`, cacheKey],
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );

  return cached();
}

export async function getCatalogPriceInsights(
  filters: CatalogFilters,
  bucketCount?: number,
): Promise<CatalogPriceInsights> {
  const boundsFilters = omitFilters(filters, ["priceMin", "priceMax", "priceRanges"]);
  const requestedBucketCount =
    typeof bucketCount === "number" && Number.isFinite(bucketCount) && bucketCount >= 6
      ? Math.round(bucketCount)
      : null;
  const bucketKey = requestedBucketCount ? String(requestedBucketCount) : "auto";
  const cacheKey = `${buildFacetsCacheKey(boundsFilters)}::buckets:${bucketKey}`;
  const cached = unstable_cache(
    async () => {
      const { productWhere, variantWhere } = buildVariantWhere(boundsFilters);

      const statsRows = await prisma.$queryRaw<
        Array<{
          n: bigint;
          min_price: string | null;
          max_price: string | null;
          p02: string | null;
          p25: string | null;
          p50: string | null;
          p75: string | null;
          p98: string | null;
        }>
      >(Prisma.sql`
        with prices as (
          select v.price as price
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
          ${productWhere}
          ${variantWhere}
          and v.price > 0
        )
        select
          count(*) as n,
          min(price) as min_price,
          max(price) as max_price,
          percentile_cont(0.02) within group (order by price) as p02,
          percentile_cont(0.25) within group (order by price) as p25,
          percentile_cont(0.50) within group (order by price) as p50,
          percentile_cont(0.75) within group (order by price) as p75,
          percentile_cont(0.98) within group (order by price) as p98
        from prices
      `);
      const row = statsRows[0];

      const count = Number(row?.n ?? 0);
      const minHard = row?.min_price ? Number(row.min_price) : null;
      const maxHard = row?.max_price ? Number(row.max_price) : null;
      const p02 = row?.p02 ? Number(row.p02) : null;
      const p25 = row?.p25 ? Number(row.p25) : null;
      const p50 = row?.p50 ? Number(row.p50) : null;
      const p75 = row?.p75 ? Number(row.p75) : null;
      const p98 = row?.p98 ? Number(row.p98) : null;

      const hardOk =
        typeof minHard === "number" &&
        typeof maxHard === "number" &&
        Number.isFinite(minHard) &&
        Number.isFinite(maxHard) &&
        maxHard > minHard;

      const stats: CatalogPriceStats | null = hardOk
        ? {
            count,
            min: minHard,
            max: maxHard,
            p02: typeof p02 === "number" && Number.isFinite(p02) ? p02 : null,
            p25: typeof p25 === "number" && Number.isFinite(p25) ? p25 : null,
            p50: typeof p50 === "number" && Number.isFinite(p50) ? p50 : null,
            p75: typeof p75 === "number" && Number.isFinite(p75) ? p75 : null,
            p98: typeof p98 === "number" && Number.isFinite(p98) ? p98 : null,
          }
        : null;

      let min = hardOk ? minHard : null;
      let max = hardOk ? maxHard : null;

      const robustOk =
        hardOk &&
        count >= 30 &&
        typeof p02 === "number" &&
        typeof p98 === "number" &&
        Number.isFinite(p02) &&
        Number.isFinite(p98) &&
        p98 > p02;

      // Dominio robusto: evita que outliers dominen el rango/histograma.
      if (robustOk) {
        min = Math.max(minHard!, p02);
        max = Math.min(maxHard!, p98);
      }

      // Alinea el rango a pasos “humanos” para que el slider no muestre números raros.
      if (hardOk && typeof min === "number" && typeof max === "number") {
        const step = getPriceStep(max);
        const alignedMin = Math.max(0, Math.floor(min / step) * step);
        const alignedMax = Math.ceil(max / step) * step;
        min = alignedMin;
        max = alignedMax > alignedMin ? alignedMax : alignedMin + step;
      }

      const bounds: CatalogPriceBounds = {
        min: typeof min === "number" && Number.isFinite(min) ? min : null,
        max: typeof max === "number" && Number.isFinite(max) ? max : null,
      };

      const autoBucketCount = (input: { stats: CatalogPriceStats | null; bounds: CatalogPriceBounds }) => {
        // Buenas prácticas: Freedman–Diaconis con IQR cuando hay suficientes datos.
        // Con pocos datos o IQR inválido, caemos a un bucketCount estable para evitar UI inestable.
        const DEFAULT = 18;
        const { stats, bounds } = input;
        if (!stats) return DEFAULT;
        if (stats.count < 60) return DEFAULT;
        if (typeof bounds.min !== "number" || typeof bounds.max !== "number") return DEFAULT;
        const range = bounds.max - bounds.min;
        if (!Number.isFinite(range) || range <= 0) return DEFAULT;
        const p25 = stats.p25;
        const p75 = stats.p75;
        if (typeof p25 !== "number" || typeof p75 !== "number") return DEFAULT;
        const iqr = p75 - p25;
        if (!Number.isFinite(iqr) || iqr <= 0) return DEFAULT;
        const denom = Math.cbrt(stats.count);
        if (!Number.isFinite(denom) || denom <= 0) return DEFAULT;
        const binWidth = (2 * iqr) / denom;
        if (!Number.isFinite(binWidth) || binWidth <= 0) return DEFAULT;
        const raw = Math.round(range / binWidth);
        // Clamp para que el histograma siga siendo legible y barato de computar.
        return Math.max(12, Math.min(28, raw || DEFAULT));
      };

      const resolvedBucketCount = requestedBucketCount ?? autoBucketCount({ stats, bounds });

      const histogramRangeOk =
        typeof bounds.min === "number" &&
        typeof bounds.max === "number" &&
        Number.isFinite(bounds.min) &&
        Number.isFinite(bounds.max) &&
        bounds.max > bounds.min;

      if (!histogramRangeOk || resolvedBucketCount < 6) {
        return { bounds, histogram: null, stats };
      }

      const rows = await prisma.$queryRaw<Array<{ bucket: number; cnt: bigint }>>(Prisma.sql`
        with prices as (
          select v.price as price
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
          ${productWhere}
          ${variantWhere}
          and v.price > 0
        )
        select
          least(${resolvedBucketCount}, greatest(1, width_bucket(price, ${bounds.min}, ${bounds.max}, ${resolvedBucketCount}))) as bucket,
          count(*) as cnt
        from prices
        group by 1
        order by 1 asc
      `);

      const buckets = Array.from({ length: resolvedBucketCount }, () => 0);
      for (const row of rows) {
        const index = Math.max(0, Math.min(resolvedBucketCount - 1, Number(row.bucket) - 1));
        buckets[index] = Number(row.cnt ?? 0);
      }

      return {
        bounds,
        histogram: { bucketCount: resolvedBucketCount, buckets },
        stats,
      };
    },
    ["catalog-price-insights", `cache-v${CATALOG_CACHE_VERSION}`, cacheKey],
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );

  return cached();
}

async function computeCatalogFacets(filters: CatalogFilters, taxonomy: TaxonomyOptions): Promise<CatalogFacets> {
  const categoryFilters = omitFilters(filters, ["categories"]);
  const genderFilters = omitFilters(filters, ["genders"]);
  const brandFilters = omitFilters(filters, ["brandIds"]);
  const colorFilters = omitFilters(filters, ["colors"]);
  const sizeFilters = omitFilters(filters, ["sizes"]);
  const fitFilters = omitFilters(filters, ["fits"]);
  const materialFilters = omitFilters(filters, ["materials"]);
  const patternFilters = omitFilters(filters, ["patterns"]);
  const occasionFilters = omitFilters(filters, ["occasions"]);
  const seasonFilters = omitFilters(filters, ["seasons"]);
  const styleFilters = omitFilters(filters, ["styles"]);

  const categoryWhere = buildWhere(categoryFilters);
  const genderWhere = buildWhere(genderFilters);
  const brandWhere = buildWhere(brandFilters);
  const materialWhere = buildWhere(materialFilters);
  const patternWhere = buildWhere(patternFilters);
  const occasionWhere = buildWhere(occasionFilters);
  const seasonWhere = buildWhere(seasonFilters);
  const styleWhere = buildWhere(styleFilters);

  const { productWhere: colorProductWhere, variantWhere: colorVariantWhere } =
    buildVariantWhere(colorFilters);
  const { productWhere: sizeProductWhere, variantWhere: sizeVariantWhere } =
    buildVariantWhere(sizeFilters);
  const { productWhere: fitProductWhere, variantWhere: fitVariantWhere } =
    buildVariantWhere(fitFilters);

  const [
    categories,
    genders,
    brands,
    colors,
    sizes,
    fits,
    materials,
    patterns,
    occasions,
    seasons,
    styles,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ category: string; cnt: bigint }>>(Prisma.sql`
      select
        ${CATEGORY_CANON_EXPR} as category,
        count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${categoryWhere}
      and p.category is not null and p.category <> ''
      group by 1
      order by cnt desc
    `),
    prisma.$queryRaw<Array<{ gender: string | null; cnt: bigint }>>(Prisma.sql`
      select p.gender as gender, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${genderWhere}
      group by p.gender
      order by cnt desc
    `),
    prisma.$queryRaw<Array<{ id: string; name: string; cnt: bigint }>>(Prisma.sql`
      select b.id, b.name, count(p.id) as cnt
      from brands b
      join products p on p."brandId" = b.id
      ${brandWhere}
      group by b.id, b.name
      order by cnt desc
    `),
    prisma.$queryRaw<Array<{ id: string; family: string; name: string; hex: string; cnt: bigint }>>(Prisma.sql`
      with color_counts as (
        select v."standardColorId" as id, count(*) as cnt
        from products p
        join brands b on b.id = p."brandId"
        join variants v on v."productId" = p.id
        ${colorProductWhere}
        ${colorVariantWhere}
        and v."standardColorId" is not null
        group by v."standardColorId"
      )
      select sc.id, sc.family, sc.name, sc.hex, coalesce(cc.cnt, 0) as cnt
      from standard_colors sc
      left join color_counts cc on cc.id = sc.id
      order by sc.family asc, sc.name asc
    `),
    prisma.$queryRaw<Array<{ size: string; cnt: bigint }>>(Prisma.sql`
      select v.size as size, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      join variants v on v."productId" = p.id
      ${sizeProductWhere}
      ${sizeVariantWhere}
      and v.size is not null and btrim(v.size) <> ''
      group by v.size
      order by cnt desc
      limit 18
    `),
    prisma.$queryRaw<Array<{ fit: string; cnt: bigint }>>(Prisma.sql`
      select v.fit as fit, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      join variants v on v."productId" = p.id
      ${fitProductWhere}
      ${fitVariantWhere}
      and v.fit is not null and btrim(v.fit) <> ''
      group by v.fit
      order by cnt desc
      limit 12
    `),
    prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."materialTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${materialWhere}
      ) t
      where tag is not null and tag <> ''
      group by tag
      order by cnt desc
      limit 12
    `),
    prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."patternTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${patternWhere}
      ) t
      where tag is not null and tag <> ''
      group by tag
      order by cnt desc
      limit 12
    `),
    prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."occasionTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${occasionWhere}
      ) t
      where tag is not null and tag <> ''
      group by tag
      order by cnt desc
      limit 12
    `),
    prisma.$queryRaw<Array<{ season: string; cnt: bigint }>>(Prisma.sql`
      select p.season as season, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${seasonWhere}
      and p.season is not null and p.season <> ''
      group by p.season
      order by cnt desc
      limit 10
    `),
    prisma.$queryRaw<Array<{ style: string; cnt: bigint }>>(Prisma.sql`
      select p."stylePrimary" as style, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${styleWhere}
      and p."stylePrimary" is not null and p."stylePrimary" <> ''
      group by p."stylePrimary"
      order by cnt desc
      limit 10
    `),
  ]);

  const genderCounts = new Map<GenderKey, number>();
  for (const row of genders) {
    const gender = normalizeGender(row.gender);
    genderCounts.set(gender, (genderCounts.get(gender) ?? 0) + Number(row.cnt));
  }

  const labelCategory = (value: string) => taxonomy.categoryLabels[value] ?? labelize(value);
  const labelMaterial = (value: string) => taxonomy.materialLabels[value] ?? labelize(value);
  const labelPattern = (value: string) => taxonomy.patternLabels[value] ?? labelize(value);
  const labelOccasion = (value: string) => taxonomy.occasionLabels[value] ?? labelize(value);
  const labelStyleProfile = (value: string) => taxonomy.styleProfileLabels[value] ?? labelize(value);

  const categoryItems = categories.map((row) => ({
    value: row.category,
    label: labelCategory(row.category),
    count: Number(row.cnt),
  }));
  const brandItems = brands.map((row) => ({
    value: row.id,
    label: row.name,
    count: Number(row.cnt),
  }));
  const selectedColors = new Set(filters.colors ?? []);
  const colorItems = colors
    .map((row) => ({
      value: row.id,
      label: row.name,
      count: Number(row.cnt),
      swatch: row.hex,
      group: row.family,
    }))
    .filter((item) => item.count > 0 || selectedColors.has(item.value));
  const sizeItems = sizes.map((row) => ({
    value: row.size,
    label: row.size,
    count: Number(row.cnt),
  }));
  const fitItems = fits.map((row) => ({
    value: row.fit,
    label: row.fit,
    count: Number(row.cnt),
  }));
  const materialItems = materials.map((row) => ({
    value: row.tag,
    label: labelMaterial(row.tag),
    count: Number(row.cnt),
  }));
  const patternItems = patterns.map((row) => ({
    value: row.tag,
    label: labelPattern(row.tag),
    count: Number(row.cnt),
  }));
  const occasionItems = occasions.map((row) => ({
    value: row.tag,
    label: labelOccasion(row.tag),
    count: Number(row.cnt),
  }));
  const seasonItems = seasons.map((row) => ({
    value: row.season,
    label: labelize(row.season),
    count: Number(row.cnt),
  }));
  const styleItems = styles.map((row) => ({
    value: row.style,
    label: labelStyleProfile(row.style),
    count: Number(row.cnt),
  }));

  const selectedCategories = filters.categories ?? [];
  const missingCategories = selectedCategories.filter(
    (value) => !categoryItems.some((item) => item.value === value)
  );
  if (missingCategories.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ category: string; cnt: bigint }>>(Prisma.sql`
      select ${CATEGORY_CANON_EXPR} as category, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${categoryWhere}
      and p.category is not null and p.category <> ''
      and ${CATEGORY_CANON_EXPR} in (${Prisma.join(missingCategories)})
      group by 1
    `);
    const countMap = new Map(rows.map((row) => [row.category, Number(row.cnt)]));
    for (const value of missingCategories) {
      categoryItems.push({
        value,
        label: labelCategory(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedBrands = filters.brandIds ?? [];
  const missingBrands = selectedBrands.filter(
    (value) => !brandItems.some((item) => item.value === value)
  );
  if (missingBrands.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string; cnt: bigint }>>(Prisma.sql`
      select b.id, b.name, count(p.id) as cnt
      from brands b
      join products p on p."brandId" = b.id
      ${brandWhere}
      and b.id in (${Prisma.join(missingBrands)})
      group by b.id, b.name
    `);
    const countMap = new Map(
      rows.map((row) => [row.id, { name: row.name, count: Number(row.cnt) }])
    );
    for (const value of missingBrands) {
      const row = countMap.get(value);
      brandItems.push({
        value,
        label: row?.name ?? "Marca",
        count: row?.count ?? 0,
      });
    }
  }

  // `colors` ya incluye toda la paleta estandarizada (con conteos 0), asi que
  // no necesitamos "missingColors" como en otras facetas.

  const selectedSizes = filters.sizes ?? [];
  const missingSizes = selectedSizes.filter((value) => !sizeItems.some((item) => item.value === value));
  if (missingSizes.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ size: string; cnt: bigint }>>(Prisma.sql`
      select v.size as size, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      join variants v on v."productId" = p.id
      ${sizeProductWhere}
      ${sizeVariantWhere}
      and v.size in (${Prisma.join(missingSizes)})
      group by v.size
    `);
    const countMap = new Map(rows.map((row) => [row.size, Number(row.cnt)]));
    for (const value of missingSizes) {
      sizeItems.push({
        value,
        label: value,
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedFits = filters.fits ?? [];
  const missingFits = selectedFits.filter((value) => !fitItems.some((item) => item.value === value));
  if (missingFits.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ fit: string; cnt: bigint }>>(Prisma.sql`
      select v.fit as fit, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      join variants v on v."productId" = p.id
      ${fitProductWhere}
      ${fitVariantWhere}
      and v.fit in (${Prisma.join(missingFits)})
      group by v.fit
    `);
    const countMap = new Map(rows.map((row) => [row.fit, Number(row.cnt)]));
    for (const value of missingFits) {
      fitItems.push({
        value,
        label: value,
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedMaterials = filters.materials ?? [];
  const missingMaterials = selectedMaterials.filter(
    (value) => !materialItems.some((item) => item.value === value)
  );
  if (missingMaterials.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."materialTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${materialWhere}
      ) t
      where tag in (${Prisma.join(missingMaterials)})
      group by tag
    `);
    const countMap = new Map(rows.map((row) => [row.tag, Number(row.cnt)]));
    for (const value of missingMaterials) {
      materialItems.push({
        value,
        label: labelMaterial(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedPatterns = filters.patterns ?? [];
  const missingPatterns = selectedPatterns.filter((value) => !patternItems.some((item) => item.value === value));
  if (missingPatterns.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."patternTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${patternWhere}
      ) t
      where tag in (${Prisma.join(missingPatterns)})
      group by tag
    `);
    const countMap = new Map(rows.map((row) => [row.tag, Number(row.cnt)]));
    for (const value of missingPatterns) {
      patternItems.push({
        value,
        label: labelPattern(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedOccasions = filters.occasions ?? [];
  const missingOccasions = selectedOccasions.filter((value) => !occasionItems.some((item) => item.value === value));
  if (missingOccasions.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."occasionTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${occasionWhere}
      ) t
      where tag in (${Prisma.join(missingOccasions)})
      group by tag
    `);
    const countMap = new Map(rows.map((row) => [row.tag, Number(row.cnt)]));
    for (const value of missingOccasions) {
      occasionItems.push({
        value,
        label: labelOccasion(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedSeasons = filters.seasons ?? [];
  const missingSeasons = selectedSeasons.filter((value) => !seasonItems.some((item) => item.value === value));
  if (missingSeasons.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ season: string; cnt: bigint }>>(Prisma.sql`
      select p.season as season, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${seasonWhere}
      and p.season in (${Prisma.join(missingSeasons)})
      group by p.season
    `);
    const countMap = new Map(rows.map((row) => [row.season, Number(row.cnt)]));
    for (const value of missingSeasons) {
      seasonItems.push({
        value,
        label: labelize(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedStyles = filters.styles ?? [];
  const missingStyles = selectedStyles.filter((value) => !styleItems.some((item) => item.value === value));
  if (missingStyles.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ style: string; cnt: bigint }>>(Prisma.sql`
      select p."stylePrimary" as style, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${styleWhere}
      and p."stylePrimary" in (${Prisma.join(missingStyles)})
      group by p."stylePrimary"
    `);
    const countMap = new Map(rows.map((row) => [row.style, Number(row.cnt)]));
    for (const value of missingStyles) {
      styleItems.push({
        value,
        label: labelStyleProfile(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  return {
    categories: categoryItems,
    genders: (["Femenino", "Masculino", "Unisex", "Infantil"] as GenderKey[]).map((gender) => ({
      value: gender,
      label: gender,
      count: genderCounts.get(gender) ?? 0,
    })),
    brands: brandItems,
    colors: colorItems,
    sizes: sizeItems,
    fits: fitItems,
    materials: materialItems,
    patterns: patternItems,
    occasions: occasionItems,
    seasons: seasonItems,
    styles: styleItems,
  };
}

async function computeCatalogFacetsLite(
  filters: CatalogFilters,
  taxonomy: TaxonomyOptions,
): Promise<CatalogFacetsLite> {
  const categoryFilters = omitFilters(filters, ["categories"]);
  const genderFilters = omitFilters(filters, ["genders"]);
  const brandFilters = omitFilters(filters, ["brandIds"]);
  const colorFilters = omitFilters(filters, ["colors"]);
  const materialFilters = omitFilters(filters, ["materials"]);
  const patternFilters = omitFilters(filters, ["patterns"]);

  const categoryWhere = buildWhere(categoryFilters);
  const genderWhere = buildWhere(genderFilters);
  const brandWhere = buildWhere(brandFilters);
  const materialWhere = buildWhere(materialFilters);
  const patternWhere = buildWhere(patternFilters);

  const { productWhere: colorProductWhere, variantWhere: colorVariantWhere } =
    buildVariantWhere(colorFilters);

  const [categories, genders, brands, colors, materials, patterns] = await Promise.all([
    prisma.$queryRaw<Array<{ category: string; cnt: bigint }>>(Prisma.sql`
      select ${CATEGORY_CANON_EXPR} as category, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${categoryWhere}
      and p.category is not null and p.category <> ''
      group by 1
      order by cnt desc
    `),
    prisma.$queryRaw<Array<{ gender: string | null; cnt: bigint }>>(Prisma.sql`
      select p.gender as gender, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${genderWhere}
      group by p.gender
      order by cnt desc
    `),
    prisma.$queryRaw<Array<{ id: string; name: string; cnt: bigint }>>(Prisma.sql`
      select b.id, b.name, count(p.id) as cnt
      from brands b
      join products p on p."brandId" = b.id
      ${brandWhere}
      group by b.id, b.name
      order by cnt desc
    `),
    prisma.$queryRaw<Array<{ id: string; family: string; name: string; hex: string; cnt: bigint }>>(Prisma.sql`
      with color_counts as (
        select v."standardColorId" as id, count(*) as cnt
        from products p
        join brands b on b.id = p."brandId"
        join variants v on v."productId" = p.id
        ${colorProductWhere}
        ${colorVariantWhere}
        and v."standardColorId" is not null
        group by v."standardColorId"
      )
      select sc.id, sc.family, sc.name, sc.hex, coalesce(cc.cnt, 0) as cnt
      from standard_colors sc
      left join color_counts cc on cc.id = sc.id
      order by sc.family asc, sc.name asc
    `),
    prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."materialTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${materialWhere}
      ) t
      where tag is not null and tag <> ''
      group by tag
      order by cnt desc
      limit 18
    `),
    prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."patternTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${patternWhere}
      ) t
      where tag is not null and tag <> ''
      group by tag
      order by cnt desc
      limit 18
    `),
  ]);

  const genderCounts = new Map<GenderKey, number>();
  for (const row of genders) {
    const gender = normalizeGender(row.gender);
    genderCounts.set(gender, (genderCounts.get(gender) ?? 0) + Number(row.cnt));
  }

  const labelCategory = (value: string) => taxonomy.categoryLabels[value] ?? labelize(value);
  const labelMaterial = (value: string) => taxonomy.materialLabels[value] ?? labelize(value);
  const labelPattern = (value: string) => taxonomy.patternLabels[value] ?? labelize(value);

  const categoryItems = categories.map((row) => ({
    value: row.category,
    label: labelCategory(row.category),
    count: Number(row.cnt),
  }));
  const brandItems = brands.map((row) => ({
    value: row.id,
    label: row.name,
    count: Number(row.cnt),
  }));
  const selectedColors = new Set(filters.colors ?? []);
  const colorItems = colors
    .map((row) => ({
      value: row.id,
      label: row.name,
      count: Number(row.cnt),
      swatch: row.hex,
      group: row.family,
    }))
    .filter((item) => item.count > 0 || selectedColors.has(item.value));
  const materialItems = materials.map((row) => ({
    value: row.tag,
    label: labelMaterial(row.tag),
    count: Number(row.cnt),
  }));
  const patternItems = patterns.map((row) => ({
    value: row.tag,
    label: labelPattern(row.tag),
    count: Number(row.cnt),
  }));

  const selectedCategories = filters.categories ?? [];
  const missingCategories = selectedCategories.filter(
    (value) => !categoryItems.some((item) => item.value === value),
  );
  if (missingCategories.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ category: string; cnt: bigint }>>(Prisma.sql`
      select ${CATEGORY_CANON_EXPR} as category, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${categoryWhere}
      and p.category is not null and p.category <> ''
      and ${CATEGORY_CANON_EXPR} in (${Prisma.join(missingCategories)})
      group by 1
    `);
    const countMap = new Map(rows.map((row) => [row.category, Number(row.cnt)]));
    for (const value of missingCategories) {
      categoryItems.push({
        value,
        label: labelCategory(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedBrands = filters.brandIds ?? [];
  const missingBrands = selectedBrands.filter((value) => !brandItems.some((item) => item.value === value));
  if (missingBrands.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string; cnt: bigint }>>(Prisma.sql`
      select b.id, b.name, count(p.id) as cnt
      from brands b
      join products p on p."brandId" = b.id
      ${brandWhere}
      and b.id in (${Prisma.join(missingBrands)})
      group by b.id, b.name
    `);
    const countMap = new Map(rows.map((row) => [row.id, { name: row.name, count: Number(row.cnt) }]));
    for (const value of missingBrands) {
      const row = countMap.get(value);
      brandItems.push({
        value,
        label: row?.name ?? "Marca",
        count: row?.count ?? 0,
      });
    }
  }

  const selectedMaterials = filters.materials ?? [];
  const missingMaterials = selectedMaterials.filter(
    (value) => !materialItems.some((item) => item.value === value),
  );
  if (missingMaterials.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."materialTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${materialWhere}
      ) t
      where tag in (${Prisma.join(missingMaterials)})
      group by tag
    `);
    const countMap = new Map(rows.map((row) => [row.tag, Number(row.cnt)]));
    for (const value of missingMaterials) {
      materialItems.push({
        value,
        label: labelMaterial(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const selectedPatterns = filters.patterns ?? [];
  const missingPatterns = selectedPatterns.filter((value) => !patternItems.some((item) => item.value === value));
  if (missingPatterns.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
      select tag, count(*) as cnt
      from (
        select unnest(p."patternTags") as tag
        from products p
        join brands b on b.id = p."brandId"
        ${patternWhere}
      ) t
      where tag in (${Prisma.join(missingPatterns)})
      group by tag
    `);
    const countMap = new Map(rows.map((row) => [row.tag, Number(row.cnt)]));
    for (const value of missingPatterns) {
      patternItems.push({
        value,
        label: labelPattern(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  return {
    categories: categoryItems,
    genders: (["Femenino", "Masculino", "Unisex", "Infantil"] as GenderKey[]).map((gender) => ({
      value: gender,
      label: gender,
      count: genderCounts.get(gender) ?? 0,
    })),
    brands: brandItems,
    colors: colorItems,
    materials: materialItems,
    patterns: patternItems,
  };
}

async function computeCatalogSubcategories(
  filters: CatalogFilters,
  taxonomy: TaxonomyOptions,
): Promise<CatalogFacetItem[]> {
  if (!filters.categories || filters.categories.length === 0) {
    return [];
  }
  const subcategoryFilters = omitFilters(filters, ["subcategories"]);
  const subcategoryWhere = buildWhere(subcategoryFilters);

  const rows = await prisma.$queryRaw<Array<{ subcategory: string; cnt: bigint }>>(
    Prisma.sql`
      select p.subcategory as subcategory, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${subcategoryWhere}
      and p.subcategory is not null
      and p.subcategory <> ''
      group by p.subcategory
      order by cnt desc
      limit 14
    `
  );

  const items = rows.map((row) => ({
    value: row.subcategory,
    label: taxonomy.subcategoryLabels[row.subcategory] ?? labelizeSubcategory(row.subcategory),
    count: Number(row.cnt),
  }));

  const selectedSubcategories = filters.subcategories ?? [];
  const missingSubcategories = selectedSubcategories.filter(
    (value) => !items.some((item) => item.value === value)
  );
  if (missingSubcategories.length > 0) {
    const missingRows = await prisma.$queryRaw<Array<{ subcategory: string; cnt: bigint }>>(
      Prisma.sql`
        select p.subcategory as subcategory, count(*) as cnt
        from products p
        join brands b on b.id = p."brandId"
        ${subcategoryWhere}
        and p.subcategory in (${Prisma.join(missingSubcategories)})
        group by p.subcategory
      `
    );
    const countMap = new Map(missingRows.map((row) => [row.subcategory, Number(row.cnt)]));
    for (const value of missingSubcategories) {
      items.push({
        value,
        label: taxonomy.subcategoryLabels[value] ?? labelizeSubcategory(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  const previewKeys = Array.from(new Set(items.map((item) => item.value).filter(Boolean)));
  if (previewKeys.length === 0) return items;

  const previewRows = await prisma.$queryRaw<
    Array<{ subcategory: string; previewProductId: string; previewImageUrl: string | null }>
  >(
    Prisma.sql`
      select distinct on (p.subcategory)
        p.subcategory as subcategory,
        p.id as "previewProductId",
        p."imageCoverUrl" as "previewImageUrl"
      from products p
      join brands b on b.id = p."brandId"
      ${subcategoryWhere}
      and p.subcategory in (${Prisma.join(previewKeys)})
      and p.subcategory is not null
      and p.subcategory <> ''
      and btrim(p."imageCoverUrl") <> ''
      order by p.subcategory, p."createdAt" desc
    `,
  );

  const previewMap = new Map(previewRows.map((row) => [row.subcategory, row]));
  return items.map((item) => {
    const preview = previewMap.get(item.value);
    return {
      ...item,
      previewProductId: preview?.previewProductId ?? null,
      previewImageUrl: preview?.previewImageUrl ?? null,
    };
  });
}

export async function getCatalogFacetsUncached(filters: CatalogFilters): Promise<CatalogFacets> {
  const taxonomy = await getPublishedTaxonomyOptions();
  return computeCatalogFacets(filters, taxonomy);
}

export async function getCatalogSubcategoriesUncached(filters: CatalogFilters): Promise<CatalogFacetItem[]> {
  if (!filters.categories || filters.categories.length === 0) return [];
  const taxonomy = await getPublishedTaxonomyOptions();
  return computeCatalogSubcategories(filters, taxonomy);
}

export async function getCatalogProductsPage(params: {
  filters: CatalogFilters;
  page: number;
  sort: string;
}): Promise<CatalogProductPageResult> {
  const cacheKey = JSON.stringify({
    filters: buildFacetsCacheKey(params.filters),
    page: params.page,
    sort: params.sort || "new",
  });
  const cached = unstable_cache(
    () => computeCatalogProductsPage(params),
    ["catalog-products-page", `cache-v${CATALOG_CACHE_VERSION}`, cacheKey],
    { revalidate: CATALOG_PRODUCTS_REVALIDATE_SECONDS },
  );

  const items = await cached();
  return { items, pageSize: CATALOG_PAGE_SIZE };
}

export async function getCatalogProductsCount(params: { filters: CatalogFilters }): Promise<number> {
  const cacheKey = JSON.stringify({
    filters: buildFacetsCacheKey(params.filters),
  });
  const cached = unstable_cache(
    () => computeCatalogProductsCount(params.filters),
    ["catalog-products-count", `cache-v${CATALOG_CACHE_VERSION}`, cacheKey],
    { revalidate: CATALOG_PRODUCTS_REVALIDATE_SECONDS },
  );

  return cached();
}

export async function getCatalogProducts(params: {
  filters: CatalogFilters;
  page: number;
  sort: string;
}): Promise<CatalogProductResult> {
  const cacheKey = JSON.stringify({
    filters: buildFacetsCacheKey(params.filters),
    page: params.page,
    sort: params.sort || "new",
  });
  const cached = unstable_cache(
    () => computeCatalogProducts(params),
    ["catalog-products", `cache-v${CATALOG_CACHE_VERSION}`, cacheKey],
    { revalidate: CATALOG_PRODUCTS_REVALIDATE_SECONDS },
  );
  return cached();
}

async function computeCatalogProductsCount(filters: CatalogFilters): Promise<number> {
  const productWhere = buildProductWhere(filters);
  const variantConditions = buildVariantConditions(filters);
  const variantWhere =
    variantConditions.length > 0
      ? Prisma.sql`and ${Prisma.join(variantConditions, " and ")}`
      : Prisma.empty;
  const variantExists =
    variantConditions.length > 0
      ? Prisma.sql`
          and exists (
            select 1 from variants v
            where v."productId" = p.id
              ${variantWhere}
          )
        `
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    select count(*) as total
    from products p
    join brands b on b.id = p."brandId"
    ${productWhere}
    ${variantExists}
  `);

  return Number(rows[0]?.total ?? 0);
}

async function computeCatalogProductsPage(params: {
  filters: CatalogFilters;
  page: number;
  sort: string;
}): Promise<CatalogProduct[]> {
  const { filters, page, sort } = params;
  const offset = Math.max(0, (page - 1) * CATALOG_PAGE_SIZE);
  const productWhere = buildProductWhere(filters);
  const variantConditions = buildVariantConditions(filters);
  const variantWhere =
    variantConditions.length > 0
      ? Prisma.sql`and ${Prisma.join(variantConditions, " and ")}`
      : Prisma.empty;
  const variantExists =
    variantConditions.length > 0
      ? Prisma.sql`
          and exists (
            select 1 from variants v
            where v."productId" = p.id
              ${variantWhere}
          )
        `
      : Prisma.empty;

  const sortKey = sort || "new";

  const rows: Array<{
    id: string;
    name: string;
    imageCoverUrl: string | null;
    brandName: string;
    sourceUrl: string | null;
    minPrice: string | null;
    maxPrice: string | null;
    currency: string | null;
  }> = await (async () => {
    if (sortKey === "price_asc" || sortKey === "price_desc") {
      const orderBy = buildOrderBy(sortKey, filters);
      return prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          imageCoverUrl: string | null;
          brandName: string;
          sourceUrl: string | null;
          minPrice: string | null;
          maxPrice: string | null;
          currency: string | null;
        }>
      >(
        Prisma.sql`
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p."sourceUrl",
            min(case when v.price > 0 then v.price end) as "minPrice",
            max(case when v.price > 0 then v.price end) as "maxPrice",
            max(v.currency) as currency
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
            ${variantWhere}
          ${productWhere}
          group by
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name,
            p."sourceUrl",
            p."createdAt"
          ${orderBy}
          limit ${CATALOG_PAGE_SIZE}
          offset ${offset}
        `,
      );
    }

    const q = filters.q ? `%${filters.q}%` : null;
    const isRelevancia = sortKey === "relevancia" && Boolean(q);

    return prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        sourceUrl: string | null;
        minPrice: string | null;
        maxPrice: string | null;
        currency: string | null;
      }>
    >(
      Prisma.sql`
        with ids as (
          select
            p.id,
            p."createdAt" as created_at
            ${isRelevancia
              ? Prisma.sql`,
                case
                  when p.name ilike ${q} then 0
                  when b.name ilike ${q} then 1
                  else 2
                end as rank`
              : Prisma.empty}
          from products p
          join brands b on b.id = p."brandId"
          ${productWhere}
          ${variantExists}
          order by
            ${isRelevancia ? Prisma.sql`rank asc,` : Prisma.empty}
            p."createdAt" desc
          limit ${CATALOG_PAGE_SIZE}
          offset ${offset}
        )
        select
          p.id,
          p.name,
          p."imageCoverUrl",
          b.name as "brandName",
          p."sourceUrl",
          vagg."minPrice",
          vagg."maxPrice",
          vagg.currency
        from ids
        join products p on p.id = ids.id
        join brands b on b.id = p."brandId"
        left join lateral (
          select
            min(case when v.price > 0 then v.price end) as "minPrice",
            max(case when v.price > 0 then v.price end) as "maxPrice",
            max(v.currency) as currency
          from variants v
          where v."productId" = p.id
            ${variantWhere}
        ) vagg on true
        order by
          ${isRelevancia ? Prisma.sql`ids.rank asc,` : Prisma.empty}
          ids.created_at desc
      `,
    );
  })();

  return rows.map((item) => ({
    id: item.id,
    name: item.name,
    imageCoverUrl: item.imageCoverUrl,
    brandName: item.brandName,
    sourceUrl: item.sourceUrl,
    minPrice: item.minPrice,
    maxPrice: item.maxPrice,
    currency: item.currency,
  }));
}

async function computeCatalogProducts(params: {
  filters: CatalogFilters;
  page: number;
  sort: string;
}): Promise<CatalogProductResult> {
  const { filters, page, sort } = params;
  const offset = Math.max(0, (page - 1) * CATALOG_PAGE_SIZE);
  const productWhere = buildProductWhere(filters);
  const variantConditions = buildVariantConditions(filters);
  const variantWhere =
    variantConditions.length > 0
      ? Prisma.sql`and ${Prisma.join(variantConditions, " and ")}`
      : Prisma.empty;
  const variantExists =
    variantConditions.length > 0
      ? Prisma.sql`
          and exists (
            select 1 from variants v
            where v."productId" = p.id
              ${variantWhere}
          )
        `
      : Prisma.empty;

  const countPromise = prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    select count(*) as total
    from products p
    join brands b on b.id = p."brandId"
    ${productWhere}
    ${variantExists}
  `);

  const sortKey = sort || "new";
  const itemsPromise: Promise<
    Array<{
      id: string;
      name: string;
      imageCoverUrl: string | null;
      brandName: string;
      sourceUrl: string | null;
      minPrice: string | null;
      maxPrice: string | null;
      currency: string | null;
    }>
  > = (() => {
    if (sortKey === "price_asc" || sortKey === "price_desc") {
      const orderBy = buildOrderBy(sortKey, filters);
      return prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          imageCoverUrl: string | null;
          brandName: string;
          sourceUrl: string | null;
          minPrice: string | null;
          maxPrice: string | null;
          currency: string | null;
        }>
      >(
        Prisma.sql`
          select
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name as "brandName",
            p."sourceUrl",
            min(case when v.price > 0 then v.price end) as "minPrice",
            max(case when v.price > 0 then v.price end) as "maxPrice",
            max(v.currency) as currency
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
            ${variantWhere}
          ${productWhere}
          group by
            p.id,
            p.name,
            p."imageCoverUrl",
            b.name,
            p."sourceUrl",
            p."createdAt"
          ${orderBy}
          limit ${CATALOG_PAGE_SIZE}
          offset ${offset}
        `,
      );
    }

    const q = filters.q ? `%${filters.q}%` : null;
    const isRelevancia = sortKey === "relevancia" && Boolean(q);

    return prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        sourceUrl: string | null;
        minPrice: string | null;
        maxPrice: string | null;
        currency: string | null;
      }>
    >(
      Prisma.sql`
        with ids as (
          select
            p.id,
            p."createdAt" as created_at
            ${isRelevancia
              ? Prisma.sql`,
                case
                  when p.name ilike ${q} then 0
                  when b.name ilike ${q} then 1
                  else 2
                end as rank`
              : Prisma.empty}
          from products p
          join brands b on b.id = p."brandId"
          ${productWhere}
          ${variantExists}
          order by
            ${isRelevancia ? Prisma.sql`rank asc,` : Prisma.empty}
            p."createdAt" desc
          limit ${CATALOG_PAGE_SIZE}
          offset ${offset}
        )
        select
          p.id,
          p.name,
          p."imageCoverUrl",
          b.name as "brandName",
          p."sourceUrl",
          vagg."minPrice",
          vagg."maxPrice",
          vagg.currency
        from ids
        join products p on p.id = ids.id
        join brands b on b.id = p."brandId"
        left join lateral (
          select
            min(case when v.price > 0 then v.price end) as "minPrice",
            max(case when v.price > 0 then v.price end) as "maxPrice",
            max(v.currency) as currency
          from variants v
          where v."productId" = p.id
            ${variantWhere}
        ) vagg on true
        order by
          ${isRelevancia ? Prisma.sql`ids.rank asc,` : Prisma.empty}
          ids.created_at desc
      `,
    );
  })();

  const [items, countRows] = await Promise.all([itemsPromise, countPromise]);

  const totalCount = Number(countRows[0]?.total ?? 0);

  return {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      imageCoverUrl: item.imageCoverUrl,
      brandName: item.brandName,
      sourceUrl: item.sourceUrl,
      minPrice: item.minPrice,
      maxPrice: item.maxPrice,
      currency: item.currency,
    })),
    totalCount,
  };
}
