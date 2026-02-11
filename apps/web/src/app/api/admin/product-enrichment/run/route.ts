import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueEnrichmentItems, isEnrichmentQueueEnabled } from "@/lib/product-enrichment/queue";
import {
  productEnrichmentModel,
  productEnrichmentPromptVersion,
  productEnrichmentProvider,
  productEnrichmentSchemaVersion,
} from "@/lib/product-enrichment/openai";
import {
  createRunWithItems,
  findActiveRun,
  listPendingItems,
  markItemsQueued,
  resetQueuedItems,
  resetStuckItems,
  summarizeRun,
} from "@/lib/product-enrichment/run-store";
import { drainEnrichmentRun } from "@/lib/product-enrichment/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ATTEMPTS = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 5));
const ALLOW_REENRICH = process.env.PRODUCT_ENRICHMENT_ALLOW_REENRICH === "true";

const readJsonRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const buildProductFilters = (params: { brandId?: string | null; includeEnriched?: boolean }) => {
  const filters: Prisma.Sql[] = [];
  if (params.brandId) {
    filters.push(Prisma.sql`"brandId" = ${params.brandId}`);
  }
  if (!params.includeEnriched) {
    filters.push(
      Prisma.sql`
        COALESCE("metadata" -> 'enrichment' ->> 'completed_at', '') = ''
        AND COALESCE("metadata" -> 'enrichment' ->> 'provider', '') = ''
        AND COALESCE("metadata" -> 'enrichment' ->> 'model', '') = ''
      `,
    );
  }
  if (!filters.length) return Prisma.sql``;
  return Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
};

const getRandomProductIds = async (params: {
  brandId?: string | null;
  limit: number;
  includeEnriched?: boolean;
}) => {
  const where = buildProductFilters(params);
  return prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "products" ${where} ORDER BY RANDOM() LIMIT ${params.limit}`,
  );
};

const getAllProductIds = async (params: { brandId?: string | null; includeEnriched?: boolean }) => {
  const where = buildProductFilters(params);
  return prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "products" ${where}`,
  );
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const scope = body?.scope === "all" || body?.scope === "brand" ? body.scope : brandId ? "brand" : "all";
  const mode = body?.mode === "all" || body?.mode === "batch" ? body.mode : body?.limit ? "batch" : "all";
  const limit = Number(body?.limit ?? body?.batchSize ?? body?.count ?? 0);
  const resumeRequested = Boolean(body?.resume);
  const hasStartFreshFlag = typeof body?.startFresh === "boolean";
  const startFreshRequested = hasStartFreshFlag ? body.startFresh === true : !resumeRequested;
  const includeEnrichedRequested = Boolean(body?.includeEnriched);
  const forceReenrichRequested = Boolean(body?.forceReenrich);
  const includeEnriched = includeEnrichedRequested && ALLOW_REENRICH && forceReenrichRequested;
  const requestDrainOnRun = body?.drainOnRun;
  const requestedDrainBatch = Number(body?.drainBatch ?? body?.drainLimit ?? body?.drainSize);
  const requestedDrainConcurrency = Number(body?.drainConcurrency ?? body?.concurrency ?? body?.drainWorkers);
  const requestedDrainMaxMs = Number(body?.drainMaxMs ?? body?.maxMs ?? body?.drainTimeoutMs);

  if (scope === "brand" && !brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  if (scope === "brand" && brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
  }

  if (!isEnrichmentQueueEnabled()) {
    const existing = await findActiveRun({ scope, brandId });
    if (existing) {
      await prisma.productEnrichmentRun.update({
        where: { id: existing.id },
        data: {
          status: "paused",
          lastError: "queue_disabled",
          blockReason: "queue_disabled",
          updatedAt: new Date(),
        },
      });
    }
    return NextResponse.json({ error: "queue_disabled" }, { status: 503 });
  }

  const drainOnRunDefault =
    process.env.PRODUCT_ENRICHMENT_DRAIN_ON_RUN !== "false" &&
    process.env.PRODUCT_ENRICHMENT_DRAIN_DISABLED !== "true";
  const drainOnRun =
    typeof requestDrainOnRun === "boolean" ? requestDrainOnRun : drainOnRunDefault;
  const drainBatchDefault = Number(
    process.env.PRODUCT_ENRICHMENT_DRAIN_BATCH ?? 0,
  );
  const drainBatch = Number.isFinite(requestedDrainBatch) ? requestedDrainBatch : drainBatchDefault;
  const drainConcurrencyDefault = Number(
    process.env.PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY ?? 20,
  );
  const drainConcurrencyRaw = Number.isFinite(requestedDrainConcurrency)
    ? requestedDrainConcurrency
    : drainConcurrencyDefault;
  const drainConcurrency = Math.max(20, drainConcurrencyRaw);
  const workerConcurrency = Number(process.env.PRODUCT_ENRICHMENT_WORKER_CONCURRENCY ?? NaN);
  const minConcurrency = Math.max(
    20,
    drainConcurrency,
    Number.isFinite(workerConcurrency) ? workerConcurrency : 0,
  );
  const enqueueLimit = Math.max(
    minConcurrency,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const drainBatchFloor =
    drainBatch <= 0 ? drainBatch : Math.max(drainBatch, minConcurrency);
  const drainMaxMsDefault = Number(
    process.env.PRODUCT_ENRICHMENT_DRAIN_MAX_RUNTIME_MS ?? 20000,
  );
  const drainMaxMs = Number.isFinite(requestedDrainMaxMs) ? requestedDrainMaxMs : drainMaxMsDefault;
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );
  const resumeStuckMs = Math.max(
    0,
    Number(process.env.PRODUCT_ENRICHMENT_RESUME_STUCK_MINUTES ?? 2) * 60 * 1000,
  );

  const existing = await findActiveRun({ scope, brandId });
  if (existing) {
    if (!resumeRequested && startFreshRequested) {
      const now = new Date();
      await prisma.productEnrichmentRun.update({
        where: { id: existing.id },
        data: {
          status: "stopped",
          finishedAt: now,
          updatedAt: now,
          lastError: existing.lastError ?? "superseded_by_new_run",
        },
      });
      await prisma.productEnrichmentItem.updateMany({
        where: { runId: existing.id, status: { in: ["queued", "in_progress"] } },
        data: {
          status: "pending",
          startedAt: null,
          updatedAt: now,
        },
      });
    } else {
      if (existing.status === "processing" && !resumeRequested) {
        const summary = await summarizeRun(existing.id);
        return NextResponse.json({ summary });
      }

      await prisma.productEnrichmentRun.update({
        where: { id: existing.id },
        data: {
          status: "processing",
          consecutiveErrors: 0,
          lastError: null,
          blockReason: null,
          ...(resumeRequested
            ? (() => {
                const metadata = readJsonRecord(existing.metadata);
                if (metadata.created_by !== "catalog_refresh") return {};
                return {
                  metadata: {
                    ...metadata,
                    auto_start: true,
                    manual_resume_at: new Date().toISOString(),
                    resume_requested_by: "admin_run_api",
                  } as Prisma.InputJsonValue,
                };
              })()
            : {}),
          updatedAt: new Date(),
        },
      });

      if (resumeRequested) {
        await prisma.productEnrichmentItem.updateMany({
          where: {
            runId: existing.id,
            status: "failed",
            attempts: { gte: MAX_ATTEMPTS },
          },
          data: {
            status: "pending",
            attempts: 0,
            lastError: null,
            lastStage: null,
            startedAt: null,
            updatedAt: new Date(),
          },
        });
      }

      const effectiveQueuedStaleMs = resumeRequested ? 0 : queuedStaleMs;
      const effectiveStuckMs = resumeRequested ? Math.min(stuckMs, resumeStuckMs || 0) : stuckMs;
      await resetQueuedItems(existing.id, effectiveQueuedStaleMs);
      await resetStuckItems(existing.id, effectiveStuckMs);

      const pendingItems = await listPendingItems(
        existing.id,
        Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : enqueueLimit,
      );
      await markItemsQueued(pendingItems.map((item) => item.id));
      await enqueueEnrichmentItems(pendingItems);

      if (drainOnRun) {
        await drainEnrichmentRun({
          runId: existing.id,
          batch: drainBatchFloor <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatchFloor),
          concurrency: Math.max(1, drainConcurrency),
          maxMs: Math.max(1000, drainMaxMs),
          queuedStaleMs: effectiveQueuedStaleMs,
          stuckMs: effectiveStuckMs,
        });
      }

      const summary = await summarizeRun(existing.id);
      return NextResponse.json({ summary });
    }
  }

  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  const productRows = mode === "batch"
    ? await getRandomProductIds({ brandId, limit: effectiveLimit || enqueueLimit, includeEnriched })
    : await getAllProductIds({ brandId, includeEnriched });

  const productIds = productRows.map((row) => row.id);
  const requestedItems =
    mode === "batch" ? Math.max(1, effectiveLimit || enqueueLimit) : productIds.length;
  const selectedItems = productIds.length;
  const insufficientPending = mode === "batch" && selectedItems < requestedItems;
  if (!productIds.length) {
    return NextResponse.json(
      { error: includeEnriched ? "no_products" : "no_pending_products" },
      { status: 404 },
    );
  }

  const run = await createRunWithItems({
    scope,
    brandId,
    productIds,
    status: "processing",
    metadata: {
      mode,
      limit: effectiveLimit || null,
      requested_items: requestedItems,
      selected_items: selectedItems,
      insufficient_pending: insufficientPending,
      include_enriched_requested: includeEnrichedRequested,
      include_enriched_effective: includeEnriched,
      force_reenrich_requested: forceReenrichRequested,
      allow_reenrich: ALLOW_REENRICH,
      start_fresh_requested: startFreshRequested,
      created_at: new Date().toISOString(),
      provider: productEnrichmentProvider,
      model: productEnrichmentModel,
      prompt_version: productEnrichmentPromptVersion,
      schema_version: productEnrichmentSchemaVersion,
    },
  });

  const items = await listPendingItems(
    run.id,
    Number.isFinite(effectiveLimit) && effectiveLimit > 0 ? Math.max(effectiveLimit, enqueueLimit) : enqueueLimit,
  );
  await markItemsQueued(items.map((item) => item.id));
  await enqueueEnrichmentItems(items);

  if (drainOnRun) {
    await drainEnrichmentRun({
      runId: run.id,
      batch: drainBatchFloor <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatchFloor),
      concurrency: Math.max(1, drainConcurrency),
      maxMs: Math.max(1000, drainMaxMs),
      queuedStaleMs,
      stuckMs,
    });
  }

  const summary = await summarizeRun(run.id);
  return NextResponse.json({
    summary,
    totalItems: selectedItems,
    requestedItems,
    selectedItems,
    insufficientPending,
  });
}
