ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "priceChangeDirection" TEXT,
  ADD COLUMN IF NOT EXISTS "priceChangeAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "products_priceChangeDirection_priceChangeAt_idx"
  ON "products"("priceChangeDirection", "priceChangeAt" DESC)
  WHERE "priceChangeDirection" IS NOT NULL;
