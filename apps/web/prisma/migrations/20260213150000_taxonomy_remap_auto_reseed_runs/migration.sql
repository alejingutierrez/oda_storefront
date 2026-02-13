CREATE TABLE "taxonomy_remap_auto_reseed_runs" (
  "id" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "force" BOOLEAN NOT NULL DEFAULT false,
  "requestedLimit" INTEGER,
  "pendingCount" INTEGER,
  "pendingThreshold" INTEGER,
  "scanned" INTEGER,
  "proposed" INTEGER,
  "enqueued" INTEGER,
  "source" TEXT,
  "runKey" TEXT,
  "learningAcceptedSamples" INTEGER,
  "learningRejectedSamples" INTEGER,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "taxonomy_remap_auto_reseed_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "taxonomy_remap_auto_reseed_runs_status_check" CHECK ("status" IN ('running', 'completed', 'skipped', 'failed'))
);

CREATE INDEX "taxonomy_remap_auto_reseed_runs_status_startedAt_idx"
ON "taxonomy_remap_auto_reseed_runs"("status", "startedAt");

CREATE INDEX "taxonomy_remap_auto_reseed_runs_trigger_startedAt_idx"
ON "taxonomy_remap_auto_reseed_runs"("trigger", "startedAt");

CREATE UNIQUE INDEX "taxonomy_remap_auto_reseed_runs_running_unique_idx"
ON "taxonomy_remap_auto_reseed_runs"(("status"))
WHERE "status" = 'running';
