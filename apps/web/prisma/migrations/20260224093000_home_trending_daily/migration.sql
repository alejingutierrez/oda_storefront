CREATE TABLE IF NOT EXISTS "home_trending_daily" (
  "id" TEXT NOT NULL,
  "snapshotDate" TIMESTAMP(3) NOT NULL,
  "productId" TEXT NOT NULL,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "rank" INTEGER NOT NULL,
  "sourceWindowStart" TIMESTAMP(3),
  "sourceWindowEnd" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "home_trending_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "home_trending_daily_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "home_trending_daily_snapshotDate_productId_key"
  ON "home_trending_daily"("snapshotDate", "productId");

CREATE INDEX IF NOT EXISTS "home_trending_daily_snapshotDate_rank_idx"
  ON "home_trending_daily"("snapshotDate", "rank");

CREATE INDEX IF NOT EXISTS "home_trending_daily_productId_snapshotDate_idx"
  ON "home_trending_daily"("productId", "snapshotDate");
