-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "products_brandId_slug_key" ON "products"("brandId", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_slug_idx" ON "products"("slug");
