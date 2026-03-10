/**
 * Reclassification suggestion generation.
 *
 * Scans products' embeddings against trained centroids, identifies
 * products whose nearest centroid disagrees with their current
 * classification, and creates pending suggestions for human review.
 *
 * Supports three levels:
 * - "category": compares against 26 category centroids (Level 1)
 * - "subcategory": compares against subcategory centroids, optionally
 *   filtered to a single category for on-demand scans (Level 2)
 * - "gender": compares against gender centroids
 */

import { prisma } from "@/lib/prisma";
import type { ModelType } from "./types";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_MIN_MARGIN,
  RECLASSIFICATION_BATCH_SIZE,
} from "./constants";

// ── Types ───────────────────────────────────────────────────────────

type ScanOptions = {
  similarityThreshold?: number;
  minMargin?: number;
  batchSize?: number;
  /** If set, only scan products in these IDs. */
  productIds?: string[];
  /** If set, only scan products/centroids in this category (subcategory model). */
  filterCategory?: string;
};

type ScanResult = {
  scanned: number;
  suggested: number;
  skippedExisting: number;
  runId: string;
};

type CategoryDistanceRow = {
  productId: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  centroid_category: string;
  distance: number;
};

type ProductDistanceRow = {
  productId: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  centroid_subcategory: string;
  centroid_category: string;
  distance: number;
};

type GenderDistanceRow = {
  productId: string;
  gender: string | null;
  centroid_gender: string;
  distance: number;
};

// ── Main scan ───────────────────────────────────────────────────────

/**
 * Run a full reclassification scan for the given model type.
 *
 * For each product with an embedding:
 * 1. Compute cosine distance to every centroid (category, subcategory, or gender).
 * 2. Find the nearest and second-nearest centroids.
 * 3. If the nearest centroid disagrees with the product's current
 *    classification AND similarity exceeds the threshold AND the margin
 *    between top-2 centroids is large enough, create a suggestion.
 *
 * @param modelType - "category", "subcategory", or "gender"
 * @param options   - Thresholds, batch configuration, and category filter.
 * @returns Summary with counts and the model run ID.
 */
export async function runReclassificationScan(
  modelType: ModelType,
  options?: ScanOptions,
): Promise<ScanResult> {
  const threshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minMargin = options?.minMargin ?? DEFAULT_MIN_MARGIN;
  const batchSize = options?.batchSize ?? RECLASSIFICATION_BATCH_SIZE;

  // Create a model run for tracking
  const run = await prisma.vectorModelRun.create({
    data: {
      modelType,
      status: "running",
    },
  });

  try {
    let scanned = 0;
    let suggested = 0;
    let skippedExisting = 0;

    if (modelType === "category") {
      const result = await scanCategories(
        run.id,
        threshold,
        minMargin,
        batchSize,
        options?.productIds,
      );
      scanned = result.scanned;
      suggested = result.suggested;
      skippedExisting = result.skippedExisting;
    } else if (modelType === "subcategory") {
      const result = await scanSubcategories(
        run.id,
        threshold,
        minMargin,
        batchSize,
        options?.productIds,
        options?.filterCategory,
      );
      scanned = result.scanned;
      suggested = result.suggested;
      skippedExisting = result.skippedExisting;
    } else {
      const result = await scanGender(
        run.id,
        threshold,
        minMargin,
        batchSize,
        options?.productIds,
      );
      scanned = result.scanned;
      suggested = result.suggested;
      skippedExisting = result.skippedExisting;
    }

    // Complete the run
    await prisma.vectorModelRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        totalSamples: scanned,
        completedAt: new Date(),
        metrics: {
          scanned,
          suggested,
          skippedExisting,
          threshold,
          minMargin,
          ...(options?.filterCategory ? { category: options.filterCategory } : {}),
        },
      },
    });

    return { scanned, suggested, skippedExisting, runId: run.id };
  } catch (error) {
    await prisma.vectorModelRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

// ── Category scan ───────────────────────────────────────────────────

async function scanCategories(
  runId: string,
  threshold: number,
  minMargin: number,
  batchSize: number,
  filterProductIds?: string[],
): Promise<{ scanned: number; suggested: number; skippedExisting: number }> {
  let scanned = 0;
  let suggested = 0;
  let skippedExisting = 0;
  let cursor: string | null = null;

  while (true) {
    let productIds: string[];

    if (filterProductIds) {
      productIds = filterProductIds.slice(scanned, scanned + batchSize);
      if (productIds.length === 0) break;
    } else {
      const rows = await prisma.$queryRawUnsafe<{ productId: string }[]>(
        cursor
          ? `SELECT "productId" FROM product_embeddings
             WHERE combined_embedding IS NOT NULL AND "productId" > $1
             ORDER BY "productId" LIMIT $2`
          : `SELECT "productId" FROM product_embeddings
             WHERE combined_embedding IS NOT NULL
             ORDER BY "productId" LIMIT $1`,
        ...(cursor ? [cursor, batchSize] : [batchSize]),
      );

      if (rows.length === 0) break;
      productIds = rows.map((r) => r.productId);
      cursor = productIds[productIds.length - 1];
    }

    // Compute distances to all category centroids for this batch
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(",");

    const distances = await prisma.$queryRawUnsafe<CategoryDistanceRow[]>(
      `SELECT
         pe."productId" AS "productId",
         p.category,
         p.subcategory,
         p.gender,
         cc.category AS centroid_category,
         (pe.combined_embedding <=> cc.centroid_embedding) AS distance
       FROM product_embeddings pe
       JOIN products p ON p.id = pe."productId"
       CROSS JOIN category_centroids cc
       WHERE pe."productId" IN (${placeholders})
         AND pe.combined_embedding IS NOT NULL
         AND cc.centroid_embedding IS NOT NULL
       ORDER BY pe."productId", distance`,
      ...productIds,
    );

    // Group by product and evaluate top-2 centroids
    const grouped = groupByProduct(distances, "productId");

    for (const [productId, rows] of grouped) {
      scanned++;
      if (rows.length < 2) continue;

      const nearest = rows[0];
      const secondNearest = rows[1];
      const similarity = 1 - nearest.distance;
      const margin = secondNearest.distance - nearest.distance;

      // Skip if current classification matches nearest centroid
      if (nearest.centroid_category === nearest.category) continue;

      // Skip if below threshold or margin
      if (similarity < threshold) continue;
      if (margin < minMargin) continue;

      // Check for existing pending suggestion
      const existing = await prisma.vectorReclassificationSuggestion.findFirst({
        where: {
          productId,
          modelType: "category",
          status: "pending",
        },
      });

      if (existing) {
        skippedExisting++;
        continue;
      }

      // Create suggestion
      await prisma.vectorReclassificationSuggestion.create({
        data: {
          productId,
          modelType: "category",
          fromCategory: nearest.category,
          fromSubcategory: nearest.subcategory,
          fromGender: nearest.gender,
          toCategory: nearest.centroid_category,
          toSubcategory: null, // category model doesn't suggest subcategory
          toGender: nearest.gender, // category model doesn't change gender
          confidence: similarity,
          vectorDistance: nearest.distance,
          margin,
          status: "pending",
          runId,
        },
      });

      suggested++;
    }

    if (filterProductIds && scanned >= filterProductIds.length) break;
  }

  return { scanned, suggested, skippedExisting };
}

// ── Subcategory scan ────────────────────────────────────────────────

async function scanSubcategories(
  runId: string,
  threshold: number,
  minMargin: number,
  batchSize: number,
  filterProductIds?: string[],
  filterCategory?: string,
): Promise<{ scanned: number; suggested: number; skippedExisting: number }> {
  let scanned = 0;
  let suggested = 0;
  let skippedExisting = 0;
  let cursor: string | null = null;

  // Escape category for safe SQL interpolation
  const categoryCondition = filterCategory
    ? `AND p_filter.category = '${filterCategory.replace(/'/g, "''")}'`
    : "";
  const centroidCategoryCondition = filterCategory
    ? `AND sc.category = '${filterCategory.replace(/'/g, "''")}'`
    : "";

  while (true) {
    // Fetch a page of product IDs with embeddings
    let productIds: string[];

    if (filterProductIds) {
      // Use a subset from the filter list
      productIds = filterProductIds.slice(scanned, scanned + batchSize);
      if (productIds.length === 0) break;
    } else if (filterCategory) {
      // Fetch products filtered by category
      const rows = await prisma.$queryRawUnsafe<{ productId: string }[]>(
        cursor
          ? `SELECT pe."productId" FROM product_embeddings pe
             JOIN products p_filter ON p_filter.id = pe."productId"
             WHERE pe.combined_embedding IS NOT NULL
               AND pe."productId" > $1
               ${categoryCondition}
             ORDER BY pe."productId" LIMIT $2`
          : `SELECT pe."productId" FROM product_embeddings pe
             JOIN products p_filter ON p_filter.id = pe."productId"
             WHERE pe.combined_embedding IS NOT NULL
               ${categoryCondition}
             ORDER BY pe."productId" LIMIT $1`,
        ...(cursor ? [cursor, batchSize] : [batchSize]),
      );

      if (rows.length === 0) break;
      productIds = rows.map((r) => r.productId);
      cursor = productIds[productIds.length - 1];
    } else {
      const rows = await prisma.$queryRawUnsafe<{ productId: string }[]>(
        cursor
          ? `SELECT "productId" FROM product_embeddings
             WHERE combined_embedding IS NOT NULL AND "productId" > $1
             ORDER BY "productId" LIMIT $2`
          : `SELECT "productId" FROM product_embeddings
             WHERE combined_embedding IS NOT NULL
             ORDER BY "productId" LIMIT $1`,
        ...(cursor ? [cursor, batchSize] : [batchSize]),
      );

      if (rows.length === 0) break;
      productIds = rows.map((r) => r.productId);
      cursor = productIds[productIds.length - 1];
    }

    // Compute distances to subcategory centroids for this batch
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(",");

    const distances = await prisma.$queryRawUnsafe<ProductDistanceRow[]>(
      `SELECT
         pe."productId" AS "productId",
         p.category,
         p.subcategory,
         p.gender,
         sc.subcategory AS centroid_subcategory,
         sc.category    AS centroid_category,
         (pe.combined_embedding <=> sc.centroid_embedding) AS distance
       FROM product_embeddings pe
       JOIN products p ON p.id = pe."productId"
       CROSS JOIN subcategory_centroids sc
       WHERE pe."productId" IN (${placeholders})
         AND pe.combined_embedding IS NOT NULL
         AND sc.centroid_embedding IS NOT NULL
         ${centroidCategoryCondition}
       ORDER BY pe."productId", distance`,
      ...productIds,
    );

    // Group by product and evaluate top-2 centroids
    const grouped = groupByProduct(distances, "productId");

    for (const [productId, rows] of grouped) {
      scanned++;
      if (rows.length < 2) continue;

      const nearest = rows[0];
      const secondNearest = rows[1];
      const similarity = 1 - nearest.distance;
      const margin = secondNearest.distance - nearest.distance;

      // Skip if current classification matches nearest centroid
      if (nearest.centroid_subcategory === nearest.subcategory) continue;

      // Skip if below threshold or margin
      if (similarity < threshold) continue;
      if (margin < minMargin) continue;

      // Check for existing pending suggestion
      const existing = await prisma.vectorReclassificationSuggestion.findFirst({
        where: {
          productId,
          modelType: "subcategory",
          status: "pending",
        },
      });

      if (existing) {
        skippedExisting++;
        continue;
      }

      // Create suggestion
      await prisma.vectorReclassificationSuggestion.create({
        data: {
          productId,
          modelType: "subcategory",
          fromCategory: nearest.category,
          fromSubcategory: nearest.subcategory,
          fromGender: nearest.gender,
          toCategory: nearest.centroid_category,
          toSubcategory: nearest.centroid_subcategory,
          toGender: nearest.gender, // subcategory model doesn't change gender
          confidence: similarity,
          vectorDistance: nearest.distance,
          margin,
          status: "pending",
          runId,
        },
      });

      suggested++;
    }

    // If using filterProductIds, break when we've consumed them all
    if (filterProductIds && scanned >= filterProductIds.length) break;
  }

  return { scanned, suggested, skippedExisting };
}

// ── Gender scan ─────────────────────────────────────────────────────

async function scanGender(
  runId: string,
  threshold: number,
  minMargin: number,
  batchSize: number,
  filterProductIds?: string[],
): Promise<{ scanned: number; suggested: number; skippedExisting: number }> {
  let scanned = 0;
  let suggested = 0;
  let skippedExisting = 0;
  let cursor: string | null = null;

  while (true) {
    let productIds: string[];

    if (filterProductIds) {
      productIds = filterProductIds.slice(scanned, scanned + batchSize);
      if (productIds.length === 0) break;
    } else {
      const rows = await prisma.$queryRawUnsafe<{ productId: string }[]>(
        cursor
          ? `SELECT "productId" FROM product_embeddings
             WHERE combined_embedding IS NOT NULL AND "productId" > $1
             ORDER BY "productId" LIMIT $2`
          : `SELECT "productId" FROM product_embeddings
             WHERE combined_embedding IS NOT NULL
             ORDER BY "productId" LIMIT $1`,
        ...(cursor ? [cursor, batchSize] : [batchSize]),
      );

      if (rows.length === 0) break;
      productIds = rows.map((r) => r.productId);
      cursor = productIds[productIds.length - 1];
    }

    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(",");

    const distances = await prisma.$queryRawUnsafe<GenderDistanceRow[]>(
      `SELECT
         pe."productId" AS "productId",
         p.gender,
         gc.gender AS centroid_gender,
         (pe.combined_embedding <=> gc.centroid_embedding) AS distance
       FROM product_embeddings pe
       JOIN products p ON p.id = pe."productId"
       CROSS JOIN gender_centroids gc
       WHERE pe."productId" IN (${placeholders})
         AND pe.combined_embedding IS NOT NULL
         AND gc.centroid_embedding IS NOT NULL
       ORDER BY pe."productId", distance`,
      ...productIds,
    );

    const grouped = groupByProduct(distances, "productId");

    for (const [productId, rows] of grouped) {
      scanned++;
      if (rows.length < 2) continue;

      const nearest = rows[0];
      const secondNearest = rows[1];
      const similarity = 1 - nearest.distance;
      const margin = secondNearest.distance - nearest.distance;

      if (nearest.centroid_gender === nearest.gender) continue;
      if (similarity < threshold) continue;
      if (margin < minMargin) continue;

      const existing = await prisma.vectorReclassificationSuggestion.findFirst({
        where: {
          productId,
          modelType: "gender",
          status: "pending",
        },
      });

      if (existing) {
        skippedExisting++;
        continue;
      }

      // For gender suggestions, fetch product's current category/subcategory
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { category: true, subcategory: true },
      });

      await prisma.vectorReclassificationSuggestion.create({
        data: {
          productId,
          modelType: "gender",
          fromCategory: product?.category ?? null,
          fromSubcategory: product?.subcategory ?? null,
          fromGender: nearest.gender,
          toCategory: product?.category ?? null,
          toSubcategory: product?.subcategory ?? null,
          toGender: nearest.centroid_gender,
          confidence: similarity,
          vectorDistance: nearest.distance,
          margin,
          status: "pending",
          runId,
        },
      });

      suggested++;
    }

    if (filterProductIds && scanned >= filterProductIds.length) break;
  }

  return { scanned, suggested, skippedExisting };
}

// ── Suggestion actions ──────────────────────────────────────────────

/**
 * Accept a reclassification suggestion: update the product's
 * classification and optionally add it to ground truth.
 *
 * @param suggestionId    - The suggestion UUID.
 * @param userId          - Optional user who accepted.
 * @param addToGroundTruth - Whether to also create a GroundTruthProduct.
 */
export async function acceptSuggestion(
  suggestionId: string,
  userId?: string,
  addToGroundTruth?: boolean,
): Promise<void> {
  const suggestion = await prisma.vectorReclassificationSuggestion.findUniqueOrThrow({
    where: { id: suggestionId },
  });

  if (suggestion.status !== "pending") {
    throw new Error(`Suggestion ${suggestionId} is already ${suggestion.status}`);
  }

  // Update the product
  const updateData: Record<string, string | null> = {};
  if (suggestion.modelType === "category") {
    // Category-level: only change category, leave subcategory for later scan
    if (suggestion.toCategory != null) updateData.category = suggestion.toCategory;
  } else if (suggestion.modelType === "subcategory") {
    if (suggestion.toCategory != null) updateData.category = suggestion.toCategory;
    if (suggestion.toSubcategory != null) updateData.subcategory = suggestion.toSubcategory;
  } else {
    if (suggestion.toGender != null) updateData.gender = suggestion.toGender;
  }

  await prisma.product.update({
    where: { id: suggestion.productId },
    data: updateData,
  });

  // Mark suggestion as accepted
  await prisma.vectorReclassificationSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: "accepted",
      decidedAt: new Date(),
      decidedByUserId: userId ?? null,
    },
  });

  // Add accepted product to ground truth for model retraining.
  // GroundTruthProduct requires category + subcategory (both NOT NULL).
  if (addToGroundTruth) {
    let gtCategory: string | null = null;
    let gtSubcategory: string | null = null;
    let gtGender: string | null = null;

    if (suggestion.modelType === "subcategory") {
      gtCategory = suggestion.toCategory;
      gtSubcategory = suggestion.toSubcategory;
      gtGender = suggestion.toGender;
    } else if (suggestion.modelType === "category") {
      // Category suggestion changes category; subcategory preserved from product
      gtCategory = suggestion.toCategory;
      const product = await prisma.product.findUnique({
        where: { id: suggestion.productId },
        select: { subcategory: true, gender: true },
      });
      gtSubcategory = product?.subcategory ?? null;
      gtGender = product?.gender ?? null;
    } else {
      // Gender suggestion preserves category/subcategory, changes gender
      gtCategory = suggestion.toCategory;
      gtSubcategory = suggestion.toSubcategory;
      gtGender = suggestion.toGender;
    }

    if (gtSubcategory && gtCategory) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ground_truth_products (id, "productId", subcategory, category, gender, "confirmedAt", "confirmedByUserId", "isActive", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), $5, true, NOW(), NOW())
         ON CONFLICT ("productId", subcategory)
         DO UPDATE SET
           category          = $3,
           gender            = $4,
           "confirmedAt"     = NOW(),
           "confirmedByUserId" = $5,
           "isActive"        = true,
           "updatedAt"       = NOW()`,
        suggestion.productId,
        gtSubcategory,
        gtCategory,
        gtGender,
        userId ?? null,
      );
    }
  }
}

/**
 * Reject a reclassification suggestion.
 *
 * @param suggestionId - The suggestion UUID.
 * @param userId       - Optional user who rejected.
 * @param note         - Optional note explaining the rejection.
 */
export async function rejectSuggestion(
  suggestionId: string,
  userId?: string,
  note?: string,
): Promise<void> {
  const suggestion = await prisma.vectorReclassificationSuggestion.findUniqueOrThrow({
    where: { id: suggestionId },
  });

  if (suggestion.status !== "pending") {
    throw new Error(`Suggestion ${suggestionId} is already ${suggestion.status}`);
  }

  await prisma.vectorReclassificationSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: "rejected",
      decidedAt: new Date(),
      decidedByUserId: userId ?? null,
      decisionNote: note ?? null,
    },
  });
}

// ── Utilities ───────────────────────────────────────────────────────

/**
 * Group an array of rows by a string key field, preserving order within
 * each group (important because rows arrive sorted by distance).
 */
function groupByProduct<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = row[key] as string;
    let arr = map.get(k);
    if (!arr) {
      arr = [];
      map.set(k, arr);
    }
    arr.push(row);
  }
  return map;
}
