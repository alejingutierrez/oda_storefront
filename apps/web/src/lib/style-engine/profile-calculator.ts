/**
 * StyleSwipe Profile Calculator
 *
 * Computes a user's style profile from:
 * 1. Current session interactions (likes=1.0, maybe=0.5)
 * 2. Existing UserFavorites (weight=0.7)
 * 3. Previous session interactions (likes=0.6, maybe=0.3)
 *
 * Outputs: coherence score, keywords, dynamic dimensions, and the
 * serialisable attribute profile used by the scorer.
 */

import { prisma } from "@/lib/prisma";
import type {
  AttributeEntry,
  AttributeProfile,
  StyleDimension,
  StyleProfileResult,
} from "./types";
import { DIMENSION_CLUSTERS, SOURCE_WEIGHTS } from "./types";

type ProductTags = {
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  realStyle: string | null;
};

/** Add tags from a product to the profile with a given weight. */
function addProductToProfile(
  profile: AttributeProfile,
  product: ProductTags,
  weight: number,
) {
  const addTags = (tags: string[], category: AttributeEntry["category"]) => {
    for (const tag of tags) {
      const key = `${category}:${tag}`;
      const existing = profile.get(key);
      if (existing) {
        existing.weightedCount += weight;
        existing.productCount += 1;
      } else {
        profile.set(key, { tag, category, weightedCount: weight, productCount: 1 });
      }
    }
  };

  addTags(product.styleTags, "style");
  addTags(product.materialTags, "material");
  addTags(product.patternTags, "pattern");
  addTags(product.occasionTags, "occasion");
}

/**
 * Calculate Shannon entropy over a frequency distribution.
 * Returns a value between 0 (perfectly concentrated) and log2(n) (uniform).
 */
function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Compute coherence as inverse normalised entropy over realStyle distribution. */
function computeCoherence(realStyleCounts: Map<string, number>): number {
  const counts = [...realStyleCounts.values()];
  if (counts.length <= 1) return 100;
  const maxEntropy = Math.log2(8); // 8 possible realStyles
  const entropy = shannonEntropy(counts);
  return Math.round(100 * (1 - entropy / maxEntropy));
}

/** Extract top keywords from the profile. */
function extractKeywords(profile: AttributeProfile, topN: number = 5): string[] {
  return [...profile.values()]
    .sort((a, b) => b.weightedCount - a.weightedCount)
    .slice(0, topN)
    .map((e) => formatTagLabel(e.tag));
}

/** Format a snake_case tag into a human-readable label. */
function formatTagLabel(tag: string): string {
  return tag
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Compute dynamic dimensions from the profile using predefined clusters. */
function computeDimensions(profile: AttributeProfile): StyleDimension[] {
  const allTags = new Set<string>();
  for (const entry of profile.values()) {
    allTags.add(entry.tag);
  }

  const dimensions: StyleDimension[] = [];

  for (const [label, clusterTags] of Object.entries(DIMENSION_CLUSTERS)) {
    let totalWeight = 0;
    let matchCount = 0;

    for (const clusterTag of clusterTags) {
      // Check across all categories
      for (const category of ["style", "material", "pattern", "occasion"] as const) {
        const key = `${category}:${clusterTag}`;
        const entry = profile.get(key);
        if (entry) {
          totalWeight += entry.weightedCount;
          matchCount++;
        }
      }
    }

    if (matchCount === 0) continue;

    // Normalise: score relative to cluster size and weight
    // Max possible = clusterTags.length * max single weight
    const maxSingleWeight = Math.max(
      ...([...profile.values()].map((e) => e.weightedCount)),
      1,
    );
    const maxPossible = clusterTags.length * maxSingleWeight;
    const score = Math.round(Math.min(100, (totalWeight / maxPossible) * 100));

    if (score >= 15) {
      dimensions.push({ label, score });
    }
  }

  return dimensions
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Serialise the AttributeProfile Map into a plain object. */
function serialiseProfile(
  profile: AttributeProfile,
): Record<string, AttributeEntry> {
  const result: Record<string, AttributeEntry> = {};
  for (const [key, entry] of profile) {
    result[key] = entry;
  }
  return result;
}

/**
 * Main entry: calculate the full style profile for a user+session.
 */
export async function calculateStyleProfile(
  userId: string,
  sessionId: string,
): Promise<StyleProfileResult> {
  const profile: AttributeProfile = new Map();
  const realStyleCounts = new Map<string, number>();

  // 1. Current session interactions
  const currentInteractions = await prisma.styleInteraction.findMany({
    where: {
      sessionId,
      action: { in: ["like", "maybe"] },
    },
    select: {
      action: true,
      product: {
        select: {
          styleTags: true,
          materialTags: true,
          patternTags: true,
          occasionTags: true,
          realStyle: true,
        },
      },
    },
  });

  for (const interaction of currentInteractions) {
    const weight =
      interaction.action === "like"
        ? SOURCE_WEIGHTS.currentLike
        : SOURCE_WEIGHTS.currentMaybe;
    addProductToProfile(profile, interaction.product, weight);

    if (interaction.action === "like" && interaction.product.realStyle) {
      const style = interaction.product.realStyle;
      realStyleCounts.set(style, (realStyleCounts.get(style) ?? 0) + 1);
    }
  }

  // 2. Existing favorites
  const favorites = await prisma.userFavorite.findMany({
    where: { userId },
    select: {
      product: {
        select: {
          styleTags: true,
          materialTags: true,
          patternTags: true,
          occasionTags: true,
          realStyle: true,
        },
      },
    },
  });

  for (const fav of favorites) {
    addProductToProfile(profile, fav.product, SOURCE_WEIGHTS.favorite);
    if (fav.product.realStyle) {
      const style = fav.product.realStyle;
      realStyleCounts.set(
        style,
        (realStyleCounts.get(style) ?? 0) + SOURCE_WEIGHTS.favorite,
      );
    }
  }

  // 3. Previous session interactions (excluding current session)
  const previousInteractions = await prisma.styleInteraction.findMany({
    where: {
      session: { userId, id: { not: sessionId } },
      action: { in: ["like", "maybe"] },
    },
    select: {
      action: true,
      product: {
        select: {
          styleTags: true,
          materialTags: true,
          patternTags: true,
          occasionTags: true,
          realStyle: true,
        },
      },
    },
  });

  for (const interaction of previousInteractions) {
    const weight =
      interaction.action === "like"
        ? SOURCE_WEIGHTS.previousLike
        : SOURCE_WEIGHTS.previousMaybe;
    addProductToProfile(profile, interaction.product, weight);

    if (interaction.action === "like" && interaction.product.realStyle) {
      const style = interaction.product.realStyle;
      realStyleCounts.set(
        style,
        (realStyleCounts.get(style) ?? 0) + SOURCE_WEIGHTS.previousLike,
      );
    }
  }

  // Compute outputs
  const coherenceScore = computeCoherence(realStyleCounts);
  const keywords = extractKeywords(profile);
  const dimensions = computeDimensions(profile);

  return {
    coherenceScore,
    keywords,
    dimensions,
    attributeProfile: serialiseProfile(profile),
  };
}
