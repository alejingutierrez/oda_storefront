-- AlterTable
ALTER TABLE "variants" ADD COLUMN "colorPantone" TEXT;

-- CreateTable
CREATE TABLE "product_enrichment_runs" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "brandId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "blockReason" TEXT,
    "lastProductId" TEXT,
    "lastStage" TEXT,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "product_enrichment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_enrichment_items" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastStage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_enrichment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_enrichment_runs_brandId_status_idx" ON "product_enrichment_runs"("brandId", "status");

-- CreateIndex
CREATE INDEX "product_enrichment_runs_scope_status_idx" ON "product_enrichment_runs"("scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_enrichment_items_runId_productId_key" ON "product_enrichment_items"("runId", "productId");

-- CreateIndex
CREATE INDEX "product_enrichment_items_runId_status_idx" ON "product_enrichment_items"("runId", "status");

-- CreateIndex
CREATE INDEX "product_enrichment_items_productId_idx" ON "product_enrichment_items"("productId");

-- AddForeignKey
ALTER TABLE "product_enrichment_runs" ADD CONSTRAINT "product_enrichment_runs_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_enrichment_items" ADD CONSTRAINT "product_enrichment_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "product_enrichment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_enrichment_items" ADD CONSTRAINT "product_enrichment_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
