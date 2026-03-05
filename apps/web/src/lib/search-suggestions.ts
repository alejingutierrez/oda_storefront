import "server-only";

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG } from "@/lib/catalog-cache";
import {
  CATEGORY_OPTIONS,
  MATERIAL_TAGS,
  MATERIAL_TAG_FRIENDLY,
  PATTERN_TAGS,
  PATTERN_TAG_FRIENDLY,
  OCCASION_TAGS,
  OCCASION_TAG_FRIENDLY,
} from "@/lib/product-enrichment/constants";
import { REAL_STYLE_OPTIONS } from "@/lib/real-style/constants";
import { labelize, labelizeSubcategory } from "@/lib/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuggestionTermItem = {
  type: "category" | "subcategory" | "brand" | "material" | "pattern" | "occasion" | "realStyle";
  value: string;
  label: string;
  href: string;
  count?: number;
};

export type SuggestionProductItem = {
  id: string;
  name: string;
  brandName: string;
  imageCoverUrl: string | null;
  minPrice: string | null;
  href: string;
};

export type SearchSuggestionsResponse = {
  query: string;
  groups: {
    terms: SuggestionTermItem[];
    brands: SuggestionTermItem[];
    products: SuggestionProductItem[];
  };
};

// ---------------------------------------------------------------------------
// Text normalization (accent-insensitive, lowercase)
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// In-memory taxonomy index (built once at module load, zero DB cost)
// ---------------------------------------------------------------------------

type TaxonomyEntry = {
  type: SuggestionTermItem["type"];
  value: string;
  label: string;
  href: string;
  searchText: string; // pre-normalized for matching
  weight: number; // type priority weight
};

const taxonomyIndex: TaxonomyEntry[] = [];

// Categories + subcategories
for (const cat of CATEGORY_OPTIONS) {
  taxonomyIndex.push({
    type: "category",
    value: cat.value,
    label: labelize(cat.value),
    href: `/catalogo?category=${cat.value}`,
    searchText: normalize(cat.label),
    weight: 1.5,
  });
  for (const sub of cat.subcategories) {
    taxonomyIndex.push({
      type: "subcategory",
      value: sub.value,
      label: labelizeSubcategory(sub.value),
      href: `/catalogo?category=${cat.value}&subcategory=${sub.value}`,
      searchText: normalize(sub.label),
      weight: 1.3,
    });
  }
}

// Materials
for (const key of MATERIAL_TAGS) {
  const label = MATERIAL_TAG_FRIENDLY[key] ?? labelize(key);
  taxonomyIndex.push({
    type: "material",
    value: key,
    label,
    href: `/catalogo?material=${key}`,
    searchText: normalize(label),
    weight: 1.0,
  });
}

// Patterns
for (const key of PATTERN_TAGS) {
  const label = PATTERN_TAG_FRIENDLY[key] ?? labelize(key);
  taxonomyIndex.push({
    type: "pattern",
    value: key,
    label,
    href: `/catalogo?pattern=${key}`,
    searchText: normalize(label),
    weight: 0.9,
  });
}

// Occasions
for (const key of OCCASION_TAGS) {
  const label = OCCASION_TAG_FRIENDLY[key] ?? labelize(key);
  taxonomyIndex.push({
    type: "occasion",
    value: key,
    label,
    href: `/catalogo?occasion=${key}`,
    searchText: normalize(label),
    weight: 1.0,
  });
}

// Real styles
for (const rs of REAL_STYLE_OPTIONS) {
  taxonomyIndex.push({
    type: "realStyle",
    value: rs.key,
    label: rs.label,
    href: `/catalogo?style=${rs.key}`,
    searchText: normalize(rs.label),
    weight: 0.8,
  });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreMatch(searchText: string, normalizedQuery: string): number {
  if (searchText === normalizedQuery) return 100;
  if (searchText.startsWith(normalizedQuery)) return 90;
  if (searchText.includes(normalizedQuery)) return 70;
  const words = searchText.split(/\s+/);
  if (words.some((w) => w.startsWith(normalizedQuery))) return 60;
  return 0;
}

// ---------------------------------------------------------------------------
// Brand list (cached via unstable_cache, matched in-memory)
// ---------------------------------------------------------------------------

type BrandEntry = { id: string; name: string; productCount: number };

const getActiveBrands = unstable_cache(
  async (): Promise<BrandEntry[]> => {
    const rows = await prisma.$queryRaw<BrandEntry[]>(Prisma.sql`
      SELECT b.id, b.name,
        (SELECT count(*) FROM products p
         WHERE p."brandId" = b.id
           AND p."imageCoverUrl" IS NOT NULL
           AND (p.metadata -> 'enrichment') IS NOT NULL
        )::int AS "productCount"
      FROM brands b
      WHERE b."isActive" = true
      ORDER BY b.name
    `);
    return rows.filter((r) => r.productCount > 0);
  },
  ["search-active-brands", "cache-v1"],
  { revalidate: 1800, tags: [CATALOG_CACHE_TAG] },
);

// ---------------------------------------------------------------------------
// Product search (DB query using tsvector + pg_trgm)
// ---------------------------------------------------------------------------

function buildTsQuery(input: string): string {
  const words = input
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (words.length === 0) return "";
  return words.map((w) => `${w}:*`).join(" & ");
}

async function searchProducts(query: string, limit: number): Promise<SuggestionProductItem[]> {
  const tsQuery = buildTsQuery(query);
  if (!tsQuery) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      brandName: string;
      imageCoverUrl: string | null;
      minPrice: string | null;
      sourceUrl: string | null;
    }>
  >(Prisma.sql`
    SELECT
      p.id,
      p.name,
      b.name AS "brandName",
      p."imageCoverUrl",
      p."minPriceCop"::text AS "minPrice",
      p."sourceUrl"
    FROM products p
    JOIN brands b ON b.id = p."brandId"
    WHERE p."imageCoverUrl" IS NOT NULL
      AND (p.metadata -> 'enrichment') IS NOT NULL
      AND p."hasInStock" = true
      AND (
        p.search_vector @@ to_tsquery('spanish', ${tsQuery})
        OR p.name % ${query}
      )
    ORDER BY
      ts_rank_cd(p.search_vector, to_tsquery('spanish', ${tsQuery}), 32) * 2.0
      + similarity(p.name, ${query})
      + CASE WHEN p."editorialFavoriteRank" IS NOT NULL THEN 0.2 ELSE 0.0 END
      DESC,
      p."createdAt" DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    brandName: r.brandName,
    imageCoverUrl: r.imageCoverUrl,
    minPrice: r.minPrice,
    href: r.sourceUrl ?? "#",
  }));
}

// ---------------------------------------------------------------------------
// Main suggestion function
// ---------------------------------------------------------------------------

export async function getSearchSuggestions(
  query: string,
  limit = 12,
): Promise<SearchSuggestionsResponse> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { query: trimmed, groups: { terms: [], brands: [], products: [] } };
  }

  const nq = normalize(trimmed);

  // 1) Taxonomy matching (in-memory, ~0ms)
  const termMatches: Array<TaxonomyEntry & { score: number }> = [];
  for (const entry of taxonomyIndex) {
    const raw = scoreMatch(entry.searchText, nq);
    if (raw > 0) {
      termMatches.push({ ...entry, score: raw * entry.weight });
    }
  }
  termMatches.sort((a, b) => b.score - a.score);

  const terms: SuggestionTermItem[] = termMatches.slice(0, 6).map((m) => ({
    type: m.type,
    value: m.value,
    label: m.label,
    href: m.href,
  }));

  // 2) Brand matching (in-memory from cached list)
  const brands: SuggestionTermItem[] = [];
  try {
    const allBrands = await getActiveBrands();
    const brandMatches: Array<BrandEntry & { score: number }> = [];
    for (const b of allBrands) {
      const raw = scoreMatch(normalize(b.name), nq);
      if (raw > 0) {
        brandMatches.push({ ...b, score: raw * 1.2 });
      }
    }
    brandMatches.sort((a, b) => b.score - a.score);

    for (const m of brandMatches.slice(0, 3)) {
      brands.push({
        type: "brand",
        value: m.id,
        label: m.name,
        href: `/catalogo?brandId=${m.id}`,
        count: m.productCount,
      });
    }
  } catch {
    // Brand matching is non-critical; degrade gracefully.
  }

  // 3) Product search (DB query, only for >= 3 chars to reduce noise)
  let products: SuggestionProductItem[] = [];
  if (trimmed.length >= 3) {
    try {
      products = await searchProducts(trimmed, 4);
    } catch {
      // Product search is non-critical; degrade gracefully.
    }
  }

  return { query: trimmed, groups: { terms, brands, products } };
}
