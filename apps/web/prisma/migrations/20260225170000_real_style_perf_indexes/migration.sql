CREATE INDEX IF NOT EXISTS "products_real_style_queue_pending_idx"
  ON "products"("createdAt" DESC, "id" DESC)
  WHERE "real_style" IS NULL
    AND "hasInStock" = true
    AND "imageCoverUrl" IS NOT NULL
    AND ("metadata" -> 'enrichment') IS NOT NULL;

CREATE INDEX IF NOT EXISTS "products_real_style_summary_eligible_idx"
  ON "products"("real_style")
  WHERE "hasInStock" = true
    AND "imageCoverUrl" IS NOT NULL
    AND ("metadata" -> 'enrichment') IS NOT NULL;
