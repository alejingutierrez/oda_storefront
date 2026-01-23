-- CreateTable
CREATE TABLE "catalog_runs" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "platform" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "blockReason" TEXT,
    "lastUrl" TEXT,
    "lastStage" TEXT,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "errorSamples" JSONB,

    CONSTRAINT "catalog_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastStage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_runs_brandId_status_idx" ON "catalog_runs"("brandId", "status");

-- CreateIndex
CREATE INDEX "catalog_items_runId_status_idx" ON "catalog_items"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_runId_url_key" ON "catalog_items"("runId", "url");

-- AddForeignKey
ALTER TABLE "catalog_runs" ADD CONSTRAINT "catalog_runs_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "catalog_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
