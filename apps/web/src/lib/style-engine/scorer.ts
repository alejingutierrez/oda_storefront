/**
 * StyleSwipe Scoring Algorithm
 *
 * Uses weighted Jaccard similarity across 4 tag categories:
 *   styleTags (50%) + occasionTags (20%) + materialTags (15%) + patternTags (15%)
 *
 * Each tag in the user profile carries a weightedCount, so tags that appeared
 * in more liked items contribute more to the intersection score.
 *
 * Refinement preferences (occasion, fit, palette) add a bonus boost (max +15%).
 */

import { prisma } from "@/lib/prisma";
import type {
  AttributeEntry,
  SessionPreferences,
  ScoredProduct,
} from "./types";
import { CATEGORY_WEIGHTS } from "./types";

type TagCategory = keyof typeof CATEGORY_WEIGHTS;

/** Product shape needed for scoring. */
type ScorableProduct = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  minPriceCop: { toString(): string } | null;
  maxPriceCop: { toString(): string } | null;
  currency: string | null;
  slug: string | null;
  brand: { name: string; slug: string | null };
};

type ProfileMap = Record<string, AttributeEntry>;

/**
 * Weighted Jaccard: intersection tags use the profile's weightedCount,
 * union tags use max(profileWeight, 0.1) so unknown tags don't dominate.
 */
function weightedJaccard(
  productTags: string[],
  profileMap: ProfileMap,
  category: TagCategory,
): number {
  if (productTags.length === 0) return 0;

  // Collect all relevant profile tags for this category
  const profileTags = new Set<string>();
  for (const entry of Object.values(profileMap)) {
    if (entry.category === category) {
      profileTags.add(entry.tag);
    }
  }

  if (profileTags.size === 0 && productTags.length === 0) return 0;

  const productSet = new Set(productTags);
  const union = new Set([...productSet, ...profileTags]);

  let intersectionSum = 0;
  let unionSum = 0;

  for (const tag of union) {
    const key = `${category}:${tag}`;
    const profileWeight = profileMap[key]?.weightedCount ?? 0;
    const inProduct = productSet.has(tag);

    if (inProduct && profileWeight > 0) {
      // Tag in both: use profile weight for intersection
      intersectionSum += profileWeight;
    }
    // Union: always add max of profile weight or a small base
    unionSum += Math.max(profileWeight, 0.1);
  }

  if (unionSum === 0) return 0;
  return intersectionSum / unionSum;
}

/**
 * Compute preference boost from the refinement step.
 * Max boost: +15 points (10 for occasion, 5 for fit-related, 5 for palette).
 * Capped at +15 total.
 */
function preferenceBoost(
  product: ScorableProduct,
  preferences: SessionPreferences,
): number {
  let boost = 0;

  // Occasion boost (+10)
  if (preferences.occasion && product.occasionTags.length > 0) {
    const occasionMap: Record<string, string[]> = {
      casual: ["casual", "diario", "informal", "urbano_casual"],
      trabajo: ["oficina", "trabajo", "profesional", "formal"],
      salidas: ["fiesta", "noche", "salida", "evento", "cita"],
      deporte: ["deporte", "gym", "activewear", "funcional"],
    };
    const mapped = occasionMap[preferences.occasion] ?? [preferences.occasion];
    if (product.occasionTags.some((t) => mapped.includes(t))) {
      boost += 10;
    }
  }

  // Palette boost (+5)
  if (preferences.palette && product.styleTags.length > 0) {
    const paletteMap: Record<string, string[]> = {
      neutros: [
        "paleta_neutros_tierras",
        "paleta_monocromatico",
        "paleta_blancos_cremas",
        "neutro",
        "beige",
      ],
      tierra: [
        "tonos_tierra",
        "paleta_neutros_tierras",
        "marron",
        "terracota",
        "oliva",
      ],
      vivos: [
        "paleta_colores_vivos",
        "colorblock",
        "saturado",
        "brillo",
        "paleta_pasteles",
      ],
      monocromatico: [
        "paleta_monocromatico",
        "negro",
        "blanco",
        "gris",
        "total_black",
        "total_white",
      ],
    };
    const mapped = paletteMap[preferences.palette] ?? [preferences.palette];
    if (product.styleTags.some((t) => mapped.includes(t))) {
      boost += 5;
    }
  }

  // Fit boost (+5) — checked against styleTags since fit is embedded there
  if (preferences.fit && product.styleTags.length > 0) {
    const fitMap: Record<string, string[]> = {
      oversize: ["oversize", "holgado", "amplio", "volumetrico"],
      relajado: ["relajado", "fluido", "comodo", "casual"],
      regular: ["regular", "clasico", "estandar"],
      ajustado: ["ajustado", "slim", "entallado", "ceñido", "bodycon"],
    };
    const mapped = fitMap[preferences.fit] ?? [preferences.fit];
    if (product.styleTags.some((t) => mapped.includes(t))) {
      boost += 5;
    }
  }

  return Math.min(boost, 15);
}

/**
 * Score a single product against the user's attribute profile.
 */
export function scoreProduct(
  product: ScorableProduct,
  profileMap: ProfileMap,
  preferences: SessionPreferences,
): number {
  const styleScore = weightedJaccard(product.styleTags, profileMap, "style");
  const occasionScore = weightedJaccard(product.occasionTags, profileMap, "occasion");
  const materialScore = weightedJaccard(product.materialTags, profileMap, "material");
  const patternScore = weightedJaccard(product.patternTags, profileMap, "pattern");

  const baseScore =
    (CATEGORY_WEIGHTS.style * styleScore +
      CATEGORY_WEIGHTS.occasion * occasionScore +
      CATEGORY_WEIGHTS.material * materialScore +
      CATEGORY_WEIGHTS.pattern * patternScore) *
    100;

  const boost = preferenceBoost(product, preferences);

  return Math.min(99, Math.round(baseScore + boost));
}

/**
 * Score and paginate product recommendations.
 *
 * @param userId       - User ID (to exclude existing favorites)
 * @param profileMap   - Serialised attribute profile from the profile calculator
 * @param preferences  - Refinement preferences from the session
 * @param tier         - "top" (≥70%) or "explore" (30-69%)
 * @param page         - 1-based page number
 * @param limit        - Items per page
 */
export async function getRecommendations(
  userId: string,
  profileMap: ProfileMap,
  preferences: SessionPreferences,
  tier: "top" | "explore" = "top",
  page: number = 1,
  limit: number = 20,
): Promise<{ items: ScoredProduct[]; hasMore: boolean }> {
  // Get user's existing favorite product IDs to exclude
  const favoriteProductIds = await prisma.userFavorite.findMany({
    where: { userId },
    select: { productId: true },
  });
  const excludeIds = new Set(favoriteProductIds.map((f) => f.productId));

  // Fetch all eligible products (enriched + in stock)
  // For catalogs <5000 this is fast enough in-memory
  const products = await prisma.product.findMany({
    where: {
      hasInStock: true,
      imageCoverUrl: { not: null },
      styleTags: { isEmpty: false },
      status: "active",
    },
    select: {
      id: true,
      name: true,
      imageCoverUrl: true,
      styleTags: true,
      materialTags: true,
      patternTags: true,
      occasionTags: true,
      minPriceCop: true,
      maxPriceCop: true,
      currency: true,
      slug: true,
      brand: { select: { name: true, slug: true } },
    },
  });

  // Score all products
  const scored: ScoredProduct[] = [];
  for (const product of products) {
    if (excludeIds.has(product.id)) continue;

    const matchScore = scoreProduct(product, profileMap, preferences);

    // Filter by tier
    if (tier === "top" && matchScore < 70) continue;
    if (tier === "explore" && (matchScore >= 70 || matchScore < 30)) continue;

    scored.push({
      id: product.id,
      name: product.name,
      brandName: product.brand.name,
      imageCoverUrl: product.imageCoverUrl!,
      minPriceCop: product.minPriceCop?.toString() ?? null,
      maxPriceCop: product.maxPriceCop?.toString() ?? null,
      currency: product.currency,
      matchScore,
      slug: product.slug,
      brandSlug: product.brand.slug,
    });
  }

  // Sort by match score descending
  scored.sort((a, b) => b.matchScore - a.matchScore);

  // Paginate
  const start = (page - 1) * limit;
  const pageItems = scored.slice(start, start + limit);
  const hasMore = start + limit < scored.length;

  return { items: pageItems, hasMore };
}
