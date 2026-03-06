-- AlterTable: add random_sort_key column with default random()
ALTER TABLE "products" ADD COLUMN "random_sort_key" DOUBLE PRECISION DEFAULT random();

-- Backfill existing rows
UPDATE "products" SET "random_sort_key" = random() WHERE "random_sort_key" IS NULL;

-- CreateIndex
CREATE INDEX "products_random_sort_key_idx" ON "products"("random_sort_key");
