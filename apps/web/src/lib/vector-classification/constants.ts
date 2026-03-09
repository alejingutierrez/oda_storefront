/**
 * Configuration constants for the vector classification system.
 *
 * Tune thresholds, batch sizes, and model parameters here
 * rather than scattering magic numbers across modules.
 */

// ── Embedding model ─────────────────────────────────────────────────
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const IMAGE_EMBEDDING_DIMENSIONS = 512;
export const EMBEDDING_BATCH_SIZE = 500;
export const DESCRIPTION_MAX_LENGTH = 500;

// ── Reclassification thresholds ─────────────────────────────────────
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
export const DEFAULT_MIN_MARGIN = 0.05;
export const RECLASSIFICATION_BATCH_SIZE = 1000;

// ── Training readiness ──────────────────────────────────────────────
export const MIN_CONFIRMED_FOR_LARGE_SUBCATEGORY = 100;
export const MIN_CONFIRMED_FOR_SMALL_SUBCATEGORY = 5;
export const LARGE_SUBCATEGORY_THRESHOLD = 100;
