import "server-only";

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG } from "@/lib/catalog-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PdpBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  siteUrl: string | null;
  description: string | null;
  instagram: string | null;
  tiktok: string | null;
};

export type PdpSizeOption = {
  variantId: string;
  size: string;
  price: string;
  currency: string;
  inStock: boolean;
  stockStatus: string | null;
};

export type PdpColorGroup = {
  colorKey: string;
  colorName: string;
  colorHex: string | null;
  images: string[];
  sizes: PdpSizeOption[];
  isAvailable: boolean;
};

export type PdpVariant = {
  id: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  fit: string | null;
  material: string | null;
  price: string;
  currency: string;
  stock: number | null;
  stockStatus: string | null;
  images: string[];
  standardColor: {
    id: string;
    family: string;
    name: string;
    hex: string;
  } | null;
};

export type PdpProduct = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  season: string | null;
  care: string | null;
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  realStyle: string | null;
  sourceUrl: string | null;
  imageCoverUrl: string | null;
  minPriceCop: string | null;
  maxPriceCop: string | null;
  currency: string | null;
  hasInStock: boolean;
  priceChangeDirection: string | null;
  priceChangeAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoTags: string[];
  editorialTopPickRank: number | null;
  editorialFavoriteRank: number | null;
  origin: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  brand: PdpBrand;
  variants: PdpVariant[];
  colorGroups: PdpColorGroup[];
};

export type PdpRelatedProduct = {
  id: string;
  name: string;
  slug: string | null;
  imageCoverUrl: string | null;
  brandName: string;
  brandSlug: string;
  category: string | null;
  subcategory: string | null;
  minPrice: string | null;
  currency: string | null;
  sourceUrl: string | null;
};

export type PdpPriceInsight = {
  isBestPrice30d: boolean;
  isDeepDiscount: boolean;
  min30d: number | null;
  max30d: number | null;
};

export type PdpPriceHistoryPoint = {
  price: number;
  date: string; // ISO date string (day only)
};

export type PdpPriceHistory = {
  points: PdpPriceHistoryPoint[];
  currentIsAllTimeLow: boolean;
  daysCovered: number;
};

export type PdpOutfitItem = {
  id: string;
  name: string;
  slug: string | null;
  imageCoverUrl: string | null;
  brandName: string;
  brandSlug: string;
  category: string | null;
  minPrice: string | null;
  currency: string | null;
  sourceUrl: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildColorGroups(
  variants: PdpVariant[],
  coverImage: string | null,
): PdpColorGroup[] {
  const groupMap = new Map<string, PdpColorGroup>();

  for (const v of variants) {
    const colorKey = v.standardColor?.id ?? v.color ?? "_default";
    const colorName =
      v.standardColor?.name ?? v.color ?? "Color único";
    const colorHex = v.standardColor?.hex ?? null;

    let group = groupMap.get(colorKey);
    if (!group) {
      group = {
        colorKey,
        colorName,
        colorHex,
        images: [],
        sizes: [],
        isAvailable: false,
      };
      groupMap.set(colorKey, group);
    }

    // Merge images (deduplicate)
    for (const img of v.images) {
      if (!group.images.includes(img)) {
        group.images.push(img);
      }
    }

    // Add size option if variant has a size
    if (v.size) {
      const inStock =
        v.stockStatus === "in_stock" ||
        (v.stock !== null && v.stock > 0);
      group.sizes.push({
        variantId: v.id,
        size: v.size,
        price: v.price,
        currency: v.currency,
        inStock,
        stockStatus: v.stockStatus,
      });
      if (inStock) group.isAvailable = true;
    }
  }

  // If any group has no images, fall back to cover image
  for (const group of groupMap.values()) {
    if (group.images.length === 0 && coverImage) {
      group.images.push(coverImage);
    }
  }

  return Array.from(groupMap.values());
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

const PDP_REVALIDATE_SECONDS = 120;

export async function getProductByBrandAndSlug(
  brandSlug: string,
  productSlug: string,
): Promise<PdpProduct | null> {
  const cached = unstable_cache(
    async () => {
      const brand = await prisma.brand.findUnique({
        where: { slug: brandSlug },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          siteUrl: true,
          description: true,
          instagram: true,
          tiktok: true,
        },
      });
      if (!brand) return null;

      const product = await prisma.product.findFirst({
        where: { brandId: brand.id, slug: productSlug },
        include: {
          variants: {
            include: {
              standardColor: {
                select: { id: true, family: true, name: true, hex: true },
              },
            },
            orderBy: [{ color: "asc" }, { size: "asc" }],
          },
        },
      });
      if (!product) return null;

      const variants: PdpVariant[] = product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        color: v.color,
        size: v.size,
        fit: v.fit,
        material: v.material,
        price: v.price.toString(),
        currency: v.currency,
        stock: v.stock,
        stockStatus: v.stockStatus,
        images: v.images,
        standardColor: v.standardColor
          ? {
              id: v.standardColor.id,
              family: v.standardColor.family,
              name: v.standardColor.name,
              hex: v.standardColor.hex,
            }
          : null,
      }));

      const colorGroups = buildColorGroups(variants, product.imageCoverUrl);

      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        category: product.category,
        subcategory: product.subcategory,
        gender: product.gender,
        season: product.season,
        care: product.care,
        materialTags: product.materialTags,
        patternTags: product.patternTags,
        occasionTags: product.occasionTags,
        realStyle: product.realStyle,
        sourceUrl: product.sourceUrl,
        imageCoverUrl: product.imageCoverUrl,
        minPriceCop: product.minPriceCop?.toString() ?? null,
        maxPriceCop: product.maxPriceCop?.toString() ?? null,
        currency: product.currency,
        hasInStock: product.hasInStock,
        priceChangeDirection: product.priceChangeDirection,
        priceChangeAt: product.priceChangeAt?.toISOString() ?? null,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        seoTags: product.seoTags,
        editorialTopPickRank: product.editorialTopPickRank,
        editorialFavoriteRank: product.editorialFavoriteRank,
        origin: product.origin,
        createdAt: product.createdAt?.toISOString() ?? null,
        updatedAt: product.updatedAt?.toISOString() ?? null,
        brand,
        variants,
        colorGroups,
      } satisfies PdpProduct;
    },
    [`pdp-product-v1`, brandSlug, productSlug],
    { revalidate: PDP_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

export async function getRelatedProducts(
  productId: string,
  options: {
    brandId: string;
    category: string | null;
    gender: string | null;
    realStyle: string | null;
    limit?: number;
  },
): Promise<PdpRelatedProduct[]> {
  const limit = options.limit ?? 12;

  const cached = unstable_cache(
    async () => {
      const seen = new Set<string>([productId]);
      const results: PdpRelatedProduct[] = [];

      const mapRow = (row: {
        id: string;
        name: string;
        slug: string | null;
        imageCoverUrl: string | null;
        minPriceCop: { toString(): string } | null;
        currency: string | null;
        sourceUrl: string | null;
        category: string | null;
        subcategory: string | null;
        brand: { name: string; slug: string };
      }): PdpRelatedProduct => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        imageCoverUrl: row.imageCoverUrl,
        brandName: row.brand.name,
        brandSlug: row.brand.slug,
        category: row.category,
        subcategory: row.subcategory,
        minPrice: row.minPriceCop?.toString() ?? null,
        currency: row.currency,
        sourceUrl: row.sourceUrl,
      });

      const addRows = (
        rows: Array<Parameters<typeof mapRow>[0]>,
      ) => {
        for (const row of rows) {
          if (seen.has(row.id) || results.length >= limit) continue;
          seen.add(row.id);
          results.push(mapRow(row));
        }
      };

      // 1. Same brand + same category
      if (options.category) {
        const sameBrand = await prisma.product.findMany({
          where: {
            brandId: options.brandId,
            category: options.category,
            id: { not: productId },
            hasInStock: true,
            imageCoverUrl: { not: null },
          },
          include: { brand: { select: { name: true, slug: true } } },
          orderBy: { updatedAt: "desc" },
          take: 6,
        });
        addRows(sameBrand);
      }

      if (results.length >= limit) return results;

      // 2. Same category + same gender, different brands
      if (options.category && options.gender) {
        const sameCategory = await prisma.product.findMany({
          where: {
            category: options.category,
            gender: options.gender,
            brandId: { not: options.brandId },
            id: { notIn: Array.from(seen) },
            hasInStock: true,
            imageCoverUrl: { not: null },
          },
          include: { brand: { select: { name: true, slug: true } } },
          orderBy: { updatedAt: "desc" },
          take: limit - results.length,
        });
        addRows(sameCategory);
      }

      if (results.length >= limit) return results;

      // 3. Same realStyle
      if (options.realStyle) {
        const sameStyle = await prisma.product.findMany({
          where: {
            realStyle: options.realStyle,
            id: { notIn: Array.from(seen) },
            hasInStock: true,
            imageCoverUrl: { not: null },
          },
          include: { brand: { select: { name: true, slug: true } } },
          orderBy: { updatedAt: "desc" },
          take: limit - results.length,
        });
        addRows(sameStyle);
      }

      if (results.length >= limit) return results;

      // 4. Fallback: newest in same gender
      if (options.gender) {
        const newest = await prisma.product.findMany({
          where: {
            gender: options.gender,
            id: { notIn: Array.from(seen) },
            hasInStock: true,
            imageCoverUrl: { not: null },
          },
          include: { brand: { select: { name: true, slug: true } } },
          orderBy: { updatedAt: "desc" },
          take: limit - results.length,
        });
        addRows(newest);
      }

      return results;
    },
    [`pdp-related-v1`, productId],
    { revalidate: PDP_REVALIDATE_SECONDS * 2, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

export async function getPriceInsight(
  productId: string,
  currentMinPrice: string | null,
): Promise<PdpPriceInsight> {
  if (!currentMinPrice || Number(currentMinPrice) <= 0) {
    return { isBestPrice30d: false, isDeepDiscount: false, min30d: null, max30d: null };
  }

  const cached = unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await prisma.priceHistory.aggregate({
        where: {
          variant: { productId },
          capturedAt: { gte: thirtyDaysAgo },
        },
        _min: { price: true },
        _max: { price: true },
      });

      const min30d = result._min.price ? Number(result._min.price) : null;
      const max30d = result._max.price ? Number(result._max.price) : null;
      const current = Number(currentMinPrice);

      const isBestPrice30d = min30d !== null && current <= min30d;
      const isDeepDiscount =
        max30d !== null && max30d > 0 && (max30d - current) / max30d >= 0.3;

      return { isBestPrice30d, isDeepDiscount, min30d, max30d };
    },
    [`pdp-price-insight-v1`, productId],
    { revalidate: 240, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

export async function getPriceHistory(
  productId: string,
  currentMinPrice: string | null,
): Promise<PdpPriceHistory> {
  const empty: PdpPriceHistory = { points: [], currentIsAllTimeLow: false, daysCovered: 0 };
  if (!currentMinPrice || Number(currentMinPrice) <= 0) return empty;

  const cached = unstable_cache(
    async () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const rows: { day: Date; minPrice: unknown }[] = await prisma.$queryRaw`
        SELECT date_trunc('day', ph."capturedAt") AS day,
               MIN(ph.price) AS "minPrice"
        FROM price_history ph
        JOIN variants v ON v.id = ph."variantId"
        WHERE v."productId" = ${productId}
          AND ph."capturedAt" >= ${ninetyDaysAgo}
        GROUP BY day
        ORDER BY day
      `;

      if (rows.length < 7) return empty;

      const points: PdpPriceHistoryPoint[] = rows.map((r) => ({
        price: Number(r.minPrice),
        date: new Date(r.day).toISOString().split("T")[0],
      }));

      const allTimeMin = Math.min(...points.map((p) => p.price));
      const current = Number(currentMinPrice);
      const currentIsAllTimeLow = current <= allTimeMin;

      return {
        points,
        currentIsAllTimeLow,
        daysCovered: points.length,
      };
    },
    [`pdp-price-history-v1`, productId],
    { revalidate: 600, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}

export async function getOutfitSuggestions(
  productId: string,
  options: {
    category: string | null;
    gender: string | null;
    realStyle: string | null;
  },
): Promise<PdpOutfitItem[]> {
  if (!options.category) return [];

  const cached = unstable_cache(
    async () => {
      const { getComplementaryCategories } = await import("@/lib/outfit-categories");
      const complementGroups = getComplementaryCategories(options.category);
      if (complementGroups.length === 0) return [];

      const results: PdpOutfitItem[] = [];

      for (const categories of complementGroups.slice(0, 3)) {
        if (results.length >= 3) break;

        const whereClause: Record<string, unknown> = {
          category: { in: categories },
          id: { not: productId },
          hasInStock: true,
          imageCoverUrl: { not: null },
        };

        if (options.gender) {
          whereClause.gender = options.gender;
        }
        if (options.realStyle) {
          whereClause.realStyle = options.realStyle;
        }

        const product = await prisma.product.findFirst({
          where: whereClause,
          include: { brand: { select: { name: true, slug: true } } },
          orderBy: { randomSortKey: "asc" },
        });

        if (product) {
          results.push({
            id: product.id,
            name: product.name,
            slug: product.slug,
            imageCoverUrl: product.imageCoverUrl,
            brandName: product.brand.name,
            brandSlug: product.brand.slug,
            category: product.category,
            minPrice: product.minPriceCop?.toString() ?? null,
            currency: product.currency,
            sourceUrl: product.sourceUrl,
          });
        }
      }

      return results;
    },
    [`pdp-outfit-v1`, productId],
    { revalidate: 600, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}
