/**
 * Taxonomy merge logic for subcategories and categories.
 *
 * Handles the full cascade: products, ground truth, suggestions,
 * SEO pages, taxonomy snapshots, and centroid retraining.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { acquireLock, releaseLock, getRedis, isRedisEnabled } from "@/lib/redis";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import {
  getOrCreateDraftTaxonomyMeta,
  saveDraftTaxonomy,
  publishDraftTaxonomy,
  invalidateTaxonomyCache,
} from "@/lib/taxonomy/server";
import { trainCategoryCentroids, trainSubcategoryCentroids } from "./centroids";
import type { MergeType, MergePreviewResult, MergeResult } from "./types";

const MERGE_LOCK_KEY = "taxonomy-merge:lock";
const MERGE_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Preview (dry-run) ───────────────────────────────────────────

export async function previewMerge(params: {
  mergeType: MergeType;
  sourceKeys: string[];
  targetKey: string;
  targetCategory?: string | null;
}): Promise<MergePreviewResult> {
  const { mergeType, sourceKeys, targetKey, targetCategory = null } = params;
  const warnings: string[] = [];

  if (mergeType === "subcategory") {
    const [products, groundTruth, suggestions, seoPages, centroids] = await Promise.all([
      prisma.product.count({ where: { subcategory: { in: sourceKeys } } }),
      prisma.groundTruthProduct.count({ where: { subcategory: { in: sourceKeys } } }),
      prisma.vectorReclassificationSuggestion.count({
        where: {
          status: "pending",
          OR: [
            { fromSubcategory: { in: sourceKeys } },
            { toSubcategory: { in: sourceKeys } },
          ],
        },
      }),
      prisma.plpSeoPage.count({ where: { subcategoryKey: { in: sourceKeys } } }),
      prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*) AS cnt FROM subcategory_centroids WHERE subcategory = ANY($1)`,
        sourceKeys,
      ),
    ]);

    if (products === 0) {
      warnings.push("Las subcategorías fuente no tienen productos asociados.");
    }

    return {
      mergeType,
      sourceKeys,
      targetKey,
      targetCategory,
      counts: {
        products,
        groundTruth,
        suggestions,
        seoPages,
        centroids: Number(centroids[0]?.cnt ?? 0),
      },
      warnings,
    };
  }

  // Category merge
  const [products, groundTruth, suggestions, seoPages, centroids, subcatCount] =
    await Promise.all([
      prisma.product.count({ where: { category: { in: sourceKeys } } }),
      prisma.groundTruthProduct.count({ where: { category: { in: sourceKeys } } }),
      prisma.vectorReclassificationSuggestion.count({
        where: {
          status: "pending",
          OR: [
            { fromCategory: { in: sourceKeys } },
            { toCategory: { in: sourceKeys } },
          ],
        },
      }),
      prisma.plpSeoPage.count({ where: { categoryKey: { in: sourceKeys } } }),
      prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*) AS cnt FROM category_centroids WHERE category = ANY($1)`,
        sourceKeys,
      ),
      prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*) AS cnt FROM subcategory_centroids WHERE category = ANY($1)`,
        sourceKeys,
      ),
    ]);

  if (products === 0) {
    warnings.push("Las categorías fuente no tienen productos asociados.");
  }

  return {
    mergeType,
    sourceKeys,
    targetKey,
    targetCategory: null,
    counts: {
      products,
      groundTruth,
      suggestions,
      seoPages,
      centroids: Number(centroids[0]?.cnt ?? 0),
      subcategoriesMoved: Number(subcatCount[0]?.cnt ?? 0),
    },
    warnings,
  };
}

// ── Execute merge ───────────────────────────────────────────────

export async function executeMerge(params: {
  mergeType: MergeType;
  sourceKeys: string[];
  targetKey: string;
  targetCategory?: string | null;
}): Promise<MergeResult> {
  const { mergeType, sourceKeys, targetKey, targetCategory } = params;

  // Acquire lock
  const lock = await acquireLock(MERGE_LOCK_KEY, MERGE_LOCK_TTL_MS);
  if (!lock) {
    return {
      ok: false,
      mergeType,
      productsUpdated: 0,
      groundTruthUpdated: 0,
      suggestionsUpdated: 0,
      seoUpdated: 0,
      taxonomyPublished: false,
      centroidRetrained: false,
      error: "Otra operación de merge está en curso. Intenta de nuevo en unos minutos.",
    };
  }

  try {
    if (mergeType === "subcategory") {
      return await executeSubcategoryMerge({ sourceKeys, targetKey, targetCategory: targetCategory ?? targetKey, lock });
    }
    return await executeCategoryMerge({ sourceKeys, targetKey, lock });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Log failed merge
    await prisma.taxonomyMergeLog.create({
      data: {
        mergeType,
        sourceKeys,
        targetKey,
        targetCategory,
        status: "failed",
        error: errorMsg,
      },
    });

    return {
      ok: false,
      mergeType,
      productsUpdated: 0,
      groundTruthUpdated: 0,
      suggestionsUpdated: 0,
      seoUpdated: 0,
      taxonomyPublished: false,
      centroidRetrained: false,
      error: errorMsg,
    };
  } finally {
    await releaseLock(lock);
  }
}

// ── Subcategory merge ───────────────────────────────────────────

async function executeSubcategoryMerge(params: {
  sourceKeys: string[];
  targetKey: string;
  targetCategory: string;
  lock: NonNullable<Awaited<ReturnType<typeof acquireLock>>>;
}): Promise<MergeResult> {
  const { sourceKeys, targetKey, targetCategory } = params;

  // Phase A — Transactional data updates
  const txResult = await prisma.$transaction(async (tx) => {
    // 1. Update products
    const productsResult = await tx.$executeRawUnsafe(
      `UPDATE products SET subcategory = $1, category = $2, "updatedAt" = NOW()
       WHERE subcategory = ANY($3)`,
      targetKey,
      targetCategory,
      sourceKeys,
    );

    // 2. Remove duplicate ground truth rows before rename
    await tx.$executeRawUnsafe(
      `DELETE FROM ground_truth_products
       WHERE subcategory = ANY($1)
         AND "productId" IN (
           SELECT "productId" FROM ground_truth_products WHERE subcategory = $2
         )`,
      sourceKeys,
      targetKey,
    );

    // 3. Update remaining ground truth
    const gtResult = await tx.$executeRawUnsafe(
      `UPDATE ground_truth_products SET subcategory = $1, category = $2, "updatedAt" = NOW()
       WHERE subcategory = ANY($3)`,
      targetKey,
      targetCategory,
      sourceKeys,
    );

    // 4. Close pending suggestions
    const sugResult = await tx.$executeRawUnsafe(
      `UPDATE vector_reclassification_suggestions
       SET status = 'rejected', "decisionNote" = 'Cerrado por fusión de subcategorías', "decidedAt" = NOW()
       WHERE status = 'pending'
         AND ("fromSubcategory" = ANY($1) OR "toSubcategory" = ANY($1))`,
      sourceKeys,
    );

    // 5. Delete SEO pages for source subcategories
    const seoResult = await tx.$executeRawUnsafe(
      `DELETE FROM plp_seo_pages WHERE "subcategoryKey" = ANY($1)`,
      sourceKeys,
    );

    return {
      productsUpdated: productsResult,
      groundTruthUpdated: gtResult,
      suggestionsUpdated: sugResult,
      seoUpdated: seoResult,
    };
  });

  // Phase B — Taxonomy update + auto-publish
  let taxonomyPublished = false;
  try {
    const draft = await getOrCreateDraftTaxonomyMeta({ adminEmail: null });
    const data = structuredClone(draft.data);

    for (const cat of data.categories) {
      for (const sub of cat.subcategories ?? []) {
        if (sourceKeys.includes(sub.key)) {
          sub.isActive = false;
        }
      }
    }

    await saveDraftTaxonomy({ adminEmail: null, data });
    const publishResult = await publishDraftTaxonomy({ adminEmail: null });
    taxonomyPublished = "ok" in publishResult && publishResult.ok === true;
  } catch (err) {
    console.error("[merge] taxonomy update failed", err);
  }

  // Phase C — Centroid retraining
  let centroidRetrained = false;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM subcategory_centroids WHERE subcategory = ANY($1)`,
      sourceKeys,
    );
    await trainSubcategoryCentroids(targetCategory);
    centroidRetrained = true;
  } catch (err) {
    console.error("[merge] centroid retraining failed", err);
  }

  // Phase D — Cache invalidation + audit
  await invalidateCaches();

  await prisma.taxonomyMergeLog.create({
    data: {
      mergeType: "subcategory",
      sourceKeys,
      sourceCategory: sourceKeys[0],
      targetKey,
      targetCategory,
      productsUpdated: txResult.productsUpdated,
      groundTruthUpdated: txResult.groundTruthUpdated,
      suggestionsUpdated: txResult.suggestionsUpdated,
      seoUpdated: txResult.seoUpdated,
      taxonomyPublished,
      centroidRetrained,
      status: "completed",
    },
  });

  return {
    ok: true,
    mergeType: "subcategory",
    ...txResult,
    taxonomyPublished,
    centroidRetrained,
  };
}

// ── Category merge ──────────────────────────────────────────────

async function executeCategoryMerge(params: {
  sourceKeys: string[];
  targetKey: string;
  lock: NonNullable<Awaited<ReturnType<typeof acquireLock>>>;
}): Promise<MergeResult> {
  const { sourceKeys, targetKey } = params;

  // Phase A — Transactional data updates
  const txResult = await prisma.$transaction(async (tx) => {
    // 1. Update products (category only, keep subcategory intact)
    const productsResult = await tx.$executeRawUnsafe(
      `UPDATE products SET category = $1, "updatedAt" = NOW()
       WHERE category = ANY($2)`,
      targetKey,
      sourceKeys,
    );

    // 2. Update ground truth
    const gtResult = await tx.$executeRawUnsafe(
      `UPDATE ground_truth_products SET category = $1, "updatedAt" = NOW()
       WHERE category = ANY($2)`,
      targetKey,
      sourceKeys,
    );

    // 3. Close pending suggestions
    const sugResult = await tx.$executeRawUnsafe(
      `UPDATE vector_reclassification_suggestions
       SET status = 'rejected', "decisionNote" = 'Cerrado por fusión de categorías', "decidedAt" = NOW()
       WHERE status = 'pending'
         AND ("fromCategory" = ANY($1) OR "toCategory" = ANY($1))`,
      sourceKeys,
    );

    // 4. Update SEO pages
    const seoResult = await tx.$executeRawUnsafe(
      `UPDATE plp_seo_pages SET "categoryKey" = $1
       WHERE "categoryKey" = ANY($2)`,
      targetKey,
      sourceKeys,
    );

    // 5. Move subcategory centroids to target category
    await tx.$executeRawUnsafe(
      `UPDATE subcategory_centroids SET category = $1, "updatedAt" = NOW()
       WHERE category = ANY($2)`,
      targetKey,
      sourceKeys,
    );

    return {
      productsUpdated: productsResult,
      groundTruthUpdated: gtResult,
      suggestionsUpdated: sugResult,
      seoUpdated: seoResult,
    };
  });

  // Phase B — Taxonomy update + auto-publish
  let taxonomyPublished = false;
  try {
    const draft = await getOrCreateDraftTaxonomyMeta({ adminEmail: null });
    const data = structuredClone(draft.data);

    // Find target category
    const targetCat = data.categories.find((c) => c.key === targetKey);
    if (targetCat) {
      // Move subcategories from source categories to target
      for (const sourceCat of data.categories) {
        if (!sourceKeys.includes(sourceCat.key)) continue;

        const existingSubKeys = new Set(
          (targetCat.subcategories ?? []).map((s) => s.key),
        );
        for (const sub of sourceCat.subcategories ?? []) {
          if (!existingSubKeys.has(sub.key)) {
            targetCat.subcategories = targetCat.subcategories ?? [];
            targetCat.subcategories.push(sub);
          }
        }

        // Mark source category as inactive
        sourceCat.isActive = false;
        sourceCat.subcategories = (sourceCat.subcategories ?? []).map((s) => ({
          ...s,
          isActive: false,
        }));
      }
    }

    await saveDraftTaxonomy({ adminEmail: null, data });
    const publishResult = await publishDraftTaxonomy({ adminEmail: null });
    taxonomyPublished = "ok" in publishResult && publishResult.ok === true;
  } catch (err) {
    console.error("[merge] taxonomy update failed", err);
  }

  // Phase C — Centroid retraining
  let centroidRetrained = false;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM category_centroids WHERE category = ANY($1)`,
      sourceKeys,
    );
    await trainCategoryCentroids();
    await trainSubcategoryCentroids(targetKey);
    centroidRetrained = true;
  } catch (err) {
    console.error("[merge] centroid retraining failed", err);
  }

  // Phase D — Cache invalidation + audit
  await invalidateCaches();

  await prisma.taxonomyMergeLog.create({
    data: {
      mergeType: "category",
      sourceKeys,
      targetKey,
      productsUpdated: txResult.productsUpdated,
      groundTruthUpdated: txResult.groundTruthUpdated,
      suggestionsUpdated: txResult.suggestionsUpdated,
      seoUpdated: txResult.seoUpdated,
      taxonomyPublished,
      centroidRetrained,
      status: "completed",
    },
  });

  return {
    ok: true,
    mergeType: "category",
    ...txResult,
    taxonomyPublished,
    centroidRetrained,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

async function invalidateCaches() {
  invalidateTaxonomyCache();
  await invalidateCatalogCache();

  // Clear vector-map projection caches
  if (isRedisEnabled()) {
    try {
      const redis = getRedis();
      const keys = await redis.keys("vector-map:proj:*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Non-critical
    }
  }
}
