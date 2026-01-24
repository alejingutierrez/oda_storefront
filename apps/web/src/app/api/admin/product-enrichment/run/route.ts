import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueEnrichmentItems, isEnrichmentQueueEnabled } from "@/lib/product-enrichment/queue";
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

const getRandomProductIds = async (params: { brandId?: string | null; limit: number }) => {
  if (params.brandId) {
    return prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "products" WHERE "brandId" = ${params.brandId} ORDER BY RANDOM() LIMIT ${params.limit}`,
    );
  }
  return prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "products" ORDER BY RANDOM() LIMIT ${params.limit}`,
  );
};

const getAllProductIds = async (params: { brandId?: string | null }) => {
  if (params.brandId) {
    return prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "products" WHERE "brandId" = ${params.brandId}`,
    );
  }
  return prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "products"`);
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

  const enqueueLimit = Math.max(
    1,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const drainOnRun =
    process.env.PRODUCT_ENRICHMENT_DRAIN_ON_RUN !== "false" &&
    process.env.PRODUCT_ENRICHMENT_DRAIN_DISABLED !== "true";
  const drainBatchDefault = Number(
    process.env.PRODUCT_ENRICHMENT_DRAIN_BATCH ?? 0,
  );
  const drainBatch = Number.isFinite(requestedDrainBatch) ? requestedDrainBatch : drainBatchDefault;
  const drainConcurrencyDefault = Number(
    process.env.PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY ?? 5,
  );
  const drainConcurrency = Number.isFinite(requestedDrainConcurrency)
    ? requestedDrainConcurrency
    : drainConcurrencyDefault;
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
        updatedAt: new Date(),
      },
    });

    const effectiveQueuedStaleMs = resumeRequested ? 0 : queuedStaleMs;
    const effectiveStuckMs = resumeRequested ? Math.min(stuckMs, resumeStuckMs || 0) : stuckMs;
    await resetQueuedItems(existing.id, effectiveQueuedStaleMs);
    await resetStuckItems(existing.id, effectiveStuckMs);

    const pendingItems = await listPendingItems(
      existing.id,
      Number.isFinite(limit) && limit > 0 ? Math.max(limit, enqueueLimit) : enqueueLimit,
    );
    await markItemsQueued(pendingItems.map((item) => item.id));
    await enqueueEnrichmentItems(pendingItems);

    if (drainOnRun) {
      await drainEnrichmentRun({
        runId: existing.id,
        batch: drainBatch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatch),
        concurrency: Math.max(1, drainConcurrency),
        maxMs: Math.max(1000, drainMaxMs),
        queuedStaleMs: effectiveQueuedStaleMs,
        stuckMs: effectiveStuckMs,
      });
    }

    const summary = await summarizeRun(existing.id);
    return NextResponse.json({ summary });
  }

  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  const productRows = mode === "batch"
    ? await getRandomProductIds({ brandId, limit: effectiveLimit || enqueueLimit })
    : await getAllProductIds({ brandId });

  const productIds = productRows.map((row) => row.id);
  if (!productIds.length) {
    return NextResponse.json({ error: "no_products" }, { status: 404 });
  }

  const run = await createRunWithItems({
    scope,
    brandId,
    productIds,
    status: "processing",
    metadata: {
      mode,
      limit: effectiveLimit || null,
      created_at: new Date().toISOString(),
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
      batch: drainBatch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatch),
      concurrency: Math.max(1, drainConcurrency),
      maxMs: Math.max(1000, drainMaxMs),
      queuedStaleMs,
      stuckMs,
    });
  }

  const summary = await summarizeRun(run.id);
  return NextResponse.json({ summary, totalItems: productIds.length });
}
