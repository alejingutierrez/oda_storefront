-- CreateTable
CREATE TABLE "taxonomy_merge_logs" (
    "id" TEXT NOT NULL,
    "mergeType" TEXT NOT NULL,
    "sourceKeys" TEXT[],
    "sourceCategory" TEXT,
    "targetKey" TEXT NOT NULL,
    "targetCategory" TEXT,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "groundTruthUpdated" INTEGER NOT NULL DEFAULT 0,
    "suggestionsUpdated" INTEGER NOT NULL DEFAULT 0,
    "seoUpdated" INTEGER NOT NULL DEFAULT 0,
    "taxonomyPublished" BOOLEAN NOT NULL DEFAULT false,
    "centroidRetrained" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taxonomy_merge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taxonomy_merge_logs_createdAt_idx" ON "taxonomy_merge_logs"("createdAt");
