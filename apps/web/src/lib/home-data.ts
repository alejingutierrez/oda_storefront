import "server-only";

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  CATEGORY_GROUPS,
  GenderKey,
  SPECIAL_SUBCATEGORY_SPLITS,
  buildCategoryHref,
  labelize,
  labelizeSubcategory,
} from "@/lib/navigation";

const HOME_REVALIDATE_SECONDS = 60 * 60;
const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;

export type MenuSubcategory = {
  key: string;
  label: string;
  count: number;
  href: string;
};

export type MenuCategory = {
  key: string;
  label: string;
  count: number;
  href: string;
  subcategories?: MenuSubcategory[];
};

export type MegaMenuData = Record<
  GenderKey,
  {
    Superiores: MenuCategory[];
    Inferiores: MenuCategory[];
    Accesorios: MenuCategory[];
  }
>;

export type ProductCard = {
  id: string;
  name: string;
  imageCoverUrl: string;
  brandName: string;
  category: string | null;
  subcategory: string | null;
  minPrice: string | null;
  currency: string | null;
  sourceUrl: string | null;
};

export type CategoryHighlight = {
  category: string;
  label: string;
  imageCoverUrl: string;
  href: string;
};

export type StyleGroup = {
  styleKey: string;
  label: string;
  products: ProductCard[];
};

export type ColorCombo = {
  id: string;
  comboKey: string;
  detectedLayout: string | null;
  colors: Array<{
    id: string;
    hex: string;
    role: string | null;
    pantoneName: string | null;
  }>;
};

export type BrandLogo = {
  id: string;
  name: string;
  logoUrl: string;
};

export function getRotationSeed(now = new Date()): number {
  return Math.floor(now.getTime() / THREE_DAYS_MS);
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
              category,
              subcategory
            from products
            where category is not null and category <> ''
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
          column: "Superiores" | "Inferiores" | "Accesorios"
        ): MenuCategory[] => {
          const categories = CATEGORY_GROUPS[column];
          const items: MenuCategory[] = [];

          for (const category of categories) {
            const entry = catMap.get(category);
            if (!entry || entry.count <= 0) {
              continue;
            }

            if (category === "outerwear") {
              const subcategories = (SPECIAL_SUBCATEGORY_SPLITS.outerwear.subcategories || [])
                .map((sub) => ({
                  key: sub,
                  label: labelizeSubcategory(sub),
                  count: entry.sub.get(sub) ?? 0,
                  href: buildCategoryHref(gender, category, sub),
                }))
                .filter((sub) => sub.count > 0);
              items.push({
                key: category,
                label: labelize(category),
                count: entry.count,
                href: buildCategoryHref(gender, category),
                subcategories,
              });
              continue;
            }

            if (category === "ropa_deportiva_y_performance") {
              const allowed =
                column === "Superiores"
                  ? SPECIAL_SUBCATEGORY_SPLITS.ropa_deportiva_y_performance.superiores
                  : column === "Inferiores"
                    ? SPECIAL_SUBCATEGORY_SPLITS.ropa_deportiva_y_performance.inferiores
                    : [];
              if (allowed.length === 0) {
                continue;
              }
              const subcategories = allowed
                .map((sub) => ({
                  key: sub,
                  label: labelizeSubcategory(sub),
                  count: entry.sub.get(sub) ?? 0,
                  href: buildCategoryHref(gender, category, sub),
                }))
                .filter((sub) => sub.count > 0);
              if (subcategories.length === 0) {
                continue;
              }
              items.push({
                key: category,
                label: labelize(category),
                count: entry.count,
                href: buildCategoryHref(gender, category),
                subcategories,
              });
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
          Inferiores: buildColumn("Inferiores"),
          Accesorios: buildColumn("Accesorios"),
        };
      }

      return result;
    },
    ["home-mega-menu"],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getHeroProduct(seed: number): Promise<ProductCard | null> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<ProductCard[]>(
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
              select v.currency
              from variants v
              where v."productId" = p.id and v.price > 0
              limit 1
            ) as currency
          from products p
          join brands b on b.id = p."brandId"
          where p."imageCoverUrl" is not null
          order by md5(concat(p.id::text, ${seed}::text))
          limit 1
        `
      );
      return rows[0] ?? null;
    },
    [`home-hero-${seed}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getNewArrivals(seed: number, limit = 8): Promise<ProductCard[]> {
  const cached = unstable_cache(
    async () => {
      return prisma.$queryRaw<ProductCard[]>(
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
              select v.currency
              from variants v
              where v."productId" = p.id and v.price > 0
              limit 1
            ) as currency
          from products p
          join brands b on b.id = p."brandId"
          where p."imageCoverUrl" is not null
          order by md5(concat(p.id::text, ${seed}::text))
          limit ${limit}
        `
      );
    },
    [`home-new-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getTrendingPicks(seed: number, limit = 8): Promise<ProductCard[]> {
  const cached = unstable_cache(
    async () => {
      return prisma.$queryRaw<ProductCard[]>(
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
              select v.currency
              from variants v
              where v."productId" = p.id and v.price > 0
              limit 1
            ) as currency
          from products p
          join brands b on b.id = p."brandId"
          where p."imageCoverUrl" is not null
          order by md5(concat(p.id::text, ${seed}::text, 'picks'))
          limit ${limit}
        `
      );
    },
    [`home-picks-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getCategoryHighlights(
  seed: number,
  limit = 8
): Promise<CategoryHighlight[]> {
  const cached = unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{ category: string; imageCoverUrl: string }>
      >(
        Prisma.sql`
          with categories as (
            select category, count(*) as cnt
            from products
            where category is not null and category <> ''
            group by category
            order by cnt desc
            limit ${limit}
          ), picked as (
            select
              c.category,
              (
                select p.id
                from products p
                where p.category = c.category and p."imageCoverUrl" is not null
                order by md5(concat(p.id::text, ${seed}::text, c.category))
                limit 1
              ) as product_id
            from categories c
          )
          select p.category, p."imageCoverUrl"
          from picked pk
          join products p on p.id = pk.product_id
        `
      );

      return rows.map((row) => ({
        category: row.category,
        label: labelize(row.category),
        imageCoverUrl: row.imageCoverUrl,
        href: buildCategoryHref("Unisex", row.category),
      }));
    },
    [`home-categories-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getStyleGroups(seed: number, limit = 3): Promise<StyleGroup[]> {
  const cached = unstable_cache(
    async () => {
      const styles = await prisma.$queryRaw<
        Array<{ stylePrimary: string; cnt: bigint }>
      >(
        Prisma.sql`
          select "stylePrimary" as "stylePrimary", count(*) as cnt
          from products
          where "stylePrimary" is not null and "stylePrimary" <> ''
          group by 1
          order by cnt desc
          limit ${limit}
        `
      );

      const groups: StyleGroup[] = [];
      for (const style of styles) {
        const styleKey = style.stylePrimary;
        const products = await prisma.$queryRaw<ProductCard[]>(
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
                select v.currency
                from variants v
                where v."productId" = p.id and v.price > 0
                limit 1
              ) as currency
            from products p
            join brands b on b.id = p."brandId"
            where p."stylePrimary" = ${styleKey} and p."imageCoverUrl" is not null
            order by md5(concat(p.id::text, ${seed}::text, ${styleKey}))
            limit 6
          `
        );

        groups.push({
          styleKey,
          label: labelize(styleKey),
          products,
        });
      }

      return groups;
    },
    [`home-styles-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getColorCombos(seed: number, limit = 6): Promise<ColorCombo[]> {
  const cached = unstable_cache(
    async () => {
      const combos = await prisma.$queryRaw<ColorCombo[]>(
        Prisma.sql`
          select
            c.id,
            c."comboKey",
            c."detectedLayout"
          from color_combinations c
          order by md5(concat(c.id::text, ${seed}::text, 'colors'))
          limit ${limit}
        `
      );

      const ids = combos.map((combo) => combo.id);
      if (ids.length === 0) {
        return [];
      }

      const colors = await prisma.$queryRaw<
        Array<{
          id: string;
          combinationId: string;
          hex: string;
          role: string | null;
          pantoneName: string | null;
        }>
      >(
        Prisma.sql`
          select id, "combinationId", hex, role, "pantoneName"
          from color_combination_colors
          where "combinationId" in (${Prisma.join(ids)})
          order by "position" asc
        `
      );

      const byCombo = new Map<string, ColorCombo>();
      for (const combo of combos) {
        byCombo.set(combo.id, { ...combo, colors: [] });
      }
      for (const color of colors) {
        const combo = byCombo.get(color.combinationId);
        if (combo) {
          combo.colors.push({
            id: color.id,
            hex: color.hex,
            role: color.role,
            pantoneName: color.pantoneName,
          });
        }
      }

      return Array.from(byCombo.values());
    },
    [`home-colors-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}

export async function getBrandLogos(seed: number, limit = 24): Promise<BrandLogo[]> {
  const cached = unstable_cache(
    async () => {
      return prisma.$queryRaw<BrandLogo[]>(
        Prisma.sql`
          select id, name, "logoUrl"
          from brands
          where "logoUrl" is not null
          order by md5(concat(id::text, ${seed}::text, 'brands'))
          limit ${limit}
        `
      );
    },
    [`home-brands-${seed}-${limit}`],
    { revalidate: HOME_REVALIDATE_SECONDS }
  );

  return cached();
}
