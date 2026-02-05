import "server-only";

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { labelize, labelizeSubcategory, normalizeGender, type GenderKey } from "@/lib/navigation";
import {
  buildOrderBy,
  buildProductConditions,
  buildVariantConditions,
  buildWhere,
  type CatalogFilters,
} from "@/lib/catalog-query";

const CATALOG_REVALIDATE_SECONDS = 60 * 30;
export const CATALOG_PAGE_SIZE = 24;

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

export type { CatalogFilters };

export type CatalogProduct = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brandName: string;
  category: string | null;
  subcategory: string | null;
  sourceUrl: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  variantCount: number;
  colors: string[];
};

export type CatalogProductResult = {
  items: CatalogProduct[];
  totalCount: number;
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
    ["catalog-stats"],
    { revalidate: CATALOG_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getCatalogFacets(filters: CatalogFilters): Promise<CatalogFacets> {
  const cacheKey = buildFacetsCacheKey(filters);
  const cached = unstable_cache(async () => computeCatalogFacets(filters), ["catalog-facets", cacheKey], {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });

  return cached();
}

export async function getCatalogSubcategories(filters: CatalogFilters): Promise<CatalogFacetItem[]> {
  if (!filters.categories || filters.categories.length === 0) {
    return [];
  }
  const cacheKey = buildFacetsCacheKey(filters);
  const cached = unstable_cache(
    async () => computeCatalogSubcategories(filters),
    [`catalog-subcategories-${cacheKey}`],
    { revalidate: CATALOG_REVALIDATE_SECONDS }
  );

  return cached();
}

async function computeCatalogFacets(filters: CatalogFilters): Promise<CatalogFacets> {
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
      select p.category as category, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${categoryWhere}
      and p.category is not null and p.category <> ''
      group by p.category
      order by cnt desc
      limit 16
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
      limit 20
    `),
    prisma.$queryRaw<Array<{ color: string; cnt: bigint }>>(Prisma.sql`
      select v.color as color, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      join variants v on v."productId" = p.id
      ${colorProductWhere}
      ${colorVariantWhere}
      and v.color is not null and btrim(v.color) <> ''
      group by v.color
      order by cnt desc
      limit 18
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

  const categoryItems = categories.map((row) => ({
    value: row.category,
    label: labelize(row.category),
    count: Number(row.cnt),
  }));
  const brandItems = brands.map((row) => ({
    value: row.id,
    label: row.name,
    count: Number(row.cnt),
  }));
  const colorItems = colors.map((row) => ({
    value: row.color,
    label: row.color,
    count: Number(row.cnt),
    swatch: row.color,
  }));
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
    label: labelize(row.tag),
    count: Number(row.cnt),
  }));
  const patternItems = patterns.map((row) => ({
    value: row.tag,
    label: labelize(row.tag),
    count: Number(row.cnt),
  }));
  const occasionItems = occasions.map((row) => ({
    value: row.tag,
    label: labelize(row.tag),
    count: Number(row.cnt),
  }));
  const seasonItems = seasons.map((row) => ({
    value: row.season,
    label: labelize(row.season),
    count: Number(row.cnt),
  }));
  const styleItems = styles.map((row) => ({
    value: row.style,
    label: labelize(row.style),
    count: Number(row.cnt),
  }));

  const selectedCategories = filters.categories ?? [];
  const missingCategories = selectedCategories.filter(
    (value) => !categoryItems.some((item) => item.value === value)
  );
  if (missingCategories.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ category: string; cnt: bigint }>>(Prisma.sql`
      select p.category as category, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      ${categoryWhere}
      and p.category in (${Prisma.join(missingCategories)})
      group by p.category
    `);
    const countMap = new Map(rows.map((row) => [row.category, Number(row.cnt)]));
    for (const value of missingCategories) {
      categoryItems.push({
        value,
        label: labelize(value),
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

  const selectedColors = filters.colors ?? [];
  const missingColors = selectedColors.filter(
    (value) => !colorItems.some((item) => item.value === value)
  );
  if (missingColors.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ color: string; cnt: bigint }>>(Prisma.sql`
      select v.color as color, count(*) as cnt
      from products p
      join brands b on b.id = p."brandId"
      join variants v on v."productId" = p.id
      ${colorProductWhere}
      ${colorVariantWhere}
      and v.color in (${Prisma.join(missingColors)})
      group by v.color
    `);
    const countMap = new Map(rows.map((row) => [row.color, Number(row.cnt)]));
    for (const value of missingColors) {
      colorItems.push({
        value,
        label: value,
        count: countMap.get(value) ?? 0,
        swatch: value,
      });
    }
  }

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
        label: labelize(value),
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
        label: labelize(value),
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
        label: labelize(value),
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
        label: labelize(value),
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

async function computeCatalogSubcategories(filters: CatalogFilters): Promise<CatalogFacetItem[]> {
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
    label: labelizeSubcategory(row.subcategory),
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
        label: labelizeSubcategory(value),
        count: countMap.get(value) ?? 0,
      });
    }
  }

  return items;
}

export async function getCatalogFacetsUncached(filters: CatalogFilters): Promise<CatalogFacets> {
  return computeCatalogFacets(filters);
}

export async function getCatalogSubcategoriesUncached(filters: CatalogFilters): Promise<CatalogFacetItem[]> {
  return computeCatalogSubcategories(filters);
}

export async function getCatalogProducts(params: {
  filters: CatalogFilters;
  page: number;
  sort: string;
}): Promise<CatalogProductResult> {
  const { filters, page, sort } = params;
  const offset = Math.max(0, (page - 1) * CATALOG_PAGE_SIZE);
  const where = buildWhere(filters);
  const orderBy = buildOrderBy(sort);

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        category: string | null;
        subcategory: string | null;
        sourceUrl: string | null;
        minPrice: string | null;
        maxPrice: string | null;
        currency: string | null;
        variantCount: bigint;
        colors: string[] | null;
      }>
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
            select min(v.price)
            from variants v
            where v."productId" = p.id and v.price > 0
          ) as "minPrice",
          (
            select max(v.price)
            from variants v
            where v."productId" = p.id and v.price > 0
          ) as "maxPrice",
          (
            select v.currency
            from variants v
            where v."productId" = p.id and v.price > 0
            limit 1
          ) as currency,
          (
            select count(*)
            from variants v
            where v."productId" = p.id
          ) as "variantCount",
          (
            select array_remove(array_agg(distinct v.color), null)
            from variants v
            where v."productId" = p.id and v.color is not null and btrim(v.color) <> ''
          ) as colors
        from products p
        join brands b on b.id = p."brandId"
        ${where}
        ${orderBy}
        limit ${CATALOG_PAGE_SIZE}
        offset ${offset}
      `
    ),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      select count(*) as total
      from products p
      join brands b on b.id = p."brandId"
      ${where}
    `),
  ]);

  const totalCount = Number(countRows[0]?.total ?? 0);

  return {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      imageCoverUrl: item.imageCoverUrl,
      brandName: item.brandName,
      category: item.category,
      subcategory: item.subcategory,
      sourceUrl: item.sourceUrl,
      minPrice: item.minPrice,
      maxPrice: item.maxPrice,
      currency: item.currency,
      variantCount: Number(item.variantCount ?? 0),
      colors: (item.colors ?? []).filter(Boolean),
    })),
    totalCount,
  };
}
