/**
 * Shared types for the vector classification system.
 *
 * This module defines the data shapes used across embedding generation,
 * centroid training, and reclassification scanning.
 */

/** Supported model types for vector classification. */
export type ModelType = "category" | "subcategory" | "gender";

/** Statistics about the embedding coverage of the product catalog. */
export type EmbeddingStats = {
  total: number;
  embedded: number;
  missing: number;
  stale: number;
};

/** Readiness information for a single subcategory's ground truth data. */
export type GroundTruthStats = {
  subcategory: string;
  category: string;
  totalProducts: number;
  confirmedCount: number;
  isReady: boolean;
  threshold: number;
};

/** Quality metrics for a trained centroid. */
export type CentroidMetrics = {
  subcategory: string | null;
  category: string;
  sampleCount: number;
  avgIntraDistance: number | null;
  maxIntraDistance: number | null;
  stdIntraDistance: number | null;
  lastTrainedAt: string | null;
};

/** Result returned after training centroids for a model type. */
export type TrainingResult = {
  modelType: ModelType;
  totalCentroids: number;
  totalSamples: number;
  metrics: Record<string, unknown>;
  duration: number;
};

/** A suggestion to reclassify a product based on vector similarity. */
export type ReclassificationSuggestion = {
  productId: string;
  modelType: ModelType;
  fromCategory: string | null;
  fromSubcategory: string | null;
  fromGender: string | null;
  toCategory: string | null;
  toSubcategory: string | null;
  toGender: string | null;
  confidence: number;
  vectorDistance: number;
  margin: number;
};

// ── Vector Map types ──────────────────────────────────────────────

/** A centroid projected to 2D via UMAP. */
export type ProjectedCentroid = {
  id: string;
  label: string;
  displayLabel: string;
  category: string;
  menuGroup: string;
  x: number;
  y: number;
  sampleCount: number;
  avgIntraDistance: number | null;
  maxIntraDistance: number | null;
  stdIntraDistance: number | null;
  lastTrainedAt: string | null;
};

/** Pairwise distance between two centroids. */
export type DistanceEntry = {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  distance: number;
};

/** Type of merge operation. */
export type MergeType = "subcategory" | "category";

/** Request to preview or execute a taxonomy merge. */
export type MergeRequest = {
  mergeType: MergeType;
  sourceKeys: string[];
  targetKey: string;
  targetCategory?: string;
};

/** Dry-run impact preview for a merge. */
export type MergePreviewResult = {
  mergeType: MergeType;
  sourceKeys: string[];
  targetKey: string;
  targetCategory: string | null;
  counts: {
    products: number;
    groundTruth: number;
    suggestions: number;
    seoPages: number;
    centroids: number;
    subcategoriesMoved?: number;
  };
  warnings: string[];
};

/** Result of an executed merge. */
export type MergeResult = {
  ok: boolean;
  mergeType: MergeType;
  productsUpdated: number;
  groundTruthUpdated: number;
  suggestionsUpdated: number;
  seoUpdated: number;
  taxonomyPublished: boolean;
  centroidRetrained: boolean;
  error?: string;
};
