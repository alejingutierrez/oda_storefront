import { prisma } from "@/lib/prisma";
import { enrichProductWithOpenAI, productEnrichmentPromptVersion, productEnrichmentSchemaVersion } from "@/lib/product-enrichment/openai";
import { enqueueEnrichmentItems } from "@/lib/product-enrichment/queue";
import {
  listPendingItems,
  listRunnableItems,
  markItemsQueued,
  resetQueuedItems,
  resetStuckItems,
  updateRunAfterItem,
} from "@/lib/product-enrichment/run-store";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 3));
const CONSECUTIVE_ERROR_LIMIT = Math.max(
  2,
  Number(process.env.PRODUCT_ENRICHMENT_CONSECUTIVE_ERROR_LIMIT ?? 5),
);

export type ProcessEnrichmentItemResult = {
  status: string;
  error?: string;
};

export type ProcessEnrichmentItemOptions = {
  allowQueueRefill?: boolean;
  enqueueLimit?: number;
  queuedStaleMs?: number;
  stuckMs?: number;
};

export type DrainEnrichmentRunOptions = {
  runId: string;
  batch: number;
  concurrency: number;
  maxMs: number;
  queuedStaleMs: number;
  stuckMs: number;
};

export type DrainEnrichmentRunResult = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
};

export const processEnrichmentItemById = async (
  itemId: string,
  options: ProcessEnrichmentItemOptions = {},
): Promise<ProcessEnrichmentItemResult> => {
  const item = await prisma.productEnrichmentItem.findUnique({
    where: { id: itemId },
    include: { run: true, product: { include: { variants: true } } },
  });

  if (!item) return { status: "not_found" };
  const run = item.run;
  const now = new Date();

  if (!run || run.status !== "processing") {
    if (item.status === "queued" || item.status === "in_progress") {
      await prisma.productEnrichmentItem.update({
        where: { id: item.id },
        data: { status: "pending", updatedAt: now },
      });
    }
    return { status: "skipped", error: run?.status ?? "missing_run" };
  }

  if (item.status === "completed") return { status: "already_completed" };
  if (item.attempts >= MAX_ATTEMPTS) return { status: "max_attempts" };

  const enqueueLimit = Math.max(
    1,
    Number(options.enqueueLimit ?? process.env.PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const queuedStaleMs = Math.max(
    0,
    Number(options.queuedStaleMs ?? process.env.PRODUCT_ENRICHMENT_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(options.stuckMs ?? process.env.PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );

  if (item.status === "in_progress" && item.startedAt) {
    const age = Date.now() - item.startedAt.getTime();
    if (age < stuckMs) return { status: "in_progress" };
  }

  const claimed = await prisma.productEnrichmentItem.updateMany({
    where: {
      id: item.id,
      status: { in: ["pending", "failed", "queued", "in_progress"] },
    },
    data: { status: "in_progress", startedAt: now, updatedAt: now },
  });

  if (!claimed.count) return { status: "skipped", error: "already_claimed" };

  let lastStage: string | null = null;
  try {
    lastStage = "openai";
    const enriched = await enrichProductWithOpenAI({
      product: {
        id: item.product.id,
        name: item.product.name,
        description: item.product.description,
        category: item.product.category,
        subcategory: item.product.subcategory,
        styleTags: item.product.styleTags,
        materialTags: item.product.materialTags,
        patternTags: item.product.patternTags,
        occasionTags: item.product.occasionTags,
        gender: item.product.gender,
        season: item.product.season,
        care: item.product.care,
        origin: item.product.origin,
        status: item.product.status,
        sourceUrl: item.product.sourceUrl,
        imageCoverUrl: item.product.imageCoverUrl,
        metadata: item.product.metadata as Record<string, unknown> | null,
      },
      variants: item.product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku ?? null,
        color: variant.color ?? null,
        size: variant.size ?? null,
        fit: variant.fit ?? null,
        material: variant.material ?? null,
        price: variant.price ? Number(variant.price) : null,
        currency: variant.currency ?? null,
        stock: variant.stock ?? null,
        stockStatus: variant.stockStatus ?? null,
        images: variant.images,
        metadata: variant.metadata as Record<string, unknown> | null,
      })),
    });

    lastStage = "persist";
    const enrichedVariantMap = new Map(enriched.variants.map((variant) => [variant.variantId, variant]));

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          category: enriched.category,
          subcategory: enriched.subcategory,
          styleTags: enriched.styleTags,
          materialTags: enriched.materialTags,
          patternTags: enriched.patternTags,
          occasionTags: enriched.occasionTags,
          gender: enriched.gender,
          season: enriched.season,
          metadata: {
            ...(item.product.metadata && typeof item.product.metadata === "object" ? item.product.metadata : {}),
            enrichment: {
              model: OPENAI_MODEL,
              prompt_version: productEnrichmentPromptVersion,
              schema_version: productEnrichmentSchemaVersion,
              completed_at: new Date().toISOString(),
              run_id: run.id,
            },
          },
        },
      });

      for (const variant of item.product.variants) {
        const enrichedVariant = enrichedVariantMap.get(variant.id);
        if (!enrichedVariant) {
          throw new Error(`Missing enrichment for variant ${variant.id}`);
        }
        await tx.variant.update({
          where: { id: variant.id },
          data: {
            color: enrichedVariant.colorHex,
            colorPantone: enrichedVariant.colorPantone,
            fit: enrichedVariant.fit,
          },
        });
      }

      await tx.productEnrichmentItem.update({
        where: { id: item.id },
        data: {
          status: "completed",
          attempts: item.attempts + 1,
          lastError: null,
          lastStage: lastStage ?? "completed",
          completedAt: new Date(),
        },
      });

      await tx.productEnrichmentRun.update({
        where: { id: run.id },
        data: {
          lastProductId: item.productId,
          lastStage: lastStage ?? "completed",
          lastError: null,
          consecutiveErrors: 0,
          updatedAt: new Date(),
        },
      });
    });

    await resetQueuedItems(run.id, queuedStaleMs);
    await resetStuckItems(run.id, stuckMs);
    const remaining = await prisma.productEnrichmentItem.count({
      where: {
        runId: run.id,
        status: { in: ["pending", "queued", "in_progress", "failed"] },
      },
    });

    if (remaining === 0) {
      await prisma.productEnrichmentRun.update({
        where: { id: run.id },
        data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
      });
    } else if (options.allowQueueRefill) {
      const pendingItems = await listPendingItems(run.id, enqueueLimit);
      await markItemsQueued(pendingItems.map((candidate) => candidate.id));
      await enqueueEnrichmentItems(pendingItems);
    }

    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts + 1;
    await prisma.productEnrichmentItem.update({
      where: { id: item.id },
      data: {
        status: "failed",
        attempts,
        lastError: message,
        lastStage: lastStage ?? "error",
      },
    });

    const consecutiveErrors = (run.consecutiveErrors ?? 0) + 1;
    const allowAutoPause = process.env.PRODUCT_ENRICHMENT_AUTO_PAUSE_ON_ERRORS === "true";
    const shouldPause = allowAutoPause && consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT;

    await updateRunAfterItem({
      runId: run.id,
      lastProductId: item.productId,
      lastStage: lastStage ?? "error",
      lastError: message,
      blockReason: shouldPause ? `consecutive_errors:${consecutiveErrors}` : run.blockReason,
      consecutiveErrors,
      status: shouldPause ? "paused" : run.status,
    });

    if (!shouldPause) {
      await resetQueuedItems(run.id, queuedStaleMs);
      await resetStuckItems(run.id, stuckMs);
      const remaining = await prisma.productEnrichmentItem.count({
        where: {
          runId: run.id,
          status: { in: ["pending", "queued", "in_progress", "failed"] },
        },
      });
      if (remaining === 0) {
        await prisma.productEnrichmentRun.update({
          where: { id: run.id },
          data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
        });
      } else if (options.allowQueueRefill) {
        const pendingItems = await listPendingItems(run.id, enqueueLimit);
        await markItemsQueued(pendingItems.map((candidate) => candidate.id));
        await enqueueEnrichmentItems(pendingItems);
      }
    }

    return { status: "failed", error: message };
  }
};

export const drainEnrichmentRun = async ({
  runId,
  batch,
  concurrency,
  maxMs,
  queuedStaleMs,
  stuckMs,
}: DrainEnrichmentRunOptions): Promise<DrainEnrichmentRunResult> => {
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
    const items = await listRunnableItems(runId, Math.min(safeConcurrency, remaining), true);
    if (!items.length) break;

    const results = await Promise.allSettled(
      items.map((item) =>
        processEnrichmentItemById(item.id, {
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

const OPENAI_MODEL = process.env.PRODUCT_ENRICHMENT_MODEL ?? "gpt-5-mini";
