/**
 * Configuration constants for the vector classification system.
 *
 * Uses Amazon Bedrock Titan Multimodal Embeddings G1 for both
 * text and image embeddings in the same 1024-d vector space.
 */

// ── Embedding model ─────────────────────────────────────────────────
export const EMBEDDING_MODEL = "amazon.titan-embed-image-v1";
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_BATCH_SIZE = 40; // concurrent Bedrock calls per sub-batch
export const DESCRIPTION_MAX_LENGTH = 500;

// ── Reclassification thresholds ─────────────────────────────────────
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
export const DEFAULT_MIN_MARGIN = 0.05;
export const RECLASSIFICATION_BATCH_SIZE = 1000;

// ── Training readiness ──────────────────────────────────────────────
export const SMALL_SUBCATEGORY_THRESHOLD = 200;
export const SMALL_SUBCATEGORY_MIN_RATIO = 1 / 3; // confirmed > total/3
export const LARGE_SUBCATEGORY_MIN_CONFIRMED = 100;
