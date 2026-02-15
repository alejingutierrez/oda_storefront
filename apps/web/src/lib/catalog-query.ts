import { Prisma } from "@prisma/client";
import { type GenderKey } from "@/lib/navigation";

export type CatalogFilters = {
  q?: string;
  categories?: string[];
  subcategories?: string[];
  genders?: GenderKey[];
  brandIds?: string[];
  seoTags?: string[];
  priceMin?: number;
  priceMax?: number;
  // Unión disjunta de rangos de precio (p.ej. [:200000], [400000:700000], [800000:]).
  // Si existe, tiene prioridad sobre `priceMin/priceMax`.
  priceRanges?: Array<{ min?: number; max?: number }>;
  colors?: string[];
  sizes?: string[];
  fits?: string[];
  materials?: string[];
  patterns?: string[];
  occasions?: string[];
  seasons?: string[];
  styles?: string[];
  inStock?: boolean;
  // Interno: oculta productos sin `metadata.enrichment` (catalogo publico).
  enrichedOnly?: boolean;
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

// Query-time category canonicalization:
// - Keeps the DB unchanged (important while we re-enrich/migrate legacy rows).
// - Makes filters/facets consistent with the canonical taxonomy keys.
//
// NOTE: `accesorios` is intentionally not bulk-mapped here (too ambiguous). We only map the
// explicit `accesorios/bolsos` legacy combo to `bolsos_y_marroquineria`.
const CATEGORY_FILTER_ALIASES: Record<string, Prisma.Sql[]> = {
  camisetas_y_tops: [Prisma.sql`(p.category='tops' and p.subcategory='camisetas')`],
  camisas_y_blusas: [Prisma.sql`(p.category='tops' and p.subcategory in ('blusas','camisas'))`],
  jeans_y_denim: [Prisma.sql`(p.category='bottoms' and p.subcategory='jeans')`],
  pantalones_no_denim: [Prisma.sql`(p.category='bottoms' and p.subcategory='pantalones')`],
  faldas: [Prisma.sql`(p.category='bottoms' and p.subcategory='faldas')`],
  shorts_y_bermudas: [Prisma.sql`(p.category='bottoms' and p.subcategory='shorts')`],
  blazers_y_sastreria: [Prisma.sql`(p.category='outerwear' and p.subcategory='blazers')`],
  buzos_hoodies_y_sueteres: [
    Prisma.sql`(p.category='outerwear' and p.subcategory='buzos')`,
    Prisma.sql`p.category='knitwear'`,
  ],
  chaquetas_y_abrigos: [Prisma.sql`(p.category='outerwear' and p.subcategory in ('chaquetas','abrigos'))`],
  trajes_de_bano_y_playa: [Prisma.sql`p.category='trajes_de_bano'`],
  ropa_deportiva_y_performance: [Prisma.sql`p.category='deportivo'`],
  ropa_interior_basica: [Prisma.sql`p.category in ('ropa_interior','ropa interior')`],
  enterizos_y_overoles: [Prisma.sql`p.category='enterizos'`],
  bolsos_y_marroquineria: [Prisma.sql`(p.category='accesorios' and p.subcategory='bolsos')`],
};

function buildCategoryFilterCondition(categories: string[]): Prisma.Sql {
  const normalized = categories.map((value) => value.trim()).filter(Boolean);
  const groups = normalized.map((category) => {
    const parts: Prisma.Sql[] = [Prisma.sql`p.category = ${category}`];
    const aliases = CATEGORY_FILTER_ALIASES[category];
    if (aliases?.length) parts.push(...aliases);
    return Prisma.sql`(${Prisma.join(parts, " or ")})`;
  });
  return Prisma.sql`(${Prisma.join(groups, " or ")})`;
}

export function buildProductConditions(filters: CatalogFilters): Prisma.Sql[] {
  const q = filters.q ? `%${filters.q}%` : null;
  const conditions: Prisma.Sql[] = [Prisma.sql`p."imageCoverUrl" is not null`];

  if (filters.enrichedOnly) {
    conditions.push(Prisma.sql`(p."metadata" -> 'enrichment') is not null`);
  }
  if (filters.categories && filters.categories.length > 0) {
    conditions.push(buildCategoryFilterCondition(filters.categories));
  }
  if (filters.subcategories && filters.subcategories.length > 0) {
    conditions.push(Prisma.sql`p.subcategory in (${Prisma.join(filters.subcategories)})`);
  }
  if (filters.brandIds && filters.brandIds.length > 0) {
    conditions.push(Prisma.sql`p."brandId" in (${Prisma.join(filters.brandIds)})`);
  }
  if (filters.genders && filters.genders.length > 0) {
    conditions.push(
      Prisma.sql`(${Prisma.join(filters.genders.map((gender) => genderSqlMap[gender]), " or ")})`
    );
  }
  if (filters.styles && filters.styles.length > 0) {
    conditions.push(Prisma.sql`p."stylePrimary" in (${Prisma.join(filters.styles)})`);
  }
  if (filters.seoTags && filters.seoTags.length > 0) {
    conditions.push(Prisma.sql`p."seoTags" && ${buildTextArray(filters.seoTags)}`);
  }
  if (filters.materials && filters.materials.length > 0) {
    conditions.push(Prisma.sql`p."materialTags" && ${buildTextArray(filters.materials)}`);
  }
  if (filters.patterns && filters.patterns.length > 0) {
    conditions.push(Prisma.sql`p."patternTags" && ${buildTextArray(filters.patterns)}`);
  }
  if (filters.occasions && filters.occasions.length > 0) {
    conditions.push(Prisma.sql`p."occasionTags" && ${buildTextArray(filters.occasions)}`);
  }
  if (filters.seasons && filters.seasons.length > 0) {
    conditions.push(Prisma.sql`p.season in (${Prisma.join(filters.seasons)})`);
  }
  if (q) {
    conditions.push(Prisma.sql`
      (
        p.name ilike ${q}
        or b.name ilike ${q}
        or p."seoTags"::text ilike ${q}
      )
    `);
  }

  return conditions;
}

export function buildVariantConditions(filters: CatalogFilters): Prisma.Sql[] {
  const variantConditions: Prisma.Sql[] = [];
  if (filters.colors && filters.colors.length > 0) {
    const raw = filters.colors.map((value) => value.trim()).filter(Boolean);
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const hex32Re = /^[0-9a-f]{32}$/i;
    const hexRe = /^#?[0-9a-f]{6}$/i;

    const ids: string[] = [];
    const hexes: string[] = [];
    const legacy: string[] = [];

    for (const value of raw) {
      // `standard_colors.id` puede ser UUID o un id hex (char(32) legacy). Ambos deben tratarse como ids.
      if (uuidRe.test(value) || hex32Re.test(value)) {
        ids.push(value);
      } else if (hexRe.test(value)) {
        const normalized = value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
        hexes.push(normalized);
      } else {
        legacy.push(value);
      }
    }

    const conditions: Prisma.Sql[] = [];
    if (ids.length > 0) {
      conditions.push(Prisma.sql`v."standardColorId" in (${Prisma.join(ids)})`);
    }
    if (hexes.length > 0) {
      // Compatibilidad: enlaces viejos que filtraban por hex o por v.color.
      conditions.push(
        Prisma.sql`v."standardColorId" in (select sc.id from standard_colors sc where sc.hex in (${Prisma.join(hexes)}))`,
      );
      conditions.push(Prisma.sql`v.color in (${Prisma.join(hexes)})`);
    }
    if (legacy.length > 0) {
      conditions.push(Prisma.sql`v.color in (${Prisma.join(legacy)})`);
    }

    if (conditions.length > 0) {
      variantConditions.push(Prisma.sql`(${Prisma.join(conditions, " or ")})`);
    }
  }
  if (filters.sizes && filters.sizes.length > 0) {
    variantConditions.push(Prisma.sql`v.size in (${Prisma.join(filters.sizes)})`);
  }
  if (filters.fits && filters.fits.length > 0) {
    variantConditions.push(Prisma.sql`v.fit in (${Prisma.join(filters.fits)})`);
  }
  if (filters.priceRanges && filters.priceRanges.length > 0) {
    const parts: Prisma.Sql[] = [];
    for (const range of filters.priceRanges) {
      const min = typeof range.min === "number" && Number.isFinite(range.min) ? range.min : null;
      const max = typeof range.max === "number" && Number.isFinite(range.max) ? range.max : null;
      if (min === null && max === null) continue;
      if (min !== null && max !== null && max < min) continue;
      if (min !== null && max !== null) parts.push(Prisma.sql`(v.price between ${min} and ${max})`);
      else if (min !== null) parts.push(Prisma.sql`(v.price >= ${min})`);
      else if (max !== null) parts.push(Prisma.sql`(v.price <= ${max})`);
    }
    if (parts.length > 0) {
      variantConditions.push(Prisma.sql`(${Prisma.join(parts, " or ")})`);
    }
  } else {
    if (filters.priceMin !== undefined) {
      variantConditions.push(Prisma.sql`v.price >= ${filters.priceMin}`);
    }
    if (filters.priceMax !== undefined) {
      variantConditions.push(Prisma.sql`v.price <= ${filters.priceMax}`);
    }
  }
  if (filters.inStock) {
    variantConditions.push(
      Prisma.sql`(v.stock > 0 or v."stockStatus" in ('in_stock','preorder'))`
    );
  }
  return variantConditions;
}

export function buildWhere(filters: CatalogFilters): Prisma.Sql {
  const productConditions = buildProductConditions(filters);
  const variantConditions = buildVariantConditions(filters);
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
    where ${Prisma.join(productConditions, " and ")}
    ${variantFilter}
  `;
}

export function buildOrderBy(sort: string, filters?: CatalogFilters): Prisma.Sql {
  const q = filters?.q ? `%${filters.q}%` : null;
  switch (sort) {
    case "price_asc":
      return Prisma.sql`order by min(case when v.price > 0 then v.price end) asc nulls last, p."createdAt" desc`;
    case "price_desc":
      return Prisma.sql`order by max(case when v.price > 0 then v.price end) desc nulls last, p."createdAt" desc`;
    case "relevancia":
      if (q) {
        return Prisma.sql`
          order by
            case
              when p.name ilike ${q} then 0
              when b.name ilike ${q} then 1
              else 2
            end asc,
            p."createdAt" desc
        `;
      }
      return Prisma.sql`order by p."createdAt" desc`;
    case "new":
      return Prisma.sql`order by p."createdAt" desc`;
    default:
      return Prisma.sql`order by p."createdAt" desc`;
  }
}
