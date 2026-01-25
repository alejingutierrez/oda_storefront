import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCatalogAdapter } from "@/lib/catalog/registry";
import { processCatalogRef } from "@/lib/catalog/extractor";
import { CATALOG_MAX_ATTEMPTS, getCatalogConsecutiveErrorLimit } from "@/lib/catalog/constants";
import { enqueueCatalogItems } from "@/lib/catalog/queue";
import { listPendingItems, listRunnableItems, markItemsQueued, resetQueuedItems, resetStuckItems } from "@/lib/catalog/run-store";

const readBrandMetadata = (brand: { metadata?: unknown }) =>
  brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
    ? (brand.metadata as Record<string, unknown>)
    : {};

const markBrandCatalogFinished = async ({
  brand,
  run,
  failedCount,
  reason,
}: {
  brand: { id: string; metadata?: unknown; ecommercePlatform?: string | null };
  run: { id: string; platform?: string | null; totalItems?: number | null };
  failedCount: number;
  reason: string;
}) => {
  if (failedCount > 0) return;
  const metadata = readBrandMetadata(brand);
  if (metadata.catalog_extract_finished) return;
  const nextMetadata = { ...metadata };
  delete nextMetadata.catalog_extract;
  nextMetadata.catalog_extract_finished = {
    finishedAt: new Date().toISOString(),
    reason,
    runId: run.id,
    platform: run.platform ?? brand.ecommercePlatform ?? null,
    totalItems: run.totalItems ?? null,
    failedItems: failedCount,
  };
  await prisma.brand.update({
    where: { id: brand.id },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });
};

export type ProcessCatalogItemResult = {
  status: string;
  created?: boolean;
  createdVariants?: number;
  reason?: string;
  error?: string;
};

export type ProcessCatalogItemOptions = {
  allowQueueRefill?: boolean;
  enqueueLimit?: number;
  queuedStaleMs?: number;
  stuckMs?: number;
};

export type DrainCatalogRunOptions = {
  runId: string;
  batch: number;
  concurrency: number;
  maxMs: number;
  queuedStaleMs: number;
  stuckMs: number;
};

export type DrainCatalogRunResult = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
};

export const processCatalogItemById = async (
  itemId: string,
  options: ProcessCatalogItemOptions = {},
): Promise<ProcessCatalogItemResult> => {
  const item = await prisma.catalogItem.findUnique({
    where: { id: itemId },
    include: { run: { include: { brand: true } } },
  });
  if (!item) return { status: "not_found" };

  const run = item.run;
  const now = new Date();
  if (!run || run.status !== "processing") {
    if (item.status === "queued" || item.status === "in_progress") {
      await prisma.catalogItem.update({
        where: { id: item.id },
        data: { status: "pending", updatedAt: now },
      });
    }
    return { status: "skipped", reason: run?.status ?? "missing_run" };
  }
  if (item.status === "completed") return { status: "already_completed" };
  if (item.attempts >= CATALOG_MAX_ATTEMPTS) return { status: "max_attempts" };

  const brand = run.brand;
  if (!brand?.siteUrl) {
    await prisma.catalogItem.update({
      where: { id: item.id },
      data: { status: "failed", attempts: item.attempts + 1, lastError: "missing_site_url" },
    });
    return { status: "failed", error: "missing_site_url" };
  }

  const enqueueLimit = Math.max(
    1,
    Number(options.enqueueLimit ?? process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const queuedStaleMs = Math.max(
    0,
    Number(options.queuedStaleMs ?? process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(options.stuckMs ?? process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );

  if (item.status === "in_progress" && item.startedAt) {
    const age = Date.now() - item.startedAt.getTime();
    if (age < stuckMs) {
      return { status: "in_progress" };
    }
  }

  const stuckCutoff = new Date(Date.now() - stuckMs);
  const claimed = await prisma.catalogItem.updateMany({
    where: {
      id: item.id,
      OR: [
        { status: { in: ["pending", "failed", "queued"] } },
        { status: "in_progress", startedAt: { lt: stuckCutoff } },
      ],
    },
    data: { status: "in_progress", startedAt: now, updatedAt: now },
  });
  if (!claimed.count) {
    return { status: "skipped", reason: "already_claimed" };
  }

  const adapter = getCatalogAdapter(run.platform ?? brand.ecommercePlatform);
  const ctx = {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: run.platform ?? brand.ecommercePlatform,
    },
  };
  const canUseLlmPdp =
    process.env.CATALOG_PDP_LLM_ENABLED !== "false" &&
    (adapter.platform === "custom" || (brand.ecommercePlatform ?? "").toLowerCase() === "unknown");

  let lastStage: string | null = null;
  try {
    const result = await processCatalogRef({
      brand: { id: brand.id, slug: brand.slug },
      adapter,
      ctx,
      ref: { url: item.url },
      canUseLlmPdp,
      onStage: (stage) => {
        lastStage = stage;
      },
    });

    await prisma.catalogItem.update({
      where: { id: item.id },
      data: {
        status: "completed",
        attempts: item.attempts + 1,
        lastError: null,
        lastStage: lastStage ?? "completed",
        completedAt: new Date(),
      },
    });

    await prisma.catalogRun.update({
      where: { id: run.id },
      data: {
        lastUrl: item.url,
        lastStage: lastStage ?? "completed",
        lastError: null,
        consecutiveErrors: 0,
        updatedAt: new Date(),
      },
    });

    await resetQueuedItems(run.id, queuedStaleMs);
    await resetStuckItems(run.id, stuckMs);
    const remaining = await prisma.catalogItem.count({
      where: {
        runId: run.id,
        status: { in: ["pending", "queued", "in_progress", "failed"] },
        attempts: { lt: CATALOG_MAX_ATTEMPTS },
      },
    });
    if (remaining === 0) {
      await prisma.catalogRun.update({
        where: { id: run.id },
        data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
      });
      const failedCount = await prisma.catalogItem.count({
        where: { runId: run.id, status: "failed" },
      });
      await markBrandCatalogFinished({
        brand,
        run,
        failedCount,
        reason: "auto_complete",
      });
    } else if (options.allowQueueRefill) {
      const pendingItems = await listPendingItems(run.id, enqueueLimit);
      await markItemsQueued(pendingItems.map((candidate) => candidate.id));
      await enqueueCatalogItems(pendingItems);
    }

    return { status: "completed", created: result.created, createdVariants: result.createdVariants };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts + 1;
    await prisma.catalogItem.update({
      where: { id: item.id },
      data: {
        status: "failed",
        attempts,
        lastError: message,
        lastStage: lastStage ?? "error",
      },
    });

    const consecutiveErrors = (run.consecutiveErrors ?? 0) + 1;
    const limit = getCatalogConsecutiveErrorLimit();
    const allowAutoPause = process.env.CATALOG_AUTO_PAUSE_ON_ERRORS === "true";
    const shouldPause = allowAutoPause && consecutiveErrors >= limit;

    await prisma.catalogRun.update({
      where: { id: run.id },
      data: {
        lastUrl: item.url,
        lastStage: lastStage ?? "error",
        lastError: message,
        blockReason: shouldPause ? `consecutive_errors:${consecutiveErrors}` : run.blockReason,
        consecutiveErrors,
        status: shouldPause ? "paused" : run.status,
        updatedAt: new Date(),
      },
    });

    if (!shouldPause) {
      await resetQueuedItems(run.id, queuedStaleMs);
      await resetStuckItems(run.id, stuckMs);
      const remaining = await prisma.catalogItem.count({
        where: {
          runId: run.id,
          status: { in: ["pending", "queued", "in_progress", "failed"] },
          attempts: { lt: CATALOG_MAX_ATTEMPTS },
        },
      });
      if (remaining === 0) {
        await prisma.catalogRun.update({
          where: { id: run.id },
          data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
        });
        const failedCount = await prisma.catalogItem.count({
          where: { runId: run.id, status: "failed" },
        });
        await markBrandCatalogFinished({
          brand,
          run,
          failedCount,
          reason: "auto_complete",
        });
      } else if (options.allowQueueRefill) {
        const pendingItems = await listPendingItems(run.id, enqueueLimit);
        await markItemsQueued(pendingItems.map((candidate) => candidate.id));
        await enqueueCatalogItems(pendingItems);
      }
    }

    return { status: "failed", error: message };
  }
};

export const drainCatalogRun = async ({
  runId,
  batch,
  concurrency,
  maxMs,
  queuedStaleMs,
  stuckMs,
}: DrainCatalogRunOptions): Promise<DrainCatalogRunResult> => {
  const startedAt = Date.now();
  let processed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let idleRounds = 0;

  const safeBatch = Math.max(1, batch);
  const safeConcurrency = Math.max(1, concurrency);

  while (processed < safeBatch && Date.now() - startedAt < maxMs) {
    await resetQueuedItems(runId, queuedStaleMs);
    await resetStuckItems(runId, stuckMs);

    const remaining = safeBatch - processed;
    const items = await listRunnableItems(
      runId,
      Math.min(safeConcurrency, remaining),
      true,
    );
    if (!items.length) break;

    const results = await Promise.allSettled(
      items.map((item) =>
        processCatalogItemById(item.id, {
          allowQueueRefill: false,
          queuedStaleMs,
          stuckMs,
        }),
      ),
    );

    let progressed = 0;
    results.forEach((result) => {
      if (result.status !== "fulfilled") {
        failed += 1;
        progressed += 1;
        return;
      }
      const status = result.value.status;
      if (status === "completed") {
        completed += 1;
        progressed += 1;
      } else if (status === "failed") {
        failed += 1;
        progressed += 1;
      } else {
        skipped += 1;
      }
    });
    processed += progressed;
    if (progressed === 0) {
      idleRounds += 1;
      if (idleRounds >= 2) break;
    } else {
      idleRounds = 0;
    }
  }

  return { processed, completed, failed, skipped };
};
