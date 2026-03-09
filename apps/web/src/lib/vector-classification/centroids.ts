/**
 * Centroid calculation and training for vector classification.
 *
 * Computes average embeddings (centroids) from ground-truth products
 * for each subcategory and gender, along with intra-cluster quality
 * metrics. Centroids are stored in `subcategory_centroids` and
 * `gender_centroids` and used by the reclassification scanner.
 */

import { prisma } from "@/lib/prisma";
import type { ModelType, TrainingResult, CentroidMetrics } from "./types";
import {
  MIN_CONFIRMED_FOR_LARGE_SUBCATEGORY,
  MIN_CONFIRMED_FOR_SMALL_SUBCATEGORY,
  LARGE_SUBCATEGORY_THRESHOLD,
} from "./constants";

// ── Readiness check ─────────────────────────────────────────────────

/**
 * Determine whether a subcategory has enough confirmed ground-truth
 * samples to train a reliable centroid.
 *
 * - Small subcategories (< 100 total products): ready when confirmed >= min(5, total)
 * - Large subcategories (>= 100 total products): ready when confirmed >= 100
 */
export function isSubcategoryReady(
  confirmedCount: number,
  totalInSubcategory: number,
): boolean {
  if (totalInSubcategory < LARGE_SUBCATEGORY_THRESHOLD) {
    return confirmedCount >= Math.min(MIN_CONFIRMED_FOR_SMALL_SUBCATEGORY, totalInSubcategory);
  }
  return confirmedCount >= MIN_CONFIRMED_FOR_LARGE_SUBCATEGORY;
}

// ── Subcategory centroid training ───────────────────────────────────

/**
 * Train centroids for every subcategory that has active ground-truth
 * products with embeddings.
 *
 * Steps:
 * 1. Compute the average embedding per (subcategory, category) group.
 * 2. Upsert into `subcategory_centroids`.
 * 3. Calculate intra-cluster distance metrics per centroid.
 * 4. Record a `VectorModelRun`.
 *
 * @returns Training result with centroid count and timing.
 */
export async function trainSubcategoryCentroids(): Promise<TrainingResult> {
  const startedAt = Date.now();

  // Create a model run record
  const run = await prisma.vectorModelRun.create({
    data: {
      modelType: "subcategory",
      status: "running",
    },
  });

  try {
    // 1. Compute centroids (AVG of embeddings per subcategory)
    const centroids = await prisma.$queryRawUnsafe<
      {
        subcategory: string;
        category: string;
        centroid: string; // vector as text
        cnt: bigint;
      }[]
    >(
      `SELECT
         gt.subcategory,
         gt.category,
         AVG(pe.combined_embedding)::text AS centroid,
         COUNT(*) AS cnt
       FROM ground_truth_products gt
       JOIN product_embeddings pe ON pe."productId" = gt."productId"
       WHERE gt."isActive" = true
         AND pe.combined_embedding IS NOT NULL
       GROUP BY gt.subcategory, gt.category`,
    );

    let totalSamples = 0;

    // 2. Upsert each centroid
    for (const c of centroids) {
      const sampleCount = Number(c.cnt);
      totalSamples += sampleCount;

      await prisma.$executeRawUnsafe(
        `INSERT INTO subcategory_centroids (id, subcategory, category, centroid_embedding, sample_count, last_trained_at, model_run_id, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3::vector(1536), $4, NOW(), $5, NOW(), NOW())
         ON CONFLICT (subcategory)
         DO UPDATE SET
           category           = $2,
           centroid_embedding  = $3::vector(1536),
           sample_count        = $4,
           last_trained_at     = NOW(),
           model_run_id        = $5,
           "updatedAt"         = NOW()`,
        c.subcategory,
        c.category,
        c.centroid,
        sampleCount,
        run.id,
      );
    }

    // 3. Calculate intra-cluster metrics for each centroid
    for (const c of centroids) {
      const metrics = await prisma.$queryRawUnsafe<
        {
          avg_dist: number | null;
          max_dist: number | null;
          std_dist: number | null;
        }[]
      >(
        `SELECT
           AVG(pe.combined_embedding <=> sc.centroid_embedding) AS avg_dist,
           MAX(pe.combined_embedding <=> sc.centroid_embedding) AS max_dist,
           STDDEV(pe.combined_embedding <=> sc.centroid_embedding) AS std_dist
         FROM ground_truth_products gt
         JOIN product_embeddings pe ON pe."productId" = gt."productId"
         CROSS JOIN subcategory_centroids sc
         WHERE gt.subcategory = sc.subcategory
           AND gt."isActive" = true
           AND pe.combined_embedding IS NOT NULL
           AND sc.subcategory = $1`,
        c.subcategory,
      );

      const m = metrics[0];
      if (m) {
        await prisma.$executeRawUnsafe(
          `UPDATE subcategory_centroids
           SET avg_intra_distance = $1,
               max_intra_distance = $2,
               std_intra_distance = $3,
               "updatedAt" = NOW()
           WHERE subcategory = $4`,
          m.avg_dist,
          m.max_dist,
          m.std_dist,
          c.subcategory,
        );
      }
    }

    // 4. Complete the model run
    const duration = Date.now() - startedAt;

    await prisma.vectorModelRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        totalCentroids: centroids.length,
        totalSamples,
        completedAt: new Date(),
        metrics: {
          centroidCount: centroids.length,
          totalSamples,
          durationMs: duration,
        },
      },
    });

    return {
      modelType: "subcategory",
      totalCentroids: centroids.length,
      totalSamples,
      metrics: {
        centroidCount: centroids.length,
        durationMs: duration,
      },
      duration,
    };
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

// ── Gender centroid training ────────────────────────────────────────

/**
 * Train centroids for each gender value using ground-truth products.
 *
 * Same pattern as `trainSubcategoryCentroids` but groups by `gender`
 * and writes to `gender_centroids`.
 *
 * @returns Training result with centroid count and timing.
 */
export async function trainGenderCentroids(): Promise<TrainingResult> {
  const startedAt = Date.now();

  const run = await prisma.vectorModelRun.create({
    data: {
      modelType: "gender",
      status: "running",
    },
  });

  try {
    // 1. Compute centroids per gender
    const centroids = await prisma.$queryRawUnsafe<
      {
        gender: string;
        centroid: string;
        cnt: bigint;
      }[]
    >(
      `SELECT
         gt.gender,
         AVG(pe.combined_embedding)::text AS centroid,
         COUNT(*) AS cnt
       FROM ground_truth_products gt
       JOIN product_embeddings pe ON pe."productId" = gt."productId"
       WHERE gt."isActive" = true
         AND gt.gender IS NOT NULL
         AND pe.combined_embedding IS NOT NULL
       GROUP BY gt.gender`,
    );

    let totalSamples = 0;

    // 2. Upsert each centroid
    for (const c of centroids) {
      const sampleCount = Number(c.cnt);
      totalSamples += sampleCount;

      await prisma.$executeRawUnsafe(
        `INSERT INTO gender_centroids (id, gender, centroid_embedding, sample_count, last_trained_at, model_run_id, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2::vector(1536), $3, NOW(), $4, NOW(), NOW())
         ON CONFLICT (gender)
         DO UPDATE SET
           centroid_embedding = $2::vector(1536),
           sample_count       = $3,
           last_trained_at    = NOW(),
           model_run_id       = $4,
           "updatedAt"        = NOW()`,
        c.gender,
        c.centroid,
        sampleCount,
        run.id,
      );
    }

    // 3. Intra-cluster metrics
    for (const c of centroids) {
      const metrics = await prisma.$queryRawUnsafe<
        {
          avg_dist: number | null;
        }[]
      >(
        `SELECT
           AVG(pe.combined_embedding <=> gc.centroid_embedding) AS avg_dist
         FROM ground_truth_products gt
         JOIN product_embeddings pe ON pe."productId" = gt."productId"
         CROSS JOIN gender_centroids gc
         WHERE gt.gender = gc.gender
           AND gt."isActive" = true
           AND pe.combined_embedding IS NOT NULL
           AND gc.gender = $1`,
        c.gender,
      );

      const m = metrics[0];
      if (m) {
        await prisma.$executeRawUnsafe(
          `UPDATE gender_centroids
           SET avg_intra_distance = $1,
               "updatedAt" = NOW()
           WHERE gender = $2`,
          m.avg_dist,
          c.gender,
        );
      }
    }

    // 4. Complete run
    const duration = Date.now() - startedAt;

    await prisma.vectorModelRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        totalCentroids: centroids.length,
        totalSamples,
        completedAt: new Date(),
        metrics: {
          centroidCount: centroids.length,
          totalSamples,
          durationMs: duration,
        },
      },
    });

    return {
      modelType: "gender",
      totalCentroids: centroids.length,
      totalSamples,
      metrics: {
        centroidCount: centroids.length,
        durationMs: duration,
      },
      duration,
    };
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

// ── Centroid listing ────────────────────────────────────────────────

/**
 * Fetch all trained centroids for a given model type with their
 * quality metrics.
 *
 * @param modelType - Either "subcategory" or "gender".
 * @returns Array of centroid metrics objects.
 */
export async function getAllCentroids(
  modelType: ModelType,
): Promise<CentroidMetrics[]> {
  if (modelType === "subcategory") {
    const rows = await prisma.$queryRawUnsafe<
      {
        subcategory: string;
        category: string;
        sample_count: number;
        avg_intra_distance: number | null;
        max_intra_distance: number | null;
        std_intra_distance: number | null;
        last_trained_at: Date | null;
      }[]
    >(
      `SELECT subcategory, category, sample_count,
              avg_intra_distance, max_intra_distance, std_intra_distance,
              last_trained_at
       FROM subcategory_centroids
       ORDER BY category, subcategory`,
    );

    return rows.map((r) => ({
      subcategory: r.subcategory,
      category: r.category,
      sampleCount: r.sample_count,
      avgIntraDistance: r.avg_intra_distance,
      maxIntraDistance: r.max_intra_distance,
      stdIntraDistance: r.std_intra_distance,
      lastTrainedAt: r.last_trained_at?.toISOString() ?? null,
    }));
  }

  // Gender centroids
  const rows = await prisma.$queryRawUnsafe<
    {
      gender: string;
      sample_count: number;
      avg_intra_distance: number | null;
      last_trained_at: Date | null;
    }[]
  >(
    `SELECT gender, sample_count, avg_intra_distance, last_trained_at
     FROM gender_centroids
     ORDER BY gender`,
  );

  return rows.map((r) => ({
    subcategory: r.gender,
    category: "gender",
    sampleCount: r.sample_count,
    avgIntraDistance: r.avg_intra_distance,
    maxIntraDistance: null,
    stdIntraDistance: null,
    lastTrainedAt: r.last_trained_at?.toISOString() ?? null,
  }));
}
