/**
 * UMAP-based dimensionality reduction for centroid visualization.
 *
 * Fetches centroid embeddings from the database, computes 2D projections
 * via UMAP, and caches results in Redis.
 */

import { UMAP } from "umap-js";
import { prisma } from "@/lib/prisma";
import { readJsonCache, writeJsonCache } from "@/lib/redis";
import type { ProjectedCentroid } from "./types";

type RawCentroid = {
  id: string;
  label: string;
  category: string;
  embedding: string;
  sample_count: number;
  avg_intra_distance: number | null;
  max_intra_distance: number | null;
  std_intra_distance: number | null;
  last_trained_at: Date | null;
};

const PROJECTION_CACHE_TTL = 3600; // 1 hour

function parsePgVector(text: string): number[] {
  return text.replace(/^\[|\]$/g, "").split(",").map(Number);
}

function buildCacheKey(level: string, category: string | null, hash: string): string {
  return `vector-map:proj:${level}:${category ?? "all"}:${hash}`;
}

async function fetchSubcategoryCentroids(category: string | null): Promise<RawCentroid[]> {
  const categoryFilter = category
    ? `WHERE category = '${category.replace(/'/g, "''")}'`
    : "";

  return prisma.$queryRawUnsafe<RawCentroid[]>(
    `SELECT
       id,
       subcategory AS label,
       category,
       centroid_embedding::text AS embedding,
       sample_count,
       avg_intra_distance,
       max_intra_distance,
       std_intra_distance,
       last_trained_at
     FROM subcategory_centroids
     ${categoryFilter}
     ORDER BY category, subcategory`,
  );
}

async function fetchCategoryCentroids(): Promise<RawCentroid[]> {
  return prisma.$queryRawUnsafe<RawCentroid[]>(
    `SELECT
       id,
       category AS label,
       category,
       centroid_embedding::text AS embedding,
       sample_count,
       avg_intra_distance,
       max_intra_distance,
       std_intra_distance,
       last_trained_at
     FROM category_centroids
     ORDER BY category`,
  );
}

async function getMaxUpdatedAt(level: string, category: string | null): Promise<string> {
  const table = level === "category" ? "category_centroids" : "subcategory_centroids";
  const where = level === "subcategory" && category
    ? `WHERE category = '${category.replace(/'/g, "''")}'`
    : "";

  const rows = await prisma.$queryRawUnsafe<{ max_updated: Date | null }[]>(
    `SELECT MAX("updatedAt") AS max_updated FROM ${table} ${where}`,
  );

  return rows[0]?.max_updated?.toISOString() ?? "none";
}

function runUmap(vectors: number[][]): number[][] {
  const n = vectors.length;
  if (n < 2) {
    return vectors.map(() => [0.5, 0.5]);
  }

  const nNeighbors = Math.min(15, n - 1);
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist: 0.1,
    spread: 1.0,
    nEpochs: n < 50 ? 500 : 200,
  });

  const embedding = umap.fit(vectors);

  // Normalize to [0, 1]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of embedding) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const padding = 0.05;

  return embedding.map(([x, y]) => [
    padding + (1 - 2 * padding) * ((x - minX) / rangeX),
    padding + (1 - 2 * padding) * ((y - minY) / rangeY),
  ]);
}

export type ProjectionParams = {
  level: "category" | "subcategory";
  category?: string | null;
  taxonomyLabels: Record<string, string>;
  categoryMenuGroups: Record<string, string>;
};

export async function getProjectedCentroids(
  params: ProjectionParams,
): Promise<ProjectedCentroid[]> {
  const { level, category = null, taxonomyLabels, categoryMenuGroups } = params;

  // Check cache
  const updatedHash = await getMaxUpdatedAt(level, category);
  const cacheKey = buildCacheKey(level, category, updatedHash);

  const cached = await readJsonCache<ProjectedCentroid[]>(cacheKey);
  if (cached) return cached;

  // Fetch raw centroids
  const raw = level === "category"
    ? await fetchCategoryCentroids()
    : await fetchSubcategoryCentroids(category);

  if (raw.length === 0) return [];

  // Parse vectors and run UMAP
  const vectors = raw.map((r) => parsePgVector(r.embedding));
  const projected = runUmap(vectors);

  // Build result
  const result: ProjectedCentroid[] = raw.map((r, i) => ({
    id: r.id,
    label: r.label,
    displayLabel: taxonomyLabels[r.label] ?? r.label,
    category: r.category,
    menuGroup: categoryMenuGroups[r.category] ?? "Lifestyle",
    x: projected[i][0],
    y: projected[i][1],
    sampleCount: r.sample_count,
    avgIntraDistance: r.avg_intra_distance,
    maxIntraDistance: r.max_intra_distance,
    stdIntraDistance: r.std_intra_distance,
    lastTrainedAt: r.last_trained_at?.toISOString() ?? null,
  }));

  // Cache
  await writeJsonCache(cacheKey, result, PROJECTION_CACHE_TTL);

  return result;
}
