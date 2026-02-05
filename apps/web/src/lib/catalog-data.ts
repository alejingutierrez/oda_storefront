import "server-only";

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { labelize, labelizeSubcategory, normalizeGender, type GenderKey } from "@/lib/navigation";
import { buildOrderBy, buildWhere, type CatalogFilters } from "@/lib/catalog-query";

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

export async function getCatalogFacets(): Promise<CatalogFacets> {
  const cached = unstable_cache(
    async () => {
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
          select category, count(*) as cnt
          from products
          where category is not null and category <> ''
          group by category
          order by cnt desc
          limit 16
        `),
        prisma.$queryRaw<Array<{ gender: string | null; cnt: bigint }>>(Prisma.sql`
          select gender, count(*) as cnt
          from products
          group by gender
          order by cnt desc
        `),
        prisma.$queryRaw<Array<{ id: string; name: string; cnt: bigint }>>(Prisma.sql`
          select b.id, b.name, count(p.id) as cnt
          from brands b
          join products p on p."brandId" = b.id
          group by b.id, b.name
          order by cnt desc
          limit 20
        `),
        prisma.$queryRaw<Array<{ color: string; cnt: bigint }>>(Prisma.sql`
          select color, count(*) as cnt
          from variants
          where color is not null and btrim(color) <> ''
          group by color
          order by cnt desc
          limit 18
        `),
        prisma.$queryRaw<Array<{ size: string; cnt: bigint }>>(Prisma.sql`
          select size, count(*) as cnt
          from variants
          where size is not null and btrim(size) <> ''
          group by size
          order by cnt desc
          limit 18
        `),
        prisma.$queryRaw<Array<{ fit: string; cnt: bigint }>>(Prisma.sql`
          select fit, count(*) as cnt
          from variants
          where fit is not null and btrim(fit) <> ''
          group by fit
          order by cnt desc
          limit 12
        `),
        prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
          select tag, count(*) as cnt
          from (
            select unnest("materialTags") as tag from products
          ) t
          where tag is not null and tag <> ''
          group by tag
          order by cnt desc
          limit 12
        `),
        prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
          select tag, count(*) as cnt
          from (
            select unnest("patternTags") as tag from products
          ) t
          where tag is not null and tag <> ''
          group by tag
          order by cnt desc
          limit 12
        `),
        prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>(Prisma.sql`
          select tag, count(*) as cnt
          from (
            select unnest("occasionTags") as tag from products
          ) t
          where tag is not null and tag <> ''
          group by tag
          order by cnt desc
          limit 12
        `),
        prisma.$queryRaw<Array<{ season: string; cnt: bigint }>>(Prisma.sql`
          select season, count(*) as cnt
          from products
          where season is not null and season <> ''
          group by season
          order by cnt desc
          limit 10
        `),
        prisma.$queryRaw<Array<{ style: string; cnt: bigint }>>(Prisma.sql`
          select "stylePrimary" as style, count(*) as cnt
          from products
          where "stylePrimary" is not null and "stylePrimary" <> ''
          group by "stylePrimary"
          order by cnt desc
          limit 10
        `),
      ]);

      const genderCounts = new Map<GenderKey, number>();
      for (const row of genders) {
        const gender = normalizeGender(row.gender);
        genderCounts.set(gender, (genderCounts.get(gender) ?? 0) + Number(row.cnt));
      }

      return {
        categories: categories.map((row) => ({
          value: row.category,
          label: labelize(row.category),
          count: Number(row.cnt),
        })),
        genders: (["Femenino", "Masculino", "Unisex", "Infantil"] as GenderKey[]).map(
          (gender) => ({
            value: gender,
            label: gender,
            count: genderCounts.get(gender) ?? 0,
          })
        ),
        brands: brands.map((row) => ({
          value: row.id,
          label: row.name,
          count: Number(row.cnt),
        })),
        colors: colors.map((row) => ({
          value: row.color,
          label: row.color,
          count: Number(row.cnt),
          swatch: row.color,
        })),
        sizes: sizes.map((row) => ({
          value: row.size,
          label: row.size,
          count: Number(row.cnt),
        })),
        fits: fits.map((row) => ({
          value: row.fit,
          label: row.fit,
          count: Number(row.cnt),
        })),
        materials: materials.map((row) => ({
          value: row.tag,
          label: labelize(row.tag),
          count: Number(row.cnt),
        })),
        patterns: patterns.map((row) => ({
          value: row.tag,
          label: labelize(row.tag),
          count: Number(row.cnt),
        })),
        occasions: occasions.map((row) => ({
          value: row.tag,
          label: labelize(row.tag),
          count: Number(row.cnt),
        })),
        seasons: seasons.map((row) => ({
          value: row.season,
          label: labelize(row.season),
          count: Number(row.cnt),
        })),
        styles: styles.map((row) => ({
          value: row.style,
          label: labelize(row.style),
          count: Number(row.cnt),
        })),
      };
    },
    ["catalog-facets"],
    { revalidate: CATALOG_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getSubcategoriesForCategory(
  categories: string[]
): Promise<CatalogFacetItem[]> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<Array<{ subcategory: string; cnt: bigint }>>(
        Prisma.sql`
          select subcategory, count(*) as cnt
          from products
          where category in (${Prisma.join(categories)})
            and subcategory is not null
            and subcategory <> ''
          group by subcategory
          order by cnt desc
          limit 14
        `
      );
      return rows.map((row) => ({
        value: row.subcategory,
        label: labelizeSubcategory(row.subcategory),
        count: Number(row.cnt),
      }));
    },
    [`catalog-subcategories-${[...categories].sort().join(",")}`],
    { revalidate: CATALOG_REVALIDATE_SECONDS }
  );

  return cached();
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
