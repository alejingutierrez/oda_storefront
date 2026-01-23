import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import { enqueueCatalogItems, isCatalogQueueEnabled } from "@/lib/catalog/queue";
import {
  createRunWithItems,
  findActiveRun,
  listPendingItems,
  listRunnableItems,
  markItemsQueued,
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
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const drainOnRun =
    process.env.CATALOG_DRAIN_ON_RUN !== "false" &&
    process.env.CATALOG_DRAIN_DISABLED !== "true";
  const drainBatch = Math.max(
    0,
    Number(process.env.CATALOG_DRAIN_ON_RUN_BATCH ?? process.env.CATALOG_DRAIN_BATCH ?? 1),
  );
  const drainConcurrency = Math.max(
    1,
    Number(process.env.CATALOG_DRAIN_ON_RUN_CONCURRENCY ?? process.env.CATALOG_DRAIN_CONCURRENCY ?? 2),
  );
  const drainMaxMs = Math.max(
    1000,
    Number(process.env.CATALOG_DRAIN_ON_RUN_MAX_RUNTIME_MS ?? 8000),
  );
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );

  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || !brand.siteUrl) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }

    if (!isCatalogQueueEnabled()) {
      const existing = await findActiveRun(brandId);
      if (existing) {
        await prisma.catalogRun.update({
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

    const existing = await findActiveRun(brandId);
    if (existing) {
      if (existing.status === "paused" || existing.status === "stopped") {
        await prisma.catalogRun.update({
          where: { id: existing.id },
          data: { status: "processing", updatedAt: new Date() },
        });
      }
      await resetQueuedItems(existing.id, queuedStaleMs);
      await resetStuckItems(existing.id, stuckMs);
      const pendingItems = await listPendingItems(
        existing.id,
        Number.isFinite(batchSize) ? Math.max(batchSize, enqueueLimit) : enqueueLimit,
      );
      await markItemsQueued(pendingItems.map((item) => item.id));
      await enqueueCatalogItems(pendingItems);
      if (drainOnRun) {
        await drainCatalogRun({
          runId: existing.id,
          batch: drainBatch <= 0 ? Number.MAX_SAFE_INTEGER : drainBatch,
          concurrency: drainConcurrency,
          maxMs: drainMaxMs,
          queuedStaleMs,
          stuckMs,
        });
      }
      const summary = await summarizeRun(existing.id);
      return NextResponse.json({ summary });
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
      forceSitemap: true,
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
    const items = await listPendingItems(
      run.id,
      Number.isFinite(batchSize) ? Math.max(batchSize, enqueueLimit) : enqueueLimit,
    );
    await markItemsQueued(items.map((item) => item.id));
    await enqueueCatalogItems(items);
    if (drainOnRun) {
      await drainCatalogRun({
        runId: run.id,
        batch: drainBatch <= 0 ? Number.MAX_SAFE_INTEGER : drainBatch,
        concurrency: drainConcurrency,
        maxMs: drainMaxMs,
        queuedStaleMs,
        stuckMs,
      });
    }
    const summary = await summarizeRun(run.id);
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}
