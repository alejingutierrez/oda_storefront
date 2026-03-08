/**
 * StyleSwipe Seeding Algorithm
 *
 * Selects products for the swipe deck with two strategies:
 * - First session: diverse sample across all 8 realStyles
 * - Subsequent sessions: 60% refinement (based on profile) + 40% exploration
 */

import { prisma } from "@/lib/prisma";
import type { SwipeItem } from "./types";
import { DEFAULT_DECK_SIZE } from "./types";

/** Fields to select for swipe items. */
const SWIPE_ITEM_SELECT = {
  id: true,
  name: true,
  imageCoverUrl: true,
  realStyle: true,
  styleTags: true,
  materialTags: true,
  patternTags: true,
  occasionTags: true,
  minPriceCop: true,
  maxPriceCop: true,
  currency: true,
  brand: { select: { name: true } },
} as const;

type RawSwipeRow = Awaited<
  ReturnType<typeof prisma.product.findMany<{ select: typeof SWIPE_ITEM_SELECT }>>
>[number];

function toSwipeItem(row: RawSwipeRow): SwipeItem {
  return {
    id: row.id,
    name: row.name,
    brandName: row.brand.name,
    imageCoverUrl: row.imageCoverUrl!,
    realStyle: row.realStyle,
    styleTags: row.styleTags,
    materialTags: row.materialTags,
    patternTags: row.patternTags,
    occasionTags: row.occasionTags,
    minPriceCop: row.minPriceCop?.toString() ?? null,
    maxPriceCop: row.maxPriceCop?.toString() ?? null,
    currency: row.currency,
  };
}

/** Base filters for eligible products. */
function baseWhere(excludeIds: string[]) {
  return {
    hasInStock: true,
    imageCoverUrl: { not: null },
    realStyle: { not: null },
    styleTags: { isEmpty: false },
    ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
  } as const;
}

/** Get product IDs already seen by this user across all sessions. */
async function getSeenProductIds(userId: string): Promise<string[]> {
  const interactions = await prisma.styleInteraction.findMany({
    where: {
      session: { userId },
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  return interactions.map((i) => i.productId);
}

/** Get product IDs seen in a specific session. */
async function getSessionProductIds(sessionId: string): Promise<string[]> {
  const interactions = await prisma.styleInteraction.findMany({
    where: { sessionId },
    select: { productId: true },
    distinct: ["productId"],
  });
  return interactions.map((i) => i.productId);
}

/**
 * First-session seeding: diverse sample across realStyles.
 * Selects ceil(count/numStyles) products per realStyle category.
 */
async function seedDiverse(
  excludeIds: string[],
  count: number,
): Promise<SwipeItem[]> {
  // Get available realStyles
  const styles = await prisma.product.findMany({
    where: baseWhere(excludeIds),
    select: { realStyle: true },
    distinct: ["realStyle"],
  });

  const realStyles = styles
    .map((s) => s.realStyle)
    .filter((s): s is string => s !== null);

  if (realStyles.length === 0) return [];

  const perStyle = Math.ceil(count / realStyles.length);
  const items: SwipeItem[] = [];

  // Fetch products per realStyle in parallel
  const batches = await Promise.all(
    realStyles.map((style) =>
      prisma.product.findMany({
        where: {
          ...baseWhere(excludeIds),
          realStyle: style,
        },
        select: SWIPE_ITEM_SELECT,
        orderBy: { randomSortKey: "asc" },
        take: perStyle,
      }),
    ),
  );

  for (const batch of batches) {
    items.push(...batch.map(toSwipeItem));
  }

  // Shuffle and trim to desired count
  return shuffle(items).slice(0, count);
}

/**
 * Subsequent-session seeding: 60% profile-based + 40% exploration.
 */
async function seedProgressive(
  userId: string,
  excludeIds: string[],
  count: number,
): Promise<SwipeItem[]> {
  const profile = await prisma.userStyleProfile.findUnique({
    where: { userId },
  });

  // If no profile yet, fall back to diverse seeding
  if (!profile) {
    return seedDiverse(excludeIds, count);
  }

  const dimensions = profile.dimensions as Record<string, unknown>;
  const attributeProfile = (dimensions as Record<string, Record<string, unknown>>)?.attributeProfile;

  // Get top style tags from profile for refinement queries
  const topTags: string[] = [];
  if (attributeProfile && typeof attributeProfile === "object") {
    const entries = Object.values(attributeProfile) as Array<{
      tag: string;
      category: string;
      weightedCount: number;
    }>;
    entries
      .filter((e) => e.category === "style")
      .sort((a, b) => b.weightedCount - a.weightedCount)
      .slice(0, 10)
      .forEach((e) => topTags.push(e.tag));
  }

  const refinementCount = Math.ceil(count * 0.6);
  const explorationCount = count - refinementCount;

  // Refinement: products matching top style tags
  const refinementItems = topTags.length > 0
    ? await prisma.product.findMany({
        where: {
          ...baseWhere(excludeIds),
          styleTags: { hasSome: topTags },
        },
        select: SWIPE_ITEM_SELECT,
        orderBy: { randomSortKey: "asc" },
        take: refinementCount,
      })
    : [];

  const usedIds = new Set([
    ...excludeIds,
    ...refinementItems.map((p) => p.id),
  ]);

  // Exploration: random products from less-explored styles
  const explorationItems = await prisma.product.findMany({
    where: {
      ...baseWhere([...usedIds]),
    },
    select: SWIPE_ITEM_SELECT,
    orderBy: { randomSortKey: "asc" },
    take: explorationCount,
  });

  const items = [
    ...refinementItems.map(toSwipeItem),
    ...explorationItems.map(toSwipeItem),
  ];

  return shuffle(items).slice(0, count);
}

/** Fisher-Yates shuffle. */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Main entry point: get items for a swipe session.
 *
 * @param userId   - The authenticated user's ID
 * @param sessionId - The current session ID
 * @param extend   - If true, load additional items for auto-extend (excludes current session items)
 * @param count    - Number of items to load (default 20)
 */
export async function getSwipeItems(
  userId: string,
  sessionId: string,
  extend = false,
  count: number = DEFAULT_DECK_SIZE,
): Promise<SwipeItem[]> {
  // Determine which products to exclude
  let excludeIds: string[];
  if (extend) {
    // When extending, only exclude items already in this session
    excludeIds = await getSessionProductIds(sessionId);
  } else {
    // Initial load: exclude all products seen across all sessions
    excludeIds = await getSeenProductIds(userId);
  }

  // Check if user has a previous profile
  const previousProfile = await prisma.userStyleProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (previousProfile) {
    return seedProgressive(userId, excludeIds, count);
  }

  return seedDiverse(excludeIds, count);
}
