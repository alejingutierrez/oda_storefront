import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  enrichProductWithOpenAI,
  productEnrichmentModel,
  productEnrichmentPromptVersion,
  productEnrichmentProvider,
  productEnrichmentSchemaVersion,
} from "@/lib/product-enrichment/openai";
import { enqueueEnrichmentItems } from "@/lib/product-enrichment/queue";
import {
  listPendingItems,
  listRunnableItems,
  markItemsQueued,
  resetQueuedItems,
  resetStuckItems,
  updateRunAfterItem,
} from "@/lib/product-enrichment/run-store";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 5));
const CONSECUTIVE_ERROR_LIMIT = Math.max(
  2,
  Number(process.env.PRODUCT_ENRICHMENT_CONSECUTIVE_ERROR_LIMIT ?? 5),
);
const ALLOW_REENRICH = process.env.PRODUCT_ENRICHMENT_ALLOW_REENRICH === "true";

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const isAlreadyEnrichedByAI = (metadata: Record<string, unknown> | null | undefined) => {
  const enrichment = asRecord(metadata?.enrichment);
  if (!enrichment) return false;
  return Boolean(
    enrichment.completed_at ||
      enrichment.provider ||
      enrichment.model ||
      enrichment.prompt_version,
  );
};

const buildOriginalVendorSignals = (metadata: Record<string, unknown> | null | undefined) => {
  const source = metadata ?? {};
  const output: Record<string, unknown> = {};
  if (typeof source.platform === "string") output.platform = source.platform;
  if (typeof source.product_type === "string") output.product_type = source.product_type;
  if (Array.isArray(source.tags) || typeof source.tags === "string") output.tags = source.tags;
  const meta = asRecord(source.meta);
  if (meta) {
    output.meta = {
      "og:title": typeof meta["og:title"] === "string" ? meta["og:title"] : null,
      "og:description": typeof meta["og:description"] === "string" ? meta["og:description"] : null,
      "twitter:title": typeof meta["twitter:title"] === "string" ? meta["twitter:title"] : null,
      "twitter:description":
        typeof meta["twitter:description"] === "string" ? meta["twitter:description"] : null,
      title: typeof meta.title === "string" ? meta.title : null,
      description: typeof meta.description === "string" ? meta.description : null,
      keywords: typeof meta.keywords === "string" ? meta.keywords : null,
    };
  }
  return output;
};

export const finalizeRunIfDone = async (runId: string) => {
  const remaining = await prisma.productEnrichmentItem.count({
    where: {
      runId,
      status: { in: ["pending", "queued", "in_progress", "failed"] },
      attempts: { lt: MAX_ATTEMPTS },
    },
  });

  if (remaining > 0) return null;

  const terminalFailed = await prisma.productEnrichmentItem.count({
    where: {
      runId,
      status: "failed",
      attempts: { gte: MAX_ATTEMPTS },
    },
  });

  const now = new Date();
  if (terminalFailed > 0) {
    await prisma.productEnrichmentRun.update({
      where: { id: runId },
      data: {
        status: "blocked",
        blockReason: `max_attempts:${terminalFailed}`,
        finishedAt: now,
        updatedAt: now,
      },
    });
    return { status: "blocked", terminalFailed };
  }

  await prisma.productEnrichmentRun.update({
    where: { id: runId },
    data: { status: "completed", finishedAt: now, updatedAt: now },
  });
  return { status: "completed", terminalFailed: 0 };
};
const resolveMinConcurrency = () => {
  const worker = Number(process.env.PRODUCT_ENRICHMENT_WORKER_CONCURRENCY ?? NaN);
  const drain = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY ?? NaN);
  const candidates = [20, worker, drain].filter((value) => Number.isFinite(value));
  return Math.max(...candidates);
};

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
    include: { run: true, product: { include: { variants: true, brand: true } } },
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

  const minConcurrency = resolveMinConcurrency();
  const enqueueLimit = Math.max(
    minConcurrency,
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

  const productMetadata =
    item.product.metadata && typeof item.product.metadata === "object"
      ? (item.product.metadata as Record<string, unknown>)
      : {};
  const existingEnrichment = asRecord(productMetadata.enrichment);

  if (!ALLOW_REENRICH && isAlreadyEnrichedByAI(productMetadata)) {
    await prisma.$transaction(async (tx) => {
      await tx.productEnrichmentItem.update({
        where: { id: item.id },
        data: {
          status: "completed",
          attempts: item.attempts,
          lastError: null,
          lastStage: "skipped_already_enriched",
          completedAt: new Date(),
        },
      });
      await tx.productEnrichmentRun.update({
        where: { id: run.id },
        data: {
          lastProductId: item.productId,
          lastStage: "skipped_already_enriched",
          lastError: null,
          consecutiveErrors: 0,
          updatedAt: new Date(),
        },
      });
    });

    const finalized = await finalizeRunIfDone(run.id);
    if (!finalized && options.allowQueueRefill) {
      const pendingItems = await listPendingItems(run.id, enqueueLimit);
      await markItemsQueued(pendingItems.map((candidate) => candidate.id));
      await enqueueEnrichmentItems(pendingItems);
    }
    return { status: "already_enriched" };
  }

  let lastStage: string | null = null;
  try {
    lastStage = productEnrichmentProvider;
    const enriched = await enrichProductWithOpenAI({
      product: {
        id: item.product.id,
        brandName: item.product.brand?.name ?? null,
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
        metadata: productMetadata,
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
    const completedAtIso = new Date().toISOString();
    const diagnostics = enriched.diagnostics ?? null;
    const originalDescription =
      typeof existingEnrichment?.original_description === "string"
        ? existingEnrichment.original_description
        : item.product.description ?? null;
    const originalVendorSignals =
      asRecord(existingEnrichment?.original_vendor_signals) ??
      buildOriginalVendorSignals(productMetadata);
    const enrichedVariantMap = new Map(enriched.variants.map((variant) => [variant.variantId, variant]));
    const nextProductMetadata = JSON.parse(
      JSON.stringify({
        ...productMetadata,
        enrichment: {
          ...(existingEnrichment ?? {}),
          model: productEnrichmentModel,
          provider: productEnrichmentProvider,
          prompt_version: productEnrichmentPromptVersion,
          schema_version: productEnrichmentSchemaVersion,
          completed_at: completedAtIso,
          run_id: run.id,
          original_description: originalDescription,
          original_vendor_signals: originalVendorSignals,
          signals: diagnostics?.signals ?? existingEnrichment?.signals ?? null,
          signal_strength:
            diagnostics?.signals?.signalStrength ?? existingEnrichment?.signal_strength ?? null,
          prompt_group: diagnostics?.promptGroup ?? existingEnrichment?.prompt_group ?? "generic",
          route: diagnostics?.route ?? existingEnrichment?.route ?? null,
          confidence: enriched.confidence ?? existingEnrichment?.confidence ?? null,
          consistency: {
            issues: diagnostics?.consistencyIssues ?? [],
            auto_fixes: diagnostics?.autoFixes ?? [],
            review_required: Boolean(enriched.reviewRequired),
            review_reasons: enriched.reviewReasons ?? [],
          },
          review_required: Boolean(enriched.reviewRequired),
          review_reasons: enriched.reviewReasons ?? [],
        },
      }),
    ) as Prisma.InputJsonValue;

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          description: enriched.description,
          category: enriched.category,
          subcategory: enriched.subcategory,
          styleTags: enriched.styleTags,
          materialTags: enriched.materialTags,
          patternTags: enriched.patternTags,
          occasionTags: enriched.occasionTags,
          gender: enriched.gender,
          season: enriched.season,
          seoTitle: enriched.seoTitle,
          seoDescription: enriched.seoDescription,
          seoTags: enriched.seoTags,
          metadata: nextProductMetadata,
        },
      });

      for (const variant of item.product.variants) {
        const enrichedVariant = enrichedVariantMap.get(variant.id);
        if (!enrichedVariant) continue;
        const baseMetadata =
          variant.metadata && typeof variant.metadata === "object"
            ? (variant.metadata as Record<string, unknown>)
            : {};
        const existingEnrichment =
          baseMetadata.enrichment && typeof baseMetadata.enrichment === "object"
            ? (baseMetadata.enrichment as Record<string, unknown>)
            : {};
        const nextVariantMetadata = JSON.parse(
          JSON.stringify({
            ...baseMetadata,
            enrichment: {
              ...existingEnrichment,
              colors: {
                hex: enrichedVariant.colorHexes,
                pantone: enrichedVariant.colorPantones,
              },
            },
          }),
        ) as Prisma.InputJsonValue;
        await tx.variant.update({
          where: { id: variant.id },
          data: {
            color: enrichedVariant.colorHex,
            colorPantone: enrichedVariant.colorPantone,
            fit: enrichedVariant.fit,
            metadata: nextVariantMetadata,
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
    const finalized = await finalizeRunIfDone(run.id);
    if (!finalized && options.allowQueueRefill) {
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
      const finalized = await finalizeRunIfDone(run.id);
      if (!finalized && options.allowQueueRefill) {
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
    if (!items.length) {
      await finalizeRunIfDone(runId);
      break;
    }

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
