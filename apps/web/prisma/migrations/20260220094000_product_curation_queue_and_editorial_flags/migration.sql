-- Add editorial ranking columns on products
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "editorialFavoriteRank" INTEGER,
  ADD COLUMN IF NOT EXISTS "editorialTopPickRank" INTEGER,
  ADD COLUMN IF NOT EXISTS "editorialUpdatedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_editorial_exclusive_check'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_editorial_exclusive_check"
      CHECK (
        NOT (
          "editorialFavoriteRank" IS NOT NULL
          AND "editorialTopPickRank" IS NOT NULL
        )
      );
  END IF;
END $$;

-- Create apply runs
CREATE TABLE "product_curation_apply_runs" (
  "id" TEXT NOT NULL,
  "requestedItemIdsJson" JSONB,
  "requestedByUserId" TEXT,
  "requestedByEmail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "summaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),

  CONSTRAINT "product_curation_apply_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_curation_apply_runs_status_check" CHECK ("status" IN ('processing', 'completed', 'completed_with_errors', 'failed'))
);

-- Create queue items
CREATE TABLE "product_curation_queue_items" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "source" TEXT,
  "targetScope" TEXT NOT NULL DEFAULT 'snapshot',
  "targetIdsJson" JSONB NOT NULL,
  "targetCount" INTEGER NOT NULL DEFAULT 0,
  "searchKeySnapshot" TEXT,
  "changesJson" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdByEmail" TEXT,
  "applyReportJson" JSONB,
  "lastError" TEXT,
  "runId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "appliedByUserId" TEXT,

  CONSTRAINT "product_curation_queue_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_curation_queue_items_status_check" CHECK ("status" IN ('pending', 'applying', 'applied', 'failed', 'cancelled'))
);

-- Products editorial indexes
CREATE INDEX "products_editorialFavoriteRank_not_null_idx"
  ON "products"("editorialFavoriteRank")
  WHERE "editorialFavoriteRank" IS NOT NULL;

CREATE INDEX "products_editorialTopPickRank_not_null_idx"
  ON "products"("editorialTopPickRank")
  WHERE "editorialTopPickRank" IS NOT NULL;

-- Apply run indexes
CREATE INDEX "product_curation_apply_runs_status_createdAt_idx"
  ON "product_curation_apply_runs"("status", "createdAt");

CREATE INDEX "product_curation_apply_runs_requestedByUserId_idx"
  ON "product_curation_apply_runs"("requestedByUserId");

-- Queue item indexes
CREATE INDEX "product_curation_queue_items_status_orderIndex_idx"
  ON "product_curation_queue_items"("status", "orderIndex");

CREATE INDEX "product_curation_queue_items_createdByUserId_idx"
  ON "product_curation_queue_items"("createdByUserId");

CREATE INDEX "product_curation_queue_items_appliedByUserId_idx"
  ON "product_curation_queue_items"("appliedByUserId");

CREATE INDEX "product_curation_queue_items_runId_idx"
  ON "product_curation_queue_items"("runId");

-- FKs
ALTER TABLE "product_curation_apply_runs"
  ADD CONSTRAINT "product_curation_apply_runs_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "product_curation_queue_items"
  ADD CONSTRAINT "product_curation_queue_items_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "product_curation_queue_items"
  ADD CONSTRAINT "product_curation_queue_items_appliedByUserId_fkey"
  FOREIGN KEY ("appliedByUserId")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "product_curation_queue_items"
  ADD CONSTRAINT "product_curation_queue_items_runId_fkey"
  FOREIGN KEY ("runId")
  REFERENCES "product_curation_apply_runs"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
