import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import { enqueueCatalogItems, isCatalogQueueEnabled } from "@/lib/catalog/queue";
import {
  createRunWithItems,
  listPendingItems,
  markItemsQueued,
  resetQueuedItems,
  resetStuckItems,
} from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";
import { enqueueEnrichmentItems, isEnrichmentQueueEnabled } from "@/lib/product-enrichment/queue";
import {
  createRunWithItems as createEnrichmentRun,
  findActiveRun as findActiveEnrichmentRun,
  listPendingItems as listPendingEnrichmentItems,
  markItemsQueued as markEnrichmentItemsQueued,
  resetQueuedItems as resetEnrichmentQueuedItems,
  resetStuckItems as resetEnrichmentStuckItems,
} from "@/lib/product-enrichment/run-store";
import {
  productEnrichmentModel,
  productEnrichmentPromptVersion,
  productEnrichmentProvider,
  productEnrichmentSchemaVersion,
} from "@/lib/product-enrichment/openai";

type CatalogRefreshMeta = {
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastFinishedAt?: string;
  nextDueAt?: string;
  lastRunId?: string;
  lastStatus?: string;
  lastNewProducts?: number;
  lastPriceChanges?: number;
  lastStockChanges?: number;
  lastStockStatusChanges?: number;
  lastRunTotalItems?: number;
  lastRunCompletedItems?: number;
  lastRunFailedItems?: number;
  lastRunSuccessRate?: number;
  lastRunDurationMs?: number;
  lastSitemapCount?: number;
  lastSitemapMatched?: number;
  lastSitemapCoverage?: number;
  lastAdapterCount?: number;
  lastAdapterMatched?: number;
  lastAdapterCoverage?: number;
  lastCombinedCount?: number;
  lastCombinedMatched?: number;
  lastCombinedCoverage?: number;
  lastNewFromSitemap?: number;
  lastNewFromAdapter?: number;
  lastError?: string | null;
};

const readMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const readRefreshMeta = (metadata: Record<string, unknown>): CatalogRefreshMeta => {
  const entry = metadata.catalog_refresh;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  return entry as CatalogRefreshMeta;
};

const withRefreshMeta = (metadata: Record<string, unknown>, patch: CatalogRefreshMeta) => {
  const cleaned = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as CatalogRefreshMeta;
  return {
    ...metadata,
    catalog_refresh: {
      ...(readRefreshMeta(metadata) ?? {}),
      ...cleaned,
    },
  };
};

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

type RefreshConfigOverrides = {
  maxBrands?: number;
  maxRuntimeMs?: number;
  brandConcurrency?: number;
};

export const getRefreshConfig = (overrides?: RefreshConfigOverrides) => {
  const intervalDays = Math.max(1, Number(process.env.CATALOG_REFRESH_INTERVAL_DAYS ?? 7));
  const jitterHours = Math.max(0, Number(process.env.CATALOG_REFRESH_JITTER_HOURS ?? 12));
  const envMaxBrands = Math.max(1, Number(process.env.CATALOG_REFRESH_MAX_BRANDS ?? 4));
  const envMaxRuntimeMs = Math.max(5000, Number(process.env.CATALOG_REFRESH_MAX_RUNTIME_MS ?? 25000));
  const envBrandConcurrency = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_BRAND_CONCURRENCY ?? 1),
  );
  const maxBrands = Number.isFinite(overrides?.maxBrands)
    ? Math.max(1, Math.floor(Number(overrides?.maxBrands)))
    : envMaxBrands;
  const maxRuntimeMs = Number.isFinite(overrides?.maxRuntimeMs)
    ? Math.max(5000, Math.floor(Number(overrides?.maxRuntimeMs)))
    : envMaxRuntimeMs;
  const brandConcurrencyRaw = Number.isFinite(overrides?.brandConcurrency)
    ? Math.floor(Number(overrides?.brandConcurrency))
    : envBrandConcurrency;
  const brandConcurrency = Math.max(1, Math.min(maxBrands, brandConcurrencyRaw));
  const minGapHours = Math.max(1, Number(process.env.CATALOG_REFRESH_MIN_GAP_HOURS ?? 3));
  const maxFailedItems = Math.max(0, Number(process.env.CATALOG_REFRESH_MAX_FAILED_ITEMS ?? 5));
  const maxFailedRateRaw = Number(process.env.CATALOG_REFRESH_MAX_FAILED_RATE ?? 0.01);
  const maxFailedRate = Number.isFinite(maxFailedRateRaw)
    ? Math.max(0, Math.min(1, maxFailedRateRaw))
    : 0.01;
  const drainOnRun = process.env.CATALOG_REFRESH_DRAIN_ON_RUN === "true";
  const autoRecover = process.env.CATALOG_REFRESH_AUTO_RECOVER !== "false";
  const recoverMaxRuns = Math.max(
    0,
    Number(process.env.CATALOG_REFRESH_RECOVER_MAX_RUNS ?? 3),
  );
  const recoverStuckMinutes = Math.max(
    5,
    Number(process.env.CATALOG_REFRESH_RECOVER_STUCK_MINUTES ?? 60),
  );
  const recoverEnrichmentStuckMinutes = Math.max(
    5,
    Number(process.env.CATALOG_REFRESH_ENRICH_RECOVER_STUCK_MINUTES ?? 60),
  );
  const failedLookbackDays = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_FAILED_LOOKBACK_DAYS ?? 30),
  );
  const failedUrlLimit = Math.max(
    0,
    Number(process.env.CATALOG_REFRESH_FAILED_URL_LIMIT ?? 2000),
  );
  const enrichLookbackDays = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_ENRICH_LOOKBACK_DAYS ?? 14),
  );
  const enrichMaxProducts = Math.max(
    0,
    Number(process.env.CATALOG_REFRESH_ENRICH_MAX_PRODUCTS ?? 1500),
  );
  return {
    intervalDays,
    jitterHours,
    maxBrands,
    maxRuntimeMs,
    brandConcurrency,
    minGapHours,
    maxFailedItems,
    maxFailedRate,
    drainOnRun,
    autoRecover,
    recoverMaxRuns,
    recoverStuckMinutes,
    recoverEnrichmentStuckMinutes,
    failedLookbackDays,
    failedUrlLimit,
    enrichLookbackDays,
    enrichMaxProducts,
  };
};

const computeNextDueAt = (now: Date, intervalDays: number, jitterHours: number) => {
  const baseMs = intervalDays * 24 * 60 * 60 * 1000;
  const jitterMs = jitterHours * 60 * 60 * 1000;
  const offset = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return new Date(now.getTime() + baseMs + offset).toISOString();
};

export const isBrandDueForRefresh = (
  metadata: Record<string, unknown>,
  now: Date,
  config = getRefreshConfig(),
) => {
  const refresh = readRefreshMeta(metadata);
  const nextDue = parseDate(refresh.nextDueAt);
  if (nextDue && nextDue <= now) return true;
  const lastCompleted = parseDate(refresh.lastCompletedAt);
  if (lastCompleted) {
    const windowMs = config.intervalDays * 24 * 60 * 60 * 1000;
    return now.getTime() - lastCompleted.getTime() >= windowMs;
  }
  const lastStarted = parseDate(refresh.lastStartedAt);
  if (lastStarted) {
    const minGapMs = config.minGapHours * 60 * 60 * 1000;
    return now.getTime() - lastStarted.getTime() >= minGapMs;
  }
  return true;
};

export const markRefreshStarted = async (
  brandId: string,
  runId: string,
  coverage?: Partial<CatalogRefreshMeta>,
) => {
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { metadata: true } });
  if (!brand) return;
  const metadata = readMetadata(brand.metadata);
  const nextMetadata = withRefreshMeta(metadata, {
    lastStartedAt: new Date().toISOString(),
    lastRunId: runId,
    lastStatus: "processing",
    lastError: null,
    ...(coverage ?? {}),
  });
  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });
};

export const markRefreshCompleted = async (params: {
  brandId: string;
  runId: string;
  status: "completed" | "blocked" | "failed";
  newProducts: number;
  priceChanges: number;
  stockChanges: number;
  stockStatusChanges: number;
  runTotalItems?: number;
  runCompletedItems?: number;
  runFailedItems?: number;
  runSuccessRate?: number;
  runDurationMs?: number;
  lastError?: string | null;
}) => {
  const brand = await prisma.brand.findUnique({ where: { id: params.brandId }, select: { metadata: true } });
  if (!brand) return;
  const metadata = readMetadata(brand.metadata);
  const config = getRefreshConfig();
  const nextMetadata = withRefreshMeta(metadata, {
    lastCompletedAt: params.status === "completed" ? new Date().toISOString() : undefined,
    lastFinishedAt: new Date().toISOString(),
    nextDueAt:
      params.status === "completed"
        ? computeNextDueAt(new Date(), config.intervalDays, config.jitterHours)
        : undefined,
    lastRunId: params.runId,
    lastStatus: params.status,
    lastNewProducts: params.newProducts,
    lastPriceChanges: params.priceChanges,
    lastStockChanges: params.stockChanges,
    lastStockStatusChanges: params.stockStatusChanges,
    lastRunTotalItems: params.runTotalItems,
    lastRunCompletedItems: params.runCompletedItems,
    lastRunFailedItems: params.runFailedItems,
    lastRunSuccessRate: params.runSuccessRate,
    lastRunDurationMs: params.runDurationMs,
    lastError: params.lastError ?? null,
  });
  await prisma.brand.update({
    where: { id: params.brandId },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });
};

const computeRefreshMetrics = async (brandId: string, startedAt: Date) => {
  const newProducts = await prisma.product.count({
    where: { brandId, createdAt: { gte: startedAt } },
  });

  const [priceChanges] = await prisma.$queryRaw<{ count: number }[]>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "price_history" ph
      INNER JOIN "variants" v ON v.id = ph."variantId"
      INNER JOIN "products" p ON p.id = v."productId"
      WHERE p."brandId" = ${brandId}
        AND ph."capturedAt" >= ${startedAt}
    `,
  );

  const [stockChanges] = await prisma.$queryRaw<{ count: number }[]>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "stock_history" sh
      INNER JOIN "variants" v ON v.id = sh."variantId"
      INNER JOIN "products" p ON p.id = v."productId"
      WHERE p."brandId" = ${brandId}
        AND sh."capturedAt" >= ${startedAt}
    `,
  );

  const [stockStatusChanges] = await prisma.$queryRaw<{ count: number }[]>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "variants" v
      INNER JOIN "products" p ON p.id = v."productId"
      WHERE p."brandId" = ${brandId}
        AND (v."metadata" ->> 'last_stock_status_changed_at')::timestamptz >= ${startedAt}
    `,
  );

  return {
    newProducts,
    priceChanges: priceChanges?.count ?? 0,
    stockChanges: stockChanges?.count ?? 0,
    stockStatusChanges: stockStatusChanges?.count ?? 0,
  };
};

const chunk = <T,>(items: T[], size: number) => {
  if (!items.length) return [];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const collectMatchedDiscoveryKeys = async (
  brandId: string,
  refs: Array<{ url?: string | null; externalId?: string | null }>,
) => {
  if (!refs.length) {
    return { matchedUrls: new Set<string>(), matchedExternalIds: new Set<string>() };
  }

  const urls = Array.from(new Set(refs.map((ref) => ref.url).filter(Boolean))) as string[];
  const externalIds = Array.from(new Set(refs.map((ref) => ref.externalId).filter(Boolean))) as string[];

  const matchedUrls = new Set<string>();
  const matchedExternalIds = new Set<string>();

  const chunkSize = 500;

  for (const batch of chunk(urls, chunkSize)) {
    const rows = await prisma.product.findMany({
      where: { brandId, sourceUrl: { in: batch } },
      select: { sourceUrl: true },
    });
    rows.forEach((row) => {
      if (row.sourceUrl) matchedUrls.add(row.sourceUrl);
    });
  }

  for (const batch of chunk(externalIds, chunkSize)) {
    const rows = await prisma.product.findMany({
      where: { brandId, externalId: { in: batch } },
      select: { externalId: true },
    });
    rows.forEach((row) => {
      if (row.externalId) matchedExternalIds.add(row.externalId);
    });
  }

  return { matchedUrls, matchedExternalIds };
};

const countMatchedDiscoveryRefs = (
  refs: Array<{ url?: string | null; externalId?: string | null }>,
  matchedUrls: Set<string>,
  matchedExternalIds: Set<string>,
) => {
  if (!refs.length) return 0;
  let matched = 0;
  for (const ref of refs) {
    const url = ref.url ?? null;
    const externalId = ref.externalId ?? null;
    if (url && matchedUrls.has(url)) {
      matched += 1;
      continue;
    }
    if (externalId && matchedExternalIds.has(externalId)) {
      matched += 1;
    }
  }
  return matched;
};

const computeCoverageMetrics = async (params: {
  brandId: string;
  sitemapRefs: Array<{ url?: string | null; externalId?: string | null }>;
  adapterRefs: Array<{ url?: string | null; externalId?: string | null }>;
  combinedRefs: Array<{ url?: string | null; externalId?: string | null }>;
}) => {
  const sitemapTotal = params.sitemapRefs.length;
  const adapterTotal = params.adapterRefs.length;
  const combinedTotal = params.combinedRefs.length;

  // Coverage is intended to reflect the % of discovery refs (URLs / externalIds) that already
  // exist in our DB before the refresh. We compute matches at the ref-level (not distinct products)
  // to avoid undercounting when multiple discovery refs map to the same product.
  const keys = await collectMatchedDiscoveryKeys(params.brandId, params.combinedRefs);
  const sitemapMatched = countMatchedDiscoveryRefs(
    params.sitemapRefs,
    keys.matchedUrls,
    keys.matchedExternalIds,
  );
  const adapterMatched = countMatchedDiscoveryRefs(
    params.adapterRefs,
    keys.matchedUrls,
    keys.matchedExternalIds,
  );
  const combinedMatched = countMatchedDiscoveryRefs(
    params.combinedRefs,
    keys.matchedUrls,
    keys.matchedExternalIds,
  );

  const toCoverage = (matched: number, total: number) => (total > 0 ? matched / total : 0);

  return {
    lastSitemapCount: sitemapTotal,
    lastSitemapMatched: sitemapMatched,
    lastSitemapCoverage: toCoverage(sitemapMatched, sitemapTotal),
    lastAdapterCount: adapterTotal,
    lastAdapterMatched: adapterMatched,
    lastAdapterCoverage: toCoverage(adapterMatched, adapterTotal),
    lastCombinedCount: combinedTotal,
    lastCombinedMatched: combinedMatched,
    lastCombinedCoverage: toCoverage(combinedMatched, combinedTotal),
    lastNewFromSitemap: Math.max(0, sitemapTotal - sitemapMatched),
    lastNewFromAdapter: Math.max(0, adapterTotal - adapterMatched),
  };
};

const recoverCatalogRuns = async (config: ReturnType<typeof getRefreshConfig>) => {
  if (!config.autoRecover) return;
  if (!isCatalogQueueEnabled()) return;
  if (config.recoverMaxRuns <= 0) return;

  const cutoff = new Date(Date.now() - config.recoverStuckMinutes * 60 * 1000);
  const runs = await prisma.catalogRun.findMany({
    where: {
      status: { in: ["processing", "paused", "blocked"] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: config.recoverMaxRuns,
  });

  if (!runs.length) return;
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );

  for (const run of runs) {
    await prisma.catalogRun.update({
      where: { id: run.id },
      data: {
        status: "processing",
        consecutiveErrors: 0,
        lastError: null,
        blockReason: null,
        updatedAt: new Date(),
      },
    });
    await resetQueuedItems(run.id, 0);
    await resetStuckItems(run.id, 0);
    const pending = await listPendingItems(run.id, enqueueLimit);
    await markItemsQueued(pending.map((item) => item.id));
    await enqueueCatalogItems(pending);
  }
};

const pauseCatalogRefreshAutoStartDisabledRuns = async () => {
  const runs = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id
      FROM "product_enrichment_runs"
      WHERE status = 'processing'
        AND COALESCE(metadata->>'created_by', '') = 'catalog_refresh'
        AND COALESCE(metadata->>'auto_start', 'false') = 'false'
      LIMIT 500
    `,
  );

  if (!runs.length) return { paused: 0 };
  const ids = runs.map((run) => run.id);
  const now = new Date();

  await prisma.productEnrichmentItem.updateMany({
    where: { runId: { in: ids }, status: { in: ["queued", "in_progress"] } },
    data: { status: "pending", startedAt: null, updatedAt: now },
  });
  await prisma.productEnrichmentRun.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "paused",
      blockReason: "auto_start_disabled",
      lastError: "catalog_refresh_auto_start_disabled",
      updatedAt: now,
    },
  });

  return { paused: ids.length };
};

const recoverEnrichmentRuns = async (config: ReturnType<typeof getRefreshConfig>) => {
  if (!config.autoRecover) return;
  if (!isEnrichmentQueueEnabled()) return;
  if (config.recoverMaxRuns <= 0) return;

  const cutoff = new Date(Date.now() - config.recoverEnrichmentStuckMinutes * 60 * 1000);
  const runs = await prisma.productEnrichmentRun.findMany({
    where: {
      // Only auto-recover runs that are already executing. Paused/stopped/blocked runs
      // should remain manual to avoid unexpected OpenAI usage.
      status: { in: ["processing"] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: config.recoverMaxRuns,
  });

  if (!runs.length) return;
  const enqueueLimit = Math.max(
    1,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT ?? 50),
  );

  for (const run of runs) {
    await prisma.productEnrichmentRun.update({
      where: { id: run.id },
      data: {
        status: "processing",
        consecutiveErrors: 0,
        lastError: null,
        blockReason: null,
        updatedAt: new Date(),
      },
    });
    await resetEnrichmentQueuedItems(run.id, 0);
    await resetEnrichmentStuckItems(run.id, 0);
    const pending = await listPendingEnrichmentItems(run.id, enqueueLimit);
    await markEnrichmentItemsQueued(pending.map((item) => item.id));
    await enqueueEnrichmentItems(pending);
  }
};

const reconcileStaleRefreshStates = async () => {
  const rows = await prisma.$queryRaw<
    { brandId: string; runId: string | null; startedAt: Date | null }[]
  >(Prisma.sql`
    SELECT b.id as "brandId", r.id as "runId", r."startedAt" as "startedAt"
    FROM "brands" b
    LEFT JOIN LATERAL (
      SELECT r2.id, r2."startedAt"
      FROM "catalog_runs" r2
      WHERE r2."brandId" = b.id
      ORDER BY r2."updatedAt" DESC
      LIMIT 1
    ) r ON true
    WHERE (
      (b."metadata"->'catalog_refresh'->>'lastStatus') = 'processing'
      OR (b."metadata"->'catalog_refresh'->>'lastError') ILIKE '%missing FROM-clause entry for table \"p\"%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "catalog_runs" r3
      WHERE r3."brandId" = b.id
        AND r3.status IN ('processing', 'paused', 'blocked')
    )
    AND r.id IS NOT NULL
    LIMIT 50
  `);

  for (const row of rows) {
    if (!row.runId || !row.startedAt) continue;
    try {
      await finalizeRefreshForRun({
        brandId: row.brandId,
        runId: row.runId,
        startedAt: row.startedAt,
      });
    } catch (error) {
      console.warn("catalog.refresh.reconcile_failed", row.brandId, row.runId, error);
    }
  }
};

const getProductsMissingEnrichment = async (
  brandId: string,
  startedAt: Date,
  limit: number,
) => {
  return prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT DISTINCT p.id
      FROM "products" p
      WHERE p."brandId" = ${brandId}
        AND (p."metadata" -> 'enrichment') IS NULL
        AND (
          p."createdAt" >= ${startedAt}
        )
      LIMIT ${limit}
    `,
  );
};

const enqueueNewProductEnrichment = async (brandId: string, startedAt: Date) => {
  const config = getRefreshConfig();
  const existing = await findActiveEnrichmentRun({ scope: "brand", brandId });

  const rows = await getProductsMissingEnrichment(
    brandId,
    startedAt,
    config.enrichMaxProducts,
  );
  const ids = rows.map((row) => row.id);
  if (!ids.length) return { queued: 0, skipped: "no_new_products" };

  // If there's already a non-completed run, append new products to it but keep the
  // run non-processing unless it was already processing.
  if (existing) {
    if (existing.status === "processing") {
      return { queued: 0, skipped: "existing_processing_run", runId: existing.id };
    }

    const inserted = await prisma.productEnrichmentItem.createMany({
      data: ids.map((productId) => ({
        runId: existing.id,
        productId,
        status: "pending",
        attempts: 0,
      })),
      skipDuplicates: true,
    });

    if (inserted.count > 0) {
      await prisma.productEnrichmentRun.update({
        where: { id: existing.id },
        data: {
          totalItems: { increment: inserted.count },
          updatedAt: new Date(),
        },
      });
    }

    return { queued: inserted.count, runId: existing.id, appended: true };
  }

  const run = await createEnrichmentRun({
    scope: "brand",
    brandId,
    productIds: ids,
    // The refresh pipeline should only queue pending enrichment work, not execute it.
    // This avoids unexpected OpenAI quota usage. Admin/workers can resume the run
    // explicitly via /api/admin/product-enrichment/run.
    status: "paused",
    metadata: {
      mode: "new_products",
      auto_start: false,
      created_by: "catalog_refresh",
      created_at: new Date().toISOString(),
      provider: productEnrichmentProvider,
      model: productEnrichmentModel,
      prompt_version: productEnrichmentPromptVersion,
      schema_version: productEnrichmentSchemaVersion,
    },
  });

  // Keep items as "pending" and do not enqueue them into BullMQ. This ensures the
  // Vercel cron drain doesn't pick up the run (it only drains status=processing).
  return { queued: ids.length, runId: run.id, status: "paused" };
};

export const finalizeRefreshForRun = async (params: {
  brandId: string;
  runId: string;
  startedAt: Date;
  lastError?: string | null;
}) => {
  const run = await prisma.catalogRun.findUnique({
    where: { id: params.runId },
    select: { totalItems: true, lastError: true },
  });
  if (!run) {
    await markRefreshCompleted({
      brandId: params.brandId,
      runId: params.runId,
      status: "failed",
      newProducts: 0,
      priceChanges: 0,
      stockChanges: 0,
      stockStatusChanges: 0,
      runTotalItems: 0,
      runCompletedItems: 0,
      runFailedItems: 0,
      runSuccessRate: 0,
      runDurationMs: Math.max(0, Date.now() - params.startedAt.getTime()),
      lastError: params.lastError ?? "missing_catalog_run",
    });
    return;
  }

  const counts = await prisma.catalogItem.groupBy({
    by: ["status"],
    where: { runId: params.runId },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  counts.forEach((row) => map.set(row.status, row._count._all));
  const completedItems = map.get("completed") ?? 0;
  const failedItems = map.get("failed") ?? 0;
  const totalFromCounts = Array.from(map.values()).reduce((acc, value) => acc + value, 0);
  const totalItems = run.totalItems || totalFromCounts;
  const successRate = totalItems > 0 ? completedItems / totalItems : 0;

  const config = getRefreshConfig();
  const shouldFail =
    failedItems > config.maxFailedItems &&
    (totalItems > 0 ? failedItems / totalItems : 1) > config.maxFailedRate;
  const status: "completed" | "failed" = shouldFail ? "failed" : "completed";

  const [topErrorRow] = failedItems
    ? await prisma.$queryRaw<{ lastError: string | null; count: number }[]>(
        Prisma.sql`
          SELECT "lastError", COUNT(*)::int AS count
          FROM "catalog_items"
          WHERE "runId" = ${params.runId}
            AND status = 'failed'
          GROUP BY "lastError"
          ORDER BY count DESC NULLS LAST
          LIMIT 1
        `,
      )
    : [];
  const topError = topErrorRow?.lastError ?? null;
  const lastError =
    params.lastError ??
    (failedItems > 0
      ? (topError ?? run.lastError ?? (status === "failed" ? "catalog_failed_items" : `catalog_soft_failures:${failedItems}`))
      : null);

  const metrics = await computeRefreshMetrics(params.brandId, params.startedAt);
  let enrichmentError: string | null = null;
  if (status === "completed") {
    try {
      await enqueueNewProductEnrichment(params.brandId, params.startedAt);
    } catch (error) {
      enrichmentError = error instanceof Error ? error.message : String(error);
    }
  }
  await markRefreshCompleted({
    brandId: params.brandId,
    runId: params.runId,
    status,
    newProducts: metrics.newProducts,
    priceChanges: metrics.priceChanges,
    stockChanges: metrics.stockChanges,
    stockStatusChanges: metrics.stockStatusChanges,
    runTotalItems: totalItems,
    runCompletedItems: completedItems,
    runFailedItems: failedItems,
    runSuccessRate: Number.isFinite(successRate) ? successRate : 0,
    runDurationMs: Math.max(0, Date.now() - params.startedAt.getTime()),
    lastError: enrichmentError ?? lastError ?? null,
  });
};

type CatalogRefreshBatchResult = {
  brandId: string;
  status: string;
  runId?: string;
  reason?: string;
};

type RunCatalogRefreshBatchOptions = {
  brandId?: string | null;
  force?: boolean;
  maxBrands?: number;
  brandConcurrency?: number;
  maxRuntimeMs?: number;
};

export const runCatalogRefreshBatch = async (options?: RunCatalogRefreshBatchOptions) => {
  const config = getRefreshConfig({
    maxBrands: options?.maxBrands,
    brandConcurrency: options?.brandConcurrency,
    maxRuntimeMs: options?.maxRuntimeMs,
  });
  const startedAt = Date.now();
  const now = new Date();
  const results: CatalogRefreshBatchResult[] = [];

  if (!isCatalogQueueEnabled()) {
    return { status: "queue_disabled", processed: 0, results };
  }

  await recoverCatalogRuns(config);
  await pauseCatalogRefreshAutoStartDisabledRuns();
  await recoverEnrichmentRuns(config);
  await reconcileStaleRefreshStates();

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      siteUrl: { not: null },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      siteUrl: true,
      manualReview: true,
      metadata: true,
      ecommercePlatform: true,
    },
  });

  const candidates = options?.brandId
    ? brands.filter((brand) => brand.id === options.brandId)
    : brands.filter((brand) => {
        if (brand.manualReview) return false;
        const metadata = readMetadata(brand.metadata);
        return options?.force ? true : isBrandDueForRefresh(metadata, now, config);
      });

  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, config.maxBrands);
  if (!selected.length) {
    return {
      status: "ok",
      processed: 0,
      selected: 0,
      brandConcurrency: 0,
      results,
    };
  }

  const refreshLimitRaw = Number(process.env.CATALOG_REFRESH_DISCOVERY_LIMIT ?? 5000);
  const refreshLimit = Number.isFinite(refreshLimitRaw) ? refreshLimitRaw : 5000;
  const discoveryLimit = refreshLimit <= 0 ? 0 : Math.max(10, refreshLimit);
  const lookbackStart = new Date(Date.now() - config.failedLookbackDays * 24 * 60 * 60 * 1000);
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const coverageEnabled = process.env.CATALOG_REFRESH_COVERAGE_ENABLED !== "false";

  const processBrand = async (
    brand: (typeof selected)[number],
  ): Promise<CatalogRefreshBatchResult> => {
    if (Date.now() - startedAt > config.maxRuntimeMs) {
      return { brandId: brand.id, status: "skipped", reason: "runtime_budget" };
    }
    const existingRun = await prisma.catalogRun.findFirst({
      where: { brandId: brand.id, status: { in: ["processing", "paused", "blocked"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (existingRun) {
      return { brandId: brand.id, status: "skipped", reason: "active_run" };
    }

    const forceSitemap =
      options?.force || (brand.ecommercePlatform ?? "").toLowerCase() !== "vtex";
    const { refs, platformForRun, sitemapRefs, adapterRefs } = await discoverCatalogRefs({
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        siteUrl: brand.siteUrl ?? "",
        ecommercePlatform: brand.ecommercePlatform,
      },
      limit: discoveryLimit,
      forceSitemap,
      combineSitemapAndAdapter: true,
    });
    const combinedDiscoveryRefs = Array.from(
      new Map([...(sitemapRefs ?? []), ...(adapterRefs ?? [])].map((ref) => [ref.url, ref])).values(),
    );

    const failedRows = await prisma.$queryRaw<{ url: string }[]>(
      Prisma.sql`
        SELECT DISTINCT ci.url
        FROM "catalog_items" ci
        INNER JOIN "catalog_runs" cr ON cr.id = ci."runId"
        WHERE cr."brandId" = ${brand.id}
          AND ci.status = 'failed'
          AND ci."updatedAt" >= ${lookbackStart}
        LIMIT ${config.failedUrlLimit}
      `,
    );
    const failedRefs = failedRows.map((row) => ({ url: row.url }));
    const mergedRefs = refs.length ? refs.concat(failedRefs) : failedRefs;
    const deduped = Array.from(
      new Map(mergedRefs.map((ref) => [ref.url, ref])).values(),
    );

    if (!deduped.length) {
      return { brandId: brand.id, status: "skipped", reason: "no_refs" };
    }

    const run = await createRunWithItems({
      brandId: brand.id,
      platform: platformForRun ?? brand.ecommercePlatform,
      refs: deduped,
      status: "processing",
    });

    if (coverageEnabled) {
      const coverage = await computeCoverageMetrics({
        brandId: brand.id,
        sitemapRefs: sitemapRefs ?? [],
        adapterRefs: adapterRefs ?? [],
        combinedRefs: combinedDiscoveryRefs,
      });
      await markRefreshStarted(brand.id, run.id, coverage);
    } else {
      await markRefreshStarted(brand.id, run.id);
    }

    // Avoid dumping thousands of jobs into Redis at once. The worker refills the queue
    // as items are completed/failed (allowQueueRefill=true).
    const pending = await listPendingItems(run.id, Math.max(10, enqueueLimit));
    await markItemsQueued(pending.map((item) => item.id));
    await enqueueCatalogItems(pending);

    if (config.drainOnRun) {
      await drainCatalogRun({
        runId: run.id,
        batch: Math.min(pending.length, 50),
        concurrency: Math.min(10, pending.length || 1),
        maxMs: 15000,
        queuedStaleMs: 0,
        stuckMs: 0,
      });
    }

    return { brandId: brand.id, status: "started", runId: run.id };
  };

  const brandConcurrency = Math.max(
    1,
    Math.min(
      options?.brandId ? 1 : config.brandConcurrency,
      selected.length,
    ),
  );
  const pendingBrands = [...selected];

  const worker = async () => {
    while (pendingBrands.length) {
      if (Date.now() - startedAt > config.maxRuntimeMs) return;
      const brand = pendingBrands.shift();
      if (!brand) return;
      try {
        const result = await processBrand(brand);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ brandId: brand.id, status: "failed", reason: message.slice(0, 240) });
      }
    }
  };

  await Promise.all(
    Array.from({ length: brandConcurrency }, () => worker()),
  );

  if (pendingBrands.length && Date.now() - startedAt > config.maxRuntimeMs) {
    for (const brand of pendingBrands) {
      results.push({ brandId: brand.id, status: "skipped", reason: "runtime_budget" });
    }
  }

  return {
    status: "ok",
    processed: results.length,
    selected: selected.length,
    brandConcurrency,
    results,
  };
};
