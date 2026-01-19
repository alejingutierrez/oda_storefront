-- CreateTable
CREATE TABLE "brand_scrape_jobs" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "batchId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_scrape_jobs_brandId_idx" ON "brand_scrape_jobs"("brandId");

-- CreateIndex
CREATE INDEX "brand_scrape_jobs_status_createdAt_idx" ON "brand_scrape_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "brand_scrape_jobs_batchId_idx" ON "brand_scrape_jobs"("batchId");

-- AddForeignKey
ALTER TABLE "brand_scrape_jobs" ADD CONSTRAINT "brand_scrape_jobs_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
