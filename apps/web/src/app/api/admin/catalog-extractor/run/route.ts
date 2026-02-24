import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import { isCatalogQueueEnabled } from "@/lib/catalog/queue";
import { topUpCatalogRunQueue } from "@/lib/catalog/queue-control";
import {
  createRunWithItems,
  findActiveRun,
  resetQueuedItemsAll,
  resetStuckItemsAll,
  resetQueuedItems,
  resetStuckItems,
  summarizeRun,
} from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const batchSize = Number(body?.batchSize ?? body?.limit ?? 1);
  const resumeRequested = Boolean(body?.resume);
  const strongResumeRequested = Boolean(body?.strongResume ?? body?.resumeStrong);
  const forceRun = Boolean(body?.force);
  const requestedDrainBatch = Number(body?.drainBatch ?? body?.drainLimit ?? body?.drainSize);
  const requestedDrainConcurrency = Number(body?.drainConcurrency ?? body?.concurrency ?? body?.drainWorkers);
  const requestedDrainMaxMs = Number(body?.drainMaxMs ?? body?.maxMs ?? body?.drainTimeoutMs);
  const drainOverride = typeof body?.drainOnRun === "boolean" ? body.drainOnRun : null;
  const enqueueOnly = Boolean(body?.enqueueOnly);
  const forceSitemap =
    typeof body?.forceSitemap === "boolean"
      ? body.forceSitemap
      : process.env.CATALOG_FORCE_SITEMAP === "true";
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const envDrainOnRun =
    process.env.CATALOG_DRAIN_ON_RUN !== "false" &&
    process.env.CATALOG_DRAIN_DISABLED !== "true";
  const drainOnRun = enqueueOnly ? false : (drainOverride ?? envDrainOnRun);
  const drainBatchDefault = Number(
    process.env.CATALOG_DRAIN_ON_RUN_BATCH ?? process.env.CATALOG_DRAIN_BATCH ?? 0,
  );
  const drainBatch = Number.isFinite(requestedDrainBatch) ? requestedDrainBatch : drainBatchDefault;
  const drainConcurrencyDefault = Number(
    process.env.CATALOG_DRAIN_ON_RUN_CONCURRENCY ?? process.env.CATALOG_DRAIN_CONCURRENCY ?? 5,
  );
  const drainConcurrency = Number.isFinite(requestedDrainConcurrency)
    ? requestedDrainConcurrency
    : drainConcurrencyDefault;
  const drainMaxMsDefault = Number(
    process.env.CATALOG_DRAIN_ON_RUN_MAX_RUNTIME_MS ?? 20000,
  );
  const drainMaxMs = Number.isFinite(requestedDrainMaxMs) ? requestedDrainMaxMs : drainMaxMsDefault;
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );
  const resumeStuckMs = Math.max(
    0,
    Number(process.env.CATALOG_RESUME_STUCK_MINUTES ?? 2) * 60 * 1000,
  );

  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const queueEnabled = isCatalogQueueEnabled();

  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || !brand.siteUrl) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
    if (!brand.isActive) {
      return NextResponse.json({ error: "brand_inactive" }, { status: 409 });
    }
    const metadata =
      brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
        ? (brand.metadata as Record<string, unknown>)
        : {};
    if (metadata.catalog_extract_finished && !forceRun) {
      return NextResponse.json({ error: "brand_finished", status: "finished" }, { status: 409 });
    }

    if (!queueEnabled && !drainOnRun && process.env.CATALOG_DRAIN_DISABLED === "true") {
      return NextResponse.json({ error: "queue_disabled" }, { status: 503 });
    }

    const existing = await findActiveRun(brandId);
    if (existing) {
      const shouldResumeSweep =
        resumeRequested ||
        strongResumeRequested ||
        existing.status === "paused" ||
        existing.status === "stopped";
      let recoveredQueued = 0;
      let recoveredInProgress = 0;
      let reenqueued = 0;
      if (existing.status === "paused" || existing.status === "stopped" || shouldResumeSweep) {
        await prisma.catalogRun.update({
          where: { id: existing.id },
          data: {
            status: "processing",
            consecutiveErrors: 0,
            lastError: null,
            blockReason: null,
            updatedAt: new Date(),
          },
        });
      }
      const recoverAll = shouldResumeSweep;
      const effectiveQueuedStaleMs = recoverAll ? 0 : queuedStaleMs;
      const effectiveStuckMs = shouldResumeSweep
        ? Math.min(stuckMs, resumeStuckMs || 0)
        : stuckMs;
      if (recoverAll) {
        const [queuedReset, inProgressReset] = await Promise.all([
          resetQueuedItemsAll(existing.id),
          resetStuckItemsAll(existing.id),
        ]);
        recoveredQueued = queuedReset.count;
        recoveredInProgress = inProgressReset.count;
      } else {
        const [queuedReset, inProgressReset] = await Promise.all([
          resetQueuedItems(existing.id, effectiveQueuedStaleMs),
          resetStuckItems(existing.id, effectiveStuckMs),
        ]);
        recoveredQueued = queuedReset.count;
        recoveredInProgress = inProgressReset.count;
      }
      const refill = await topUpCatalogRunQueue({
        runId: existing.id,
        enqueueLimit: Number.isFinite(batchSize) ? Math.max(Math.floor(batchSize), enqueueLimit) : enqueueLimit,
        queueEnabled,
      });
      reenqueued = refill.enqueued;
      if (drainOnRun) {
        await drainCatalogRun({
          runId: existing.id,
          batch: drainBatch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatch),
          concurrency: Math.max(1, drainConcurrency),
          maxMs: Math.max(1000, drainMaxMs),
          queuedStaleMs: effectiveQueuedStaleMs,
          stuckMs: effectiveStuckMs,
        });
      }
      const summary = await summarizeRun(existing.id);
      return NextResponse.json({
        summary,
        recoveredQueued,
        recoveredInProgress,
        reenqueued,
        queueTargetDepth: refill.targetDepth,
      });
    }

    const { refs, platformForRun } = await discoverCatalogRefs({
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        siteUrl: brand.siteUrl,
        ecommercePlatform: brand.ecommercePlatform,
      },
      limit: Number.isFinite(batchSize) ? Math.max(10, batchSize * 10) : 50,
      forceSitemap,
    });

    if (!refs.length) {
      const run = await prisma.catalogRun.create({
        data: {
          brandId: brand.id,
          status: "blocked",
          platform: platformForRun ?? brand.ecommercePlatform,
          totalItems: 0,
          lastError: "manual_review_no_products",
          blockReason: "manual_review_no_products",
        },
      });
      await prisma.brand.update({
        where: { id: brand.id },
        data: { manualReview: true },
      });
      const summary = await summarizeRun(run.id);
      return NextResponse.json({ summary });
    }

    const run = await createRunWithItems({
      brandId: brand.id,
      platform: platformForRun ?? brand.ecommercePlatform,
      refs,
      status: "processing",
    });
    const refill = await topUpCatalogRunQueue({
      runId: run.id,
      enqueueLimit: Number.isFinite(batchSize) ? Math.max(Math.floor(batchSize), enqueueLimit) : enqueueLimit,
      queueEnabled,
    });
    if (drainOnRun) {
      await drainCatalogRun({
        runId: run.id,
        batch: drainBatch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatch),
        concurrency: Math.max(1, drainConcurrency),
        maxMs: Math.max(1000, drainMaxMs),
        queuedStaleMs,
        stuckMs,
      });
    }
    const summary = await summarizeRun(run.id);
    return NextResponse.json({
      summary,
      recoveredQueued: 0,
      recoveredInProgress: 0,
      reenqueued: refill.enqueued,
      queueTargetDepth: refill.targetDepth,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}
