-- Fix column name mismatch: raw SQL uses "sample_count" (snake_case)
-- but the migration created the column as "sampleCount" (camelCase).
-- CategoryCentroid already had @map("sample_count") so it was correct.

ALTER TABLE "subcategory_centroids" RENAME COLUMN "sampleCount" TO "sample_count";
ALTER TABLE "gender_centroids" RENAME COLUMN "sampleCount" TO "sample_count";
