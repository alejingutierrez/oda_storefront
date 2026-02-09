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
const CATALOG_CACHE_VERSION = 3;

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

export type CatalogPriceBounds = {
  min: number | null;
  max: number | null;
};

function normalizeArray(values?: string[]) {
  if (!values || values.length === 0) return undefined;
  return Array.from(new Set(values)).sort();
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
  if (filters.priceMin !== undefined) key.priceMin = filters.priceMin;
  if (filters.priceMax !== undefined) key.priceMax = filters.priceMax;
  if (filters.inStock) key.inStock = 1;
  if (filters.enrichedOnly) key.enrichedOnly = 1;
  return JSON.stringify(key);
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
  const boundsFilters = omitFilters(filters, ["priceMin", "priceMax"]);
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

  return items;
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
