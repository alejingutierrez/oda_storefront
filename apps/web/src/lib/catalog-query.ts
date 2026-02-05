import { Prisma } from "@prisma/client";
import { type GenderKey } from "@/lib/navigation";

export type CatalogFilters = {
  q?: string;
  categories?: string[];
  subcategories?: string[];
  genders?: GenderKey[];
  brandIds?: string[];
  priceMin?: number;
  priceMax?: number;
  colors?: string[];
  sizes?: string[];
  fits?: string[];
  materials?: string[];
  patterns?: string[];
  occasions?: string[];
  seasons?: string[];
  styles?: string[];
  inStock?: boolean;
};

const genderSqlMap: Record<GenderKey, Prisma.Sql> = {
  Femenino: Prisma.sql`lower(coalesce(p.gender,'')) in ('femenino','mujer')`,
  Masculino: Prisma.sql`lower(coalesce(p.gender,'')) in ('masculino','hombre','male')`,
  Infantil: Prisma.sql`lower(coalesce(p.gender,'')) in ('infantil','nino')`,
  Unisex: Prisma.sql`lower(coalesce(p.gender,'')) in ('no_binario_unisex','unisex','unknown','') or p.gender is null`,
};

function buildTextArray(values: string[]): Prisma.Sql {
  return Prisma.sql`ARRAY[${Prisma.join(values)}]`;
}

export function buildWhere(filters: CatalogFilters): Prisma.Sql {
  const q = filters.q ? `%${filters.q}%` : null;
  const categoryFilter =
    filters.categories && filters.categories.length > 0
      ? Prisma.sql`and p.category in (${Prisma.join(filters.categories)})`
      : Prisma.empty;
  const subcategoryFilter =
    filters.subcategories && filters.subcategories.length > 0
      ? Prisma.sql`and p.subcategory in (${Prisma.join(filters.subcategories)})`
      : Prisma.empty;
  const brandFilter =
    filters.brandIds && filters.brandIds.length > 0
      ? Prisma.sql`and p."brandId" in (${Prisma.join(filters.brandIds)})`
      : Prisma.empty;
  const genderFilter =
    filters.genders && filters.genders.length > 0
      ? Prisma.sql`and (${Prisma.join(
          filters.genders.map((gender) => genderSqlMap[gender]),
          " or "
        )})`
      : Prisma.empty;
  const styleFilter =
    filters.styles && filters.styles.length > 0
      ? Prisma.sql`and p."stylePrimary" in (${Prisma.join(filters.styles)})`
      : Prisma.empty;
  const materialFilter =
    filters.materials && filters.materials.length > 0
      ? Prisma.sql`and p."materialTags" && ${buildTextArray(filters.materials)}`
      : Prisma.empty;
  const patternFilter =
    filters.patterns && filters.patterns.length > 0
      ? Prisma.sql`and p."patternTags" && ${buildTextArray(filters.patterns)}`
      : Prisma.empty;
  const occasionFilter =
    filters.occasions && filters.occasions.length > 0
      ? Prisma.sql`and p."occasionTags" && ${buildTextArray(filters.occasions)}`
      : Prisma.empty;
  const seasonFilter =
    filters.seasons && filters.seasons.length > 0
      ? Prisma.sql`and p.season in (${Prisma.join(filters.seasons)})`
      : Prisma.empty;

  const variantConditions: Prisma.Sql[] = [];
  if (filters.colors && filters.colors.length > 0) {
    variantConditions.push(Prisma.sql`v.color in (${Prisma.join(filters.colors)})`);
  }
  if (filters.sizes && filters.sizes.length > 0) {
    variantConditions.push(Prisma.sql`v.size in (${Prisma.join(filters.sizes)})`);
  }
  if (filters.fits && filters.fits.length > 0) {
    variantConditions.push(Prisma.sql`v.fit in (${Prisma.join(filters.fits)})`);
  }
  if (filters.priceMin !== undefined) {
    variantConditions.push(Prisma.sql`v.price >= ${filters.priceMin}`);
  }
  if (filters.priceMax !== undefined) {
    variantConditions.push(Prisma.sql`v.price <= ${filters.priceMax}`);
  }
  if (filters.inStock) {
    variantConditions.push(
      Prisma.sql`(v.stock > 0 or v."stockStatus" in ('in_stock','preorder'))`
    );
  }
  const variantFilter =
    variantConditions.length > 0
      ? Prisma.sql`
        and exists (
          select 1 from variants v
          where v."productId" = p.id
            and ${Prisma.join(variantConditions, " and ")}
        )
      `
      : Prisma.empty;

  return Prisma.sql`
    where p."imageCoverUrl" is not null
      ${categoryFilter}
      ${subcategoryFilter}
      ${genderFilter}
      ${brandFilter}
      ${styleFilter}
      ${materialFilter}
      ${patternFilter}
      ${occasionFilter}
      ${seasonFilter}
      ${variantFilter}
      ${q ? Prisma.sql`
        and (
          p.name ilike ${q}
          or b.name ilike ${q}
          or p."seoTags"::text ilike ${q}
        )
      ` : Prisma.empty}
  `;
}

export function buildOrderBy(sort: string): Prisma.Sql {
  switch (sort) {
    case "price_asc":
      return Prisma.sql`order by (
        select min(v.price) from variants v where v."productId" = p.id and v.price > 0
      ) asc nulls last`;
    case "price_desc":
      return Prisma.sql`order by (
        select min(v.price) from variants v where v."productId" = p.id and v.price > 0
      ) desc nulls last`;
    case "new":
      return Prisma.sql`order by p."createdAt" desc`;
    default:
      return Prisma.sql`order by p."createdAt" desc`;
  }
}
