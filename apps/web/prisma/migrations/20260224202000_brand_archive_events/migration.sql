CREATE TABLE "brand_archive_events" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceJson" JSONB,
  "policyVersion" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_archive_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brand_archive_events_brandId_idx" ON "brand_archive_events"("brandId");
CREATE INDEX "brand_archive_events_reason_idx" ON "brand_archive_events"("reason");
CREATE INDEX "brand_archive_events_createdAt_idx" ON "brand_archive_events"("createdAt" DESC);

ALTER TABLE "brand_archive_events"
ADD CONSTRAINT "brand_archive_events_brandId_fkey"
FOREIGN KEY ("brandId") REFERENCES "brands"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
