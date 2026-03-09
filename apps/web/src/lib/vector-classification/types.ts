/**
 * Shared types for the vector classification system.
 *
 * This module defines the data shapes used across embedding generation,
 * centroid training, and reclassification scanning.
 */

/** Supported model types for vector classification. */
export type ModelType = "subcategory" | "gender";

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
  subcategory: string;
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
