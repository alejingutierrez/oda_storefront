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
  nextDueAt?: string;
  lastRunId?: string;
  lastStatus?: string;
  lastNewProducts?: number;
  lastPriceChanges?: number;
  lastStockChanges?: number;
  lastStockStatusChanges?: number;
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

export const getRefreshConfig = () => {
  const intervalDays = Math.max(1, Number(process.env.CATALOG_REFRESH_INTERVAL_DAYS ?? 7));
  const jitterHours = Math.max(0, Number(process.env.CATALOG_REFRESH_JITTER_HOURS ?? 12));
  const maxBrands = Math.max(1, Number(process.env.CATALOG_REFRESH_MAX_BRANDS ?? 4));
  const maxRuntimeMs = Math.max(5000, Number(process.env.CATALOG_REFRESH_MAX_RUNTIME_MS ?? 25000));
  const minGapHours = Math.max(1, Number(process.env.CATALOG_REFRESH_MIN_GAP_HOURS ?? 3));
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
    minGapHours,
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
  lastError?: string | null;
}) => {
  const brand = await prisma.brand.findUnique({ where: { id: params.brandId }, select: { metadata: true } });
  if (!brand) return;
  const metadata = readMetadata(brand.metadata);
  const config = getRefreshConfig();
  const nextMetadata = withRefreshMeta(metadata, {
    lastCompletedAt: params.status === "completed" ? new Date().toISOString() : undefined,
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

const collectMatchedProductIds = async (
  brandId: string,
  refs: Array<{ url?: string | null; externalId?: string | null }>,
) => {
  if (!refs.length) return new Set<string>();
  const urls = Array.from(new Set(refs.map((ref) => ref.url).filter(Boolean))) as string[];
  const externalIds = Array.from(
    new Set(refs.map((ref) => ref.externalId).filter(Boolean)),
  ) as string[];

  const matched = new Set<string>();
  const chunkSize = 500;

  for (const batch of chunk(urls, chunkSize)) {
    const rows = await prisma.product.findMany({
      where: { brandId, sourceUrl: { in: batch } },
      select: { id: true },
    });
    rows.forEach((row) => matched.add(row.id));
  }

  for (const batch of chunk(externalIds, chunkSize)) {
    const rows = await prisma.product.findMany({
      where: { brandId, externalId: { in: batch } },
      select: { id: true },
    });
    rows.forEach((row) => matched.add(row.id));
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

  const sitemapMatched = await collectMatchedProductIds(params.brandId, params.sitemapRefs);
  const adapterMatched = await collectMatchedProductIds(params.brandId, params.adapterRefs);
  const combinedMatched = await collectMatchedProductIds(params.brandId, params.combinedRefs);

  const toCoverage = (matched: number, total: number) => (total > 0 ? matched / total : 0);

  return {
    lastSitemapCount: sitemapTotal,
    lastSitemapMatched: sitemapMatched.size,
    lastSitemapCoverage: toCoverage(sitemapMatched.size, sitemapTotal),
    lastAdapterCount: adapterTotal,
    lastAdapterMatched: adapterMatched.size,
    lastAdapterCoverage: toCoverage(adapterMatched.size, adapterTotal),
    lastCombinedCount: combinedTotal,
    lastCombinedMatched: combinedMatched.size,
    lastCombinedCoverage: toCoverage(combinedMatched.size, combinedTotal),
    lastNewFromSitemap: Math.max(0, sitemapTotal - sitemapMatched.size),
    lastNewFromAdapter: Math.max(0, adapterTotal - adapterMatched.size),
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

const recoverEnrichmentRuns = async (config: ReturnType<typeof getRefreshConfig>) => {
  if (!config.autoRecover) return;
  if (!isEnrichmentQueueEnabled()) return;
  if (config.recoverMaxRuns <= 0) return;

  const cutoff = new Date(Date.now() - config.recoverEnrichmentStuckMinutes * 60 * 1000);
  const runs = await prisma.productEnrichmentRun.findMany({
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
  if (!isEnrichmentQueueEnabled()) return { queued: 0, skipped: "queue_disabled" };
  const existing = await findActiveEnrichmentRun({ scope: "brand", brandId });
  if (existing) return { queued: 0, skipped: "existing_run" };

  const rows = await getProductsMissingEnrichment(
    brandId,
    startedAt,
    config.enrichMaxProducts,
  );
  const ids = rows.map((row) => row.id);
  if (!ids.length) return { queued: 0, skipped: "no_new_products" };

  const run = await createEnrichmentRun({
    scope: "brand",
    brandId,
    productIds: ids,
    status: "processing",
    metadata: {
      mode: "new_products",
      created_at: new Date().toISOString(),
      provider: productEnrichmentProvider,
      model: productEnrichmentModel,
      prompt_version: productEnrichmentPromptVersion,
      schema_version: productEnrichmentSchemaVersion,
    },
  });

  const pending = await listPendingEnrichmentItems(run.id, Math.max(10, ids.length));
  await markEnrichmentItemsQueued(pending.map((item) => item.id));
  await enqueueEnrichmentItems(pending);

  return { queued: pending.length, runId: run.id };
};

export const finalizeRefreshForRun = async (params: {
  brandId: string;
  runId: string;
  startedAt: Date;
  status: "completed" | "blocked" | "failed";
  lastError?: string | null;
}) => {
  const metrics = await computeRefreshMetrics(params.brandId, params.startedAt);
  let enrichmentError: string | null = null;
  if (params.status === "completed") {
    try {
      await enqueueNewProductEnrichment(params.brandId, params.startedAt);
    } catch (error) {
      enrichmentError = error instanceof Error ? error.message : String(error);
    }
  }
  await markRefreshCompleted({
    brandId: params.brandId,
    runId: params.runId,
    status: params.status,
    newProducts: metrics.newProducts,
    priceChanges: metrics.priceChanges,
    stockChanges: metrics.stockChanges,
    stockStatusChanges: metrics.stockStatusChanges,
    lastError: params.lastError ?? enrichmentError ?? null,
  });
};

export const runCatalogRefreshBatch = async (options?: { brandId?: string | null; force?: boolean }) => {
  const config = getRefreshConfig();
  const startedAt = Date.now();
  const now = new Date();
  const results: Array<{ brandId: string; status: string; runId?: string; reason?: string }> = [];

  if (!isCatalogQueueEnabled()) {
    return { status: "queue_disabled", processed: 0, results };
  }

  await recoverCatalogRuns(config);
  await recoverEnrichmentRuns(config);

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

  for (const brand of selected) {
    if (Date.now() - startedAt > config.maxRuntimeMs) break;
    const existingRun = await prisma.catalogRun.findFirst({
      where: { brandId: brand.id, status: { in: ["processing", "paused", "blocked", "stopped"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (existingRun) {
      results.push({ brandId: brand.id, status: "skipped", reason: "active_run" });
      continue;
    }

    const refreshLimitRaw = Number(process.env.CATALOG_REFRESH_DISCOVERY_LIMIT ?? 5000);
    const refreshLimit = Number.isFinite(refreshLimitRaw) ? refreshLimitRaw : 5000;
    const discoveryLimit = refreshLimit <= 0 ? 0 : Math.max(10, refreshLimit);

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

    const lookbackStart = new Date(Date.now() - config.failedLookbackDays * 24 * 60 * 60 * 1000);
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
      results.push({ brandId: brand.id, status: "skipped", reason: "no_refs" });
      continue;
    }

    const run = await createRunWithItems({
      brandId: brand.id,
      platform: platformForRun ?? brand.ecommercePlatform,
      refs: deduped,
      status: "processing",
    });

    const coverage = await computeCoverageMetrics({
      brandId: brand.id,
      sitemapRefs: sitemapRefs ?? [],
      adapterRefs: adapterRefs ?? [],
      combinedRefs: combinedDiscoveryRefs,
    });
    await markRefreshStarted(brand.id, run.id, coverage);

    const pending = await listPendingItems(run.id, Math.max(10, deduped.length));
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

    results.push({ brandId: brand.id, status: "started", runId: run.id });
  }

  return { status: "ok", processed: results.length, results };
};
