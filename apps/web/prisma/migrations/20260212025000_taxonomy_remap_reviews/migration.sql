-- CreateTable
CREATE TABLE "taxonomy_remap_reviews" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT,
    "runKey" TEXT,
    "productId" TEXT NOT NULL,
    "fromCategory" TEXT,
    "fromSubcategory" TEXT,
    "fromGender" TEXT,
    "toCategory" TEXT,
    "toSubcategory" TEXT,
    "toGender" TEXT,
    "confidence" DOUBLE PRECISION,
    "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "seoCategoryHints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sourceCount" INTEGER,
    "scoreSupport" DOUBLE PRECISION,
    "marginRatio" DOUBLE PRECISION,
    "imageCoverUrl" TEXT,
    "sourceUrl" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxonomy_remap_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "taxonomy_remap_reviews_status_check" CHECK ("status" IN ('pending', 'accepted', 'rejected'))
);

-- CreateIndex
CREATE INDEX "taxonomy_remap_reviews_status_createdAt_idx" ON "taxonomy_remap_reviews"("status", "createdAt");

-- CreateIndex
CREATE INDEX "taxonomy_remap_reviews_productId_status_idx" ON "taxonomy_remap_reviews"("productId", "status");

-- CreateIndex
CREATE INDEX "taxonomy_remap_reviews_runKey_status_idx" ON "taxonomy_remap_reviews"("runKey", "status");

-- CreateIndex
CREATE INDEX "taxonomy_remap_reviews_decidedByUserId_idx" ON "taxonomy_remap_reviews"("decidedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_remap_reviews_product_pending_unique_idx"
ON "taxonomy_remap_reviews"("productId")
WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "taxonomy_remap_reviews" ADD CONSTRAINT "taxonomy_remap_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taxonomy_remap_reviews" ADD CONSTRAINT "taxonomy_remap_reviews_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
