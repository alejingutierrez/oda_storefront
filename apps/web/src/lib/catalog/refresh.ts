import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import type { ProductRef } from "@/lib/catalog/types";
import { isCatalogQueueEnabled } from "@/lib/catalog/queue";
import { topUpCatalogRunQueue } from "@/lib/catalog/queue-control";
import { readCatalogQueueDriftSummary, reconcileCatalogQueue } from "@/lib/catalog/queue-drift";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";
import {
  createRunWithItems,
  resetQueuedItemsAll,
  resetStuckItemsAll,
} from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";
import { enqueueEnrichmentItems, isEnrichmentQueueEnabled } from "@/lib/product-enrichment/queue";
import {
  createRunWithItems as createEnrichmentRun,
  findActiveRun as findActiveEnrichmentRun,
  listPendingItems as listPendingEnrichmentItems,
  markItemsQueued as markEnrichmentItemsQueued,
  resetQueuedItemsAll as resetEnrichmentQueuedItemsAll,
  resetStuckItemsAll as resetEnrichmentStuckItemsAll,
} from "@/lib/product-enrichment/run-store";
import {
  productEnrichmentModel,
  productEnrichmentPromptVersion,
  productEnrichmentProvider,
  productEnrichmentSchemaVersion,
} from "@/lib/product-enrichment/openai";
import { evaluateArchiveCandidates } from "@/lib/catalog/archive-policy";

type CatalogRefreshMeta = {
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastFinishedAt?: string;
  nextDueAt?: string;
  consecutiveFailedRuns?: number;
  failedBackoffUntil?: string | null;
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
  lastForceAttemptAt?: string;
  lastForceResult?: {
    at?: string;
    mode?: string;
    runId?: string | null;
    reason?: string | null;
    status?: string | null;
  } | null;
  manualReviewAutoClearedAt?: string | null;
  manualReviewAutoClearEvidence?: Record<string, unknown> | null;
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

const isRetryableCatalogFailedRef = (lastError: string | null | undefined) => {
  const normalized = (lastError ?? "").toLowerCase();
  if (!normalized) return true;

  const transientTokens = [
    "this operation was aborted",
    "timeout",
    "fetch failed",
    "econn",
    "enotfound",
    "eai_again",
    "socket hang up",
    "status=500",
    "status=502",
    "status=503",
    "status=504",
    " 429 ",
    "quota",
    "rate limit",
    "too many requests",
  ];
  if (transientTokens.some((token) => normalized.includes(token))) return true;

  const terminalTokens = [
    "manual_review_",
    "llm_pdp_false",
    "external_media_url_blocked",
    "external_media_blocked_product_create",
    "external_media_blocked_variant_create",
    "blob_required_no_blob_images",
    "manual_review_no_products",
    "manual_review_vtex_no_products",
    "no hay imágenes disponibles tras upload",
    "no hay imagenes disponibles tras upload",
    "no se pudo obtener html (404)",
    "status=404",
    "not_found",
    "no se pudo obtener producto",
  ];
  if (terminalTokens.some((token) => normalized.includes(token))) return false;

  return true;
};

const isPlatformRefCompatible = (url: string, platform: string | null | undefined) => {
  const normalizedPlatform = (platform ?? "").trim().toLowerCase();
  if (!normalizedPlatform) return true;

  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }

  if (normalizedPlatform === "shopify") {
    return pathname.includes("/products/");
  }
  if (normalizedPlatform === "woocommerce") {
    return pathname.includes("/product/") || pathname.includes("/producto/");
  }
  if (normalizedPlatform === "vtex") {
    return pathname.endsWith("/p") || pathname.includes("/p/");
  }
  return true;
};

const sanitizeRefsForPlatform = (refs: ProductRef[], platform: string | null | undefined) => {
  if (!refs.length) return refs;
  const normalizedPlatform = (platform ?? "").trim().toLowerCase();
  if (!normalizedPlatform) return refs;
  return refs.filter((ref) => isPlatformRefCompatible(ref.url, normalizedPlatform));
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
  const maxFailedItems = Math.max(0, Number(process.env.CATALOG_REFRESH_MAX_FAILED_ITEMS ?? 30));
  const maxFailedRateRaw = Number(process.env.CATALOG_REFRESH_MAX_FAILED_RATE ?? 0.10);
  const maxFailedRate = Number.isFinite(maxFailedRateRaw)
    ? Math.max(0, Math.min(1, maxFailedRateRaw))
    : 0.10;
  const failedBackoffBaseHoursRaw = Number(
    process.env.CATALOG_REFRESH_FAILED_BACKOFF_BASE_HOURS ?? 6,
  );
  const failedBackoffBaseHours = Number.isFinite(failedBackoffBaseHoursRaw)
    ? Math.max(1, failedBackoffBaseHoursRaw)
    : 6;
  const failedBackoffMaxHoursRaw = Number(
    process.env.CATALOG_REFRESH_FAILED_BACKOFF_MAX_HOURS ?? 72,
  );
  const failedBackoffMaxHours = Number.isFinite(failedBackoffMaxHoursRaw)
    ? Math.max(failedBackoffBaseHours, failedBackoffMaxHoursRaw)
    : Math.max(failedBackoffBaseHours, 72);
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
  const enrichAutoStart =
    (process.env.CATALOG_REFRESH_ENRICH_AUTO_START ?? "").trim().toLowerCase() === "true";
  const forceDiscoveryLimit = Math.max(
    10,
    Number(process.env.CATALOG_REFRESH_FORCE_DISCOVERY_LIMIT ?? 400),
  );
  const forceDiscoveryBudgetMs = Math.max(
    2000,
    Number(process.env.CATALOG_REFRESH_FORCE_DISCOVERY_BUDGET_MS ?? 10000),
  );
  const autoRemediateMaxBrands = Math.max(
    0,
    Number(process.env.CATALOG_REFRESH_AUTO_REMEDIATE_MAX_BRANDS ?? 4),
  );
  const autoRemediateCooldownHours = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_AUTO_REMEDIATE_COOLDOWN_HOURS ?? 12),
  );
  const maxActiveRunsEnvRaw = String(process.env.CATALOG_REFRESH_MAX_ACTIVE_RUNS ?? "")
    .replace(/\\n/g, "")
    .trim();
  const maxActiveRunsRaw = Number(maxActiveRunsEnvRaw || maxBrands * 3);
  const maxActiveRuns = Number.isFinite(maxActiveRunsRaw)
    ? Math.max(1, Math.floor(maxActiveRunsRaw))
    : Math.max(1, maxBrands * 3);
  const autoReconcile =
    (process.env.CATALOG_REFRESH_AUTO_RECONCILE ?? "true")
      .trim()
      .toLowerCase() !== "false";
  const autoReconcileJobScanLimit = Math.max(
    100,
    Number(process.env.CATALOG_REFRESH_AUTO_RECONCILE_JOB_SCAN_LIMIT ?? 1000),
  );
  const autoReconcileReenqueueLimit = Math.max(
    10,
    Number(process.env.CATALOG_REFRESH_AUTO_RECONCILE_REENQUEUE_LIMIT ?? 500),
  );
  const stuckRemediateEnabled =
    (process.env.CATALOG_REFRESH_STUCK_REMEDIATE_ENABLED ?? "true")
      .trim()
      .toLowerCase() === "true";
  const stuckRemediateLimit = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_STUCK_REMEDIATE_LIMIT ?? 30),
  );
  const stuckRemediateWindowMinutes = Math.max(
    5,
    Number(process.env.CATALOG_REFRESH_STUCK_REMEDIATE_WINDOW_MINUTES ?? 30),
  );
  const stuckRemediateThreshold = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_STUCK_REMEDIATE_THRESHOLD ?? stuckRemediateLimit),
  );
  const stuckPauseOverCapEnabled =
    (process.env.CATALOG_REFRESH_STUCK_PAUSE_OVER_CAP_ENABLED ?? "true")
      .trim()
      .toLowerCase() === "true";
  const stuckPauseOverCapTarget = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_STUCK_PAUSE_OVER_CAP_TARGET ?? 48),
  );
  const manualReviewAutoClearEnabled =
    (process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_ENABLED ?? "true")
      .trim()
      .toLowerCase() === "true";
  const manualReviewAutoClearMinCompletedRuns = Math.max(
    1,
    Number(process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_MIN_COMPLETED_RUNS ?? 2),
  );
  const manualReviewAutoClearWindowDays = Math.max(
    1,
    Number(process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_WINDOW_DAYS ?? 21),
  );
  const manualReviewAutoClearRelaxedEnabled =
    (process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_RELAXED_ENABLED ?? "true")
      .trim()
      .toLowerCase() === "true";
  const manualReviewAutoClearRelaxedMinCompletedRuns = Math.max(
    1,
    Number(process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_RELAXED_MIN_COMPLETED_RUNS ?? 1),
  );
  const manualReviewAutoClearRelaxedWindowDays = Math.max(
    1,
    Number(process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_RELAXED_WINDOW_DAYS ?? 45),
  );
  const manualReviewAutoClearRelaxedMaxFailedRateRaw = Number(
    process.env.CATALOG_MANUAL_REVIEW_AUTOCLEAR_RELAXED_MAX_FAILED_RATE ?? 0.10,
  );
  const manualReviewAutoClearRelaxedMaxFailedRate = Number.isFinite(
    manualReviewAutoClearRelaxedMaxFailedRateRaw,
  )
    ? Math.max(0, Math.min(1, manualReviewAutoClearRelaxedMaxFailedRateRaw))
    : 0.10;
  return {
    intervalDays,
    jitterHours,
    maxBrands,
    maxRuntimeMs,
    brandConcurrency,
    minGapHours,
    maxFailedItems,
    maxFailedRate,
    failedBackoffBaseHours,
    failedBackoffMaxHours,
    drainOnRun,
    autoRecover,
    recoverMaxRuns,
    recoverStuckMinutes,
    recoverEnrichmentStuckMinutes,
    failedLookbackDays,
    failedUrlLimit,
    enrichLookbackDays,
    enrichMaxProducts,
    enrichAutoStart,
    forceDiscoveryLimit,
    forceDiscoveryBudgetMs,
    autoRemediateMaxBrands,
    autoRemediateCooldownHours,
    maxActiveRuns,
    autoReconcile,
    autoReconcileJobScanLimit,
    autoReconcileReenqueueLimit,
    stuckRemediateEnabled,
    stuckRemediateLimit,
    stuckRemediateWindowMinutes,
    stuckRemediateThreshold,
    stuckPauseOverCapEnabled,
    stuckPauseOverCapTarget,
    manualReviewAutoClearEnabled,
    manualReviewAutoClearMinCompletedRuns,
    manualReviewAutoClearWindowDays,
    manualReviewAutoClearRelaxedEnabled,
    manualReviewAutoClearRelaxedMinCompletedRuns,
    manualReviewAutoClearRelaxedWindowDays,
    manualReviewAutoClearRelaxedMaxFailedRate,
  };
};

const computeNextDueAt = (now: Date, intervalDays: number, jitterHours: number) => {
  const baseMs = intervalDays * 24 * 60 * 60 * 1000;
  const jitterMs = jitterHours * 60 * 60 * 1000;
  const offset = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return new Date(now.getTime() + baseMs + offset).toISOString();
};

const readNonNegativeInt = (value: unknown) => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const computeFailedBackoffUntil = (
  now: Date,
  consecutiveFailedRuns: number,
  baseHours: number,
  maxHours: number,
) => {
  const failures = Math.max(1, Math.floor(consecutiveFailedRuns));
  const backoffHours = Math.min(maxHours, baseHours * 2 ** (failures - 1));
  return new Date(now.getTime() + backoffHours * 60 * 60 * 1000).toISOString();
};

export const isBrandDueForRefresh = (
  metadata: Record<string, unknown>,
  now: Date,
  config = getRefreshConfig(),
) => {
  const refresh = readRefreshMeta(metadata);
  const nextDue = parseDate(refresh.nextDueAt);
  // If nextDueAt is present, treat it as the authoritative schedule. This makes jitter effective
  // and avoids re-running brands earlier than planned.
  if (nextDue) return nextDue <= now;
  const failedBackoffUntil = parseDate(refresh.failedBackoffUntil);
  if (failedBackoffUntil) return failedBackoffUntil <= now;
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

export type CatalogRefreshForceMode =
  | "resumed_existing_run"
  | "created_from_last_run_refs"
  | "created_from_product_refs"
  | "created_from_discovery_fallback"
  | "already_active_run"
  | "no_refs";

export type CatalogRefreshForceResult = {
  brandId: string;
  runId: string | null;
  mode: CatalogRefreshForceMode;
  message: string;
  reason: string | null;
};

const toInputJsonValue = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const saveForceResult = async (
  brandId: string,
  params: { mode: CatalogRefreshForceMode; runId?: string | null; reason?: string | null },
) => {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { metadata: true },
  });
  if (!brand) return;
  const metadata = readMetadata(brand.metadata);
  const nowIso = new Date().toISOString();
  const nextMetadata = withRefreshMeta(metadata, {
    lastForceAttemptAt: nowIso,
    lastForceResult: {
      at: nowIso,
      mode: params.mode,
      runId: params.runId ?? null,
      reason: params.reason ?? null,
      status: params.mode === "no_refs" ? "skipped" : "accepted",
    },
  });
  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: toInputJsonValue(nextMetadata) },
  });
};

const saveForceAttempt = async (brandId: string) => {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { metadata: true },
  });
  if (!brand) return;
  const metadata = readMetadata(brand.metadata);
  const nextMetadata = withRefreshMeta(metadata, {
    lastForceAttemptAt: new Date().toISOString(),
  });
  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: toInputJsonValue(nextMetadata) },
  });
};

const readString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const dedupeRefs = (refs: Array<{ url: string }>) =>
  Array.from(new Map(refs.map((ref) => [ref.url, ref])).values());

const requeueRunItems = async (runId: string, queueEnabled: boolean, enqueueLimit: number) => {
  await resetQueuedItemsAll(runId);
  await resetStuckItemsAll(runId);
  const refill = await topUpCatalogRunQueue({
    runId,
    enqueueLimit: Math.max(10, enqueueLimit),
    queueEnabled,
  });
  return refill.enqueued;
};

const latestRunRefsForForce = async (brandId: string, limit: number) => {
  const rows = await prisma.$queryRaw<{ runId: string; url: string }[]>(
    Prisma.sql`
      WITH latest AS (
        SELECT cr.id
        FROM "catalog_runs" cr
        WHERE cr."brandId" = ${brandId}
        ORDER BY cr."updatedAt" DESC
        LIMIT 1
      )
      SELECT l.id AS "runId", ci.url
      FROM latest l
      INNER JOIN "catalog_items" ci ON ci."runId" = l.id
      GROUP BY l.id, ci.url
      ORDER BY ci.url ASC
      LIMIT ${limit}
    `,
  );
  const runId = rows[0]?.runId ?? null;
  const refs = rows
    .map((row) => readString(row.url))
    .filter((url): url is string => Boolean(url))
    .map((url) => ({ url }));
  return { runId, refs: dedupeRefs(refs) };
};

const productRefsForForce = async (params: {
  brandId: string;
  siteUrl: string;
  platform: string | null;
  limit: number;
}) => {
  const origin = new URL(params.siteUrl).origin;
  const rows = await prisma.product.findMany({
    where: {
      brandId: params.brandId,
      OR: [{ sourceUrl: { not: null } }, { externalId: { not: null } }],
    },
    select: { sourceUrl: true, externalId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: params.limit,
  });
  const refs = rows
    .map((row) => {
      const sourceUrl = readString(row.sourceUrl);
      if (sourceUrl) return { url: sourceUrl };
      if ((params.platform ?? "").toLowerCase() !== "woocommerce") return null;
      const externalId = readString(row.externalId);
      if (!externalId) return null;
      return { url: new URL(`/wp-json/wc/store/v1/products/${externalId}`, origin).toString() };
    })
    .filter((ref): ref is { url: string } => Boolean(ref));
  return dedupeRefs(refs);
};

const createForcedRunFromRefs = async (params: {
  brandId: string;
  platform: string | null;
  refs: Array<{ url: string }>;
  queueEnabled: boolean;
  enqueueLimit: number;
}) => {
  const refs = sanitizeRefsForPlatform(
    dedupeRefs(params.refs).filter((ref) => Boolean(readString(ref.url))),
    params.platform,
  );
  if (!refs.length) return null;
  const run = await createRunWithItems({
    brandId: params.brandId,
    platform: params.platform,
    refs,
    status: "processing",
  });
  await markRefreshStarted(params.brandId, run.id);
  await requeueRunItems(run.id, params.queueEnabled, params.enqueueLimit);
  return run.id;
};

export const startForcedRefreshForBrand = async (params: {
  brandId: string;
  force?: boolean;
  source?: "manual" | "auto_remediate";
}) => {
  const force = params.force ?? true;
  const config = getRefreshConfig();
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const queueEnabled = isCatalogQueueEnabled();
  const refsLimit = Math.max(
    config.forceDiscoveryLimit,
    Number(process.env.CATALOG_REFRESH_DISCOVERY_LIMIT ?? 5000),
  );

  const brand = await prisma.brand.findUnique({
    where: { id: params.brandId },
    select: {
      id: true,
      name: true,
      slug: true,
      siteUrl: true,
      ecommercePlatform: true,
      manualReview: true,
      isActive: true,
      metadata: true,
    },
  });
  if (!brand || !brand.siteUrl || !brand.isActive) {
    throw new Error("brand_not_found");
  }
  if (brand.manualReview && !force) {
    throw new Error("brand_manual_review");
  }

  await saveForceAttempt(brand.id);

  const existingRun = await prisma.catalogRun.findFirst({
    where: { brandId: brand.id, status: { in: ["processing", "paused", "blocked", "stopped"] } },
    orderBy: { updatedAt: "desc" },
  });

  if (existingRun) {
    const runnable = await prisma.catalogItem.findFirst({
      where: {
        runId: existingRun.id,
        status: { in: ["pending", "queued", "in_progress", "failed"] },
        attempts: { lt: CATALOG_MAX_ATTEMPTS },
      },
      select: { id: true },
    });

    if (runnable) {
      const wasProcessing = existingRun.status === "processing";
      if (!wasProcessing) {
        await prisma.catalogRun.update({
          where: { id: existingRun.id },
          data: {
            status: "processing",
            blockReason: null,
            lastError: null,
            consecutiveErrors: 0,
            updatedAt: new Date(),
          },
        });
      }
      await markRefreshStarted(brand.id, existingRun.id);
      await requeueRunItems(existingRun.id, queueEnabled, enqueueLimit);
      const mode: CatalogRefreshForceMode = wasProcessing ? "already_active_run" : "resumed_existing_run";
      await saveForceResult(brand.id, {
        mode,
        runId: existingRun.id,
        reason: wasProcessing ? "active_run" : "resumed_run",
      });
      return {
        brandId: brand.id,
        runId: existingRun.id,
        mode,
        reason: wasProcessing ? "active_run" : "resumed_run",
        message:
          mode === "already_active_run"
            ? "La marca ya tenía un run activo. Se reencolaron items pendientes."
            : "Se reanudó una corrida existente para la marca.",
      } satisfies CatalogRefreshForceResult;
    }

    if (existingRun.status === "processing") {
      await saveForceResult(brand.id, {
        mode: "already_active_run",
        runId: existingRun.id,
        reason: "active_run_no_runnable_items",
      });
      return {
        brandId: brand.id,
        runId: existingRun.id,
        mode: "already_active_run",
        reason: "active_run_no_runnable_items",
        message: "La marca ya tenía un run activo sin items pendientes reintentables.",
      } satisfies CatalogRefreshForceResult;
    }
  }

  const latestRunRefs = await latestRunRefsForForce(brand.id, refsLimit);
  if (latestRunRefs.refs.length) {
    const runId = await createForcedRunFromRefs({
      brandId: brand.id,
      platform: brand.ecommercePlatform,
      refs: latestRunRefs.refs,
      queueEnabled,
      enqueueLimit,
    });
    if (runId) {
      await saveForceResult(brand.id, {
        mode: "created_from_last_run_refs",
        runId,
        reason: latestRunRefs.runId ? `latest_run:${latestRunRefs.runId}` : "latest_run_refs",
      });
      return {
        brandId: brand.id,
        runId,
        mode: "created_from_last_run_refs",
        reason: latestRunRefs.runId ? `latest_run:${latestRunRefs.runId}` : "latest_run_refs",
        message: "Se creó una corrida nueva usando URLs del último run.",
      } satisfies CatalogRefreshForceResult;
    }
  }

  const productRefs = await productRefsForForce({
    brandId: brand.id,
    siteUrl: brand.siteUrl,
    platform: brand.ecommercePlatform,
    limit: refsLimit,
  });
  if (productRefs.length) {
    const runId = await createForcedRunFromRefs({
      brandId: brand.id,
      platform: brand.ecommercePlatform,
      refs: productRefs,
      queueEnabled,
      enqueueLimit,
    });
    if (runId) {
      await saveForceResult(brand.id, {
        mode: "created_from_product_refs",
        runId,
        reason: "product_source_urls",
      });
      return {
        brandId: brand.id,
        runId,
        mode: "created_from_product_refs",
        reason: "product_source_urls",
        message: "Se creó una corrida nueva usando source URLs de productos existentes.",
      } satisfies CatalogRefreshForceResult;
    }
  }

  const discovery = await discoverCatalogRefs({
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
    },
    limit: config.forceDiscoveryLimit,
    forceSitemap: false,
    combineSitemapAndAdapter: true,
    sitemapBudgetMs: config.forceDiscoveryBudgetMs,
  });

  if (discovery.refs.length) {
    const runId = await createForcedRunFromRefs({
      brandId: brand.id,
      platform: discovery.platformForRun ?? brand.ecommercePlatform,
      refs: discovery.refs.map((ref) => ({ url: ref.url })),
      queueEnabled,
      enqueueLimit,
    });
    if (runId) {
      await saveForceResult(brand.id, {
        mode: "created_from_discovery_fallback",
        runId,
        reason: "discovery_fallback",
      });
      return {
        brandId: brand.id,
        runId,
        mode: "created_from_discovery_fallback",
        reason: "discovery_fallback",
        message: "Se creó una corrida nueva desde discovery acotado.",
      } satisfies CatalogRefreshForceResult;
    }
  }

  await saveForceResult(brand.id, {
    mode: "no_refs",
    reason: "no_refs",
  });
  return {
    brandId: brand.id,
    runId: null,
    mode: "no_refs",
    reason: "no_refs",
    message: "No se encontraron referencias para iniciar el refresh.",
  } satisfies CatalogRefreshForceResult;
};

const hasBlockingManualReason = (metadata: Record<string, unknown>) => {
  const blockedReasons = new Set([
    "manual_review_no_products",
    "manual_review_vtex_no_products",
    "unreachable",
    "parked_domain",
  ]);

  const reviewReason =
    readMetadata(metadata.catalog_extract_review).reason ??
    readMetadata(metadata.catalog_extract_finished).reason;
  if (typeof reviewReason === "string" && blockedReasons.has(reviewReason)) {
    return reviewReason;
  }

  const techRisks = readMetadata(metadata.tech_profile).risks;
  if (Array.isArray(techRisks)) {
    for (const risk of techRisks) {
      if (typeof risk === "string" && blockedReasons.has(risk)) {
        return risk;
      }
    }
  }

  return null;
};

export const autoClearManualReviewByEvidence = async (options?: {
  apply?: boolean;
  limit?: number;
  now?: Date;
}) => {
  const config = getRefreshConfig();
  const apply = options?.apply ?? true;
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const strictWindowStart = new Date(
    now.getTime() - config.manualReviewAutoClearWindowDays * 24 * 60 * 60 * 1000,
  );
  const relaxedWindowStart = new Date(
    now.getTime() - config.manualReviewAutoClearRelaxedWindowDays * 24 * 60 * 60 * 1000,
  );
  const runQueryWindowStart =
    config.manualReviewAutoClearRelaxedEnabled &&
    relaxedWindowStart.getTime() < strictWindowStart.getTime()
      ? relaxedWindowStart
      : strictWindowStart;

  const report = {
    enabled: config.manualReviewAutoClearEnabled,
    relaxedEnabled: config.manualReviewAutoClearRelaxedEnabled,
    evaluatedBrands: 0,
    eligibleBrands: 0,
    strictEligibleBrands: 0,
    relaxedEligibleBrands: 0,
    autoClearedBrands: 0,
    autoClearedStrict: 0,
    autoClearedRelaxed: 0,
    skippedBlockedReason: 0,
    skippedInsufficientRuns: 0,
    minCompletedRuns: config.manualReviewAutoClearMinCompletedRuns,
    windowDays: config.manualReviewAutoClearWindowDays,
    relaxedMinCompletedRuns: config.manualReviewAutoClearRelaxedMinCompletedRuns,
    relaxedWindowDays: config.manualReviewAutoClearRelaxedWindowDays,
    relaxedMaxFailedRate: config.manualReviewAutoClearRelaxedMaxFailedRate,
    candidates: [] as Array<{
      brandId: string;
      brandName: string;
      eligibleRuns: number;
      strictEligibleRuns: number;
      relaxedEligibleRuns: number;
      mode: "strict" | "relaxed" | null;
      blockedReason: string | null;
      applied: boolean;
    }>,
  };

  if (!config.manualReviewAutoClearEnabled) return report;

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      siteUrl: { not: null },
      manualReview: true,
    },
    select: { id: true, name: true, metadata: true },
    orderBy: { name: "asc" },
    ...(options?.limit ? { take: options.limit } : {}),
  });

  if (!brands.length) return report;
  report.evaluatedBrands = brands.length;

  const brandIds = brands.map((brand) => brand.id);
  const runStats = await prisma.$queryRaw<
    Array<{
      brandId: string;
      runId: string;
      updatedAt: Date;
      totalItems: number;
      failedItems: number;
      pendingItems: number;
    }>
  >(
    Prisma.sql`
      SELECT
        cr."brandId" AS "brandId",
        cr.id AS "runId",
        cr."updatedAt" AS "updatedAt",
        COALESCE(NULLIF(cr."totalItems", 0), COUNT(ci.*))::int AS "totalItems",
        COUNT(*) FILTER (WHERE ci.status = 'failed')::int AS "failedItems",
        COUNT(*) FILTER (WHERE ci.status IN ('pending', 'queued', 'in_progress'))::int AS "pendingItems"
      FROM "catalog_runs" cr
      LEFT JOIN "catalog_items" ci ON ci."runId" = cr.id
      WHERE cr.status = 'completed'
        AND cr."updatedAt" >= ${runQueryWindowStart}
        AND cr."brandId" IN (${Prisma.join(brandIds)})
      GROUP BY cr.id
      ORDER BY cr."updatedAt" DESC
    `,
  );

  const statsByBrand = new Map<string, typeof runStats>();
  runStats.forEach((row) => {
    const list = statsByBrand.get(row.brandId) ?? [];
    list.push(row);
    statsByBrand.set(row.brandId, list);
  });

  for (const brand of brands) {
    const metadata = readMetadata(brand.metadata);
    const blockedReason = hasBlockingManualReason(metadata);
    if (blockedReason) {
      report.skippedBlockedReason += 1;
      report.candidates.push({
        brandId: brand.id,
        brandName: brand.name,
        eligibleRuns: 0,
        strictEligibleRuns: 0,
        relaxedEligibleRuns: 0,
        mode: null,
        blockedReason,
        applied: false,
      });
      continue;
    }

    const rows = statsByBrand.get(brand.id) ?? [];
    const strictEligibleRuns = rows.filter((row) => {
      if (row.updatedAt < strictWindowStart) return false;
      if (row.pendingItems > 0) return false;
      if (row.failedItems > 5) return false;
      const totalItems = row.totalItems > 0 ? row.totalItems : 0;
      const failedRate = totalItems > 0 ? row.failedItems / totalItems : 0;
      return failedRate <= 0.05;
    });
    const relaxedEligibleRuns =
      config.manualReviewAutoClearRelaxedEnabled
        ? rows.filter((row) => {
            if (row.updatedAt < relaxedWindowStart) return false;
            if (row.pendingItems > 0) return false;
            const totalItems = row.totalItems > 0 ? row.totalItems : 0;
            const failedRate = totalItems > 0 ? row.failedItems / totalItems : 0;
            return failedRate <= config.manualReviewAutoClearRelaxedMaxFailedRate;
          })
        : [];

    const strictEligible =
      strictEligibleRuns.length >= config.manualReviewAutoClearMinCompletedRuns;
    const relaxedEligible =
      !strictEligible &&
      config.manualReviewAutoClearRelaxedEnabled &&
      relaxedEligibleRuns.length >= config.manualReviewAutoClearRelaxedMinCompletedRuns;
    const selectedMode: "strict" | "relaxed" | null = strictEligible
      ? "strict"
      : relaxedEligible
        ? "relaxed"
        : null;
    const selectedRuns =
      selectedMode === "strict"
        ? strictEligibleRuns
        : selectedMode === "relaxed"
          ? relaxedEligibleRuns
          : [];

    if (!selectedMode) {
      report.skippedInsufficientRuns += 1;
      report.candidates.push({
        brandId: brand.id,
        brandName: brand.name,
        eligibleRuns: 0,
        strictEligibleRuns: strictEligibleRuns.length,
        relaxedEligibleRuns: relaxedEligibleRuns.length,
        mode: null,
        blockedReason: null,
        applied: false,
      });
      continue;
    }

    report.eligibleBrands += 1;
    if (selectedMode === "strict") report.strictEligibleBrands += 1;
    if (selectedMode === "relaxed") report.relaxedEligibleBrands += 1;
    const evidence = {
      source: "catalog_refresh",
      autoClearedAt: nowIso,
      mode: selectedMode,
      eligibleRuns: selectedRuns.length,
      minCompletedRuns:
        selectedMode === "strict"
          ? config.manualReviewAutoClearMinCompletedRuns
          : config.manualReviewAutoClearRelaxedMinCompletedRuns,
      windowDays:
        selectedMode === "strict"
          ? config.manualReviewAutoClearWindowDays
          : config.manualReviewAutoClearRelaxedWindowDays,
      maxFailedRate:
        selectedMode === "strict" ? 0.05 : config.manualReviewAutoClearRelaxedMaxFailedRate,
      runIds: selectedRuns
        .slice(0, 10)
        .map((row) => row.runId),
    };

    if (apply) {
      const nextMetadata = withRefreshMeta(metadata, {
        manualReviewAutoClearedAt: nowIso,
        manualReviewAutoClearEvidence: evidence,
      });
      await prisma.brand.update({
        where: { id: brand.id },
        data: {
          manualReview: false,
          metadata: toInputJsonValue(nextMetadata),
        },
      });
      report.autoClearedBrands += 1;
      if (selectedMode === "strict") report.autoClearedStrict += 1;
      if (selectedMode === "relaxed") report.autoClearedRelaxed += 1;
    }

    report.candidates.push({
      brandId: brand.id,
      brandName: brand.name,
      eligibleRuns: selectedRuns.length,
      strictEligibleRuns: strictEligibleRuns.length,
      relaxedEligibleRuns: relaxedEligibleRuns.length,
      mode: selectedMode,
      blockedReason: null,
      applied: apply,
    });
  }

  return report;
};

const autoRemediateOperationalStaleBrands = async (params: {
  brands: Array<{
    id: string;
    name: string;
    siteUrl: string | null;
    manualReview: boolean;
    metadata: unknown;
  }>;
  now: Date;
  config: ReturnType<typeof getRefreshConfig>;
}) => {
  const { brands, now, config } = params;
  if (config.autoRemediateMaxBrands <= 0) return [];

  const staleWindowStart = new Date(now.getTime() - config.intervalDays * 24 * 60 * 60 * 1000);
  const cooldownMs = config.autoRemediateCooldownHours * 60 * 60 * 1000;
  const candidates = brands
    .filter((brand) => !brand.manualReview && Boolean(brand.siteUrl))
    .map((brand) => {
      const metadata = readMetadata(brand.metadata);
      const refresh = readRefreshMeta(metadata);
      const lastOperationalAt = parseDate(refresh.lastFinishedAt) ?? parseDate(refresh.lastCompletedAt);
      const lastForceAttemptAt = parseDate(refresh.lastForceAttemptAt);
      return {
        brandId: brand.id,
        lastOperationalAt,
        lastForceAttemptAt,
      };
    })
    .filter((brand) => !brand.lastOperationalAt || brand.lastOperationalAt < staleWindowStart)
    .filter(
      (brand) =>
        !brand.lastForceAttemptAt || now.getTime() - brand.lastForceAttemptAt.getTime() >= cooldownMs,
    )
    .sort((a, b) => {
      if (!a.lastOperationalAt && !b.lastOperationalAt) return a.brandId.localeCompare(b.brandId);
      if (!a.lastOperationalAt) return -1;
      if (!b.lastOperationalAt) return 1;
      return a.lastOperationalAt.getTime() - b.lastOperationalAt.getTime();
    })
    .slice(0, config.autoRemediateMaxBrands);

  const results: CatalogRefreshForceResult[] = [];
  for (const candidate of candidates) {
    try {
      const result = await startForcedRefreshForBrand({
        brandId: candidate.brandId,
        force: true,
        source: "auto_remediate",
      });
      results.push(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await saveForceResult(candidate.brandId, {
        mode: "already_active_run",
        reason: `auto_remediate_error:${reason.slice(0, 120)}`,
      });
      results.push({
        brandId: candidate.brandId,
        runId: null,
        mode: "already_active_run",
        reason,
        message: `Auto-remediación fallida: ${reason}`,
      });
    }
  }
  return results;
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
  const refresh = readRefreshMeta(metadata);
  const now = new Date();
  const nowIso = now.toISOString();
  const previousFailedRuns = readNonNegativeInt(refresh.consecutiveFailedRuns);
  const statusPatch: CatalogRefreshMeta =
    params.status === "completed"
      ? {
          nextDueAt: computeNextDueAt(now, config.intervalDays, config.jitterHours),
          consecutiveFailedRuns: 0,
          failedBackoffUntil: null,
        }
      : params.status === "failed"
        ? (() => {
            const consecutiveFailedRuns = previousFailedRuns + 1;
            const failedBackoffUntil = computeFailedBackoffUntil(
              now,
              consecutiveFailedRuns,
              config.failedBackoffBaseHours,
              config.failedBackoffMaxHours,
            );
            return {
              nextDueAt: failedBackoffUntil,
              consecutiveFailedRuns,
              failedBackoffUntil,
            } as CatalogRefreshMeta;
          })()
        : {};
  const nextMetadata = withRefreshMeta(metadata, {
    lastCompletedAt: params.status === "completed" ? nowIso : undefined,
    lastFinishedAt: nowIso,
    ...statusPatch,
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
  if (config.recoverMaxRuns <= 0) return;

  const queueEnabled = isCatalogQueueEnabled();
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
    try {
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
      await resetQueuedItemsAll(run.id);
      await resetStuckItemsAll(run.id);
      await topUpCatalogRunQueue({
        runId: run.id,
        enqueueLimit,
        queueEnabled,
      });
    } catch (error) {
      console.warn("catalog.refresh.auto_recover_failed", run.id, error);
    }
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

const resumeCatalogRefreshEnrichmentRuns = async () => {
  const runs = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id
      FROM "product_enrichment_runs"
      WHERE status = 'paused'
        AND COALESCE(metadata->>'created_by', '') = 'catalog_refresh'
        AND COALESCE(metadata->>'auto_start', 'false') = 'false'
      LIMIT 500
    `,
  );

  if (!runs.length) return { resumed: 0 };
  const ids = runs.map((run) => run.id);
  const now = new Date();

  await prisma.productEnrichmentItem.updateMany({
    where: { runId: { in: ids }, status: { in: ["queued", "in_progress"] } },
    data: { status: "pending", startedAt: null, updatedAt: now },
  });
  await prisma.productEnrichmentRun.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "processing",
      blockReason: null,
      updatedAt: now,
    },
  });

  return { resumed: ids.length };
};

const recoverEnrichmentRuns = async (config: ReturnType<typeof getRefreshConfig>) => {
  if (!config.autoRecover) return;
  if (config.recoverMaxRuns <= 0) return;

  const queueEnabled = isEnrichmentQueueEnabled();
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
    try {
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
      await resetEnrichmentQueuedItemsAll(run.id);
      await resetEnrichmentStuckItemsAll(run.id);
      const pending = await listPendingEnrichmentItems(run.id, enqueueLimit);
      if (queueEnabled) {
        await markEnrichmentItemsQueued(pending.map((item) => item.id));
        await enqueueEnrichmentItems(pending);
      }
    } catch (error) {
      console.warn("catalog.refresh.enrichment_auto_recover_failed", run.id, error);
    }
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
  const autoStart = config.enrichAutoStart;
  const queueEnabled = isEnrichmentQueueEnabled();
  const enqueueLimit = Math.max(
    1,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const existing = await findActiveEnrichmentRun({ scope: "brand", brandId });

  const rows = await getProductsMissingEnrichment(
    brandId,
    startedAt,
    config.enrichMaxProducts,
  );
  const ids = rows.map((row) => row.id);
  if (!ids.length) return { queued: 0, skipped: "no_new_products" };

  const readJsonRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  };

  const isCatalogRefreshRun = (run: { metadata: unknown }) => {
    const meta = readJsonRecord(run.metadata);
    return (meta.created_by ?? null) === "catalog_refresh";
  };

  // If there's already a run executing, append new products to it.
  // If there's a paused/stopped/blocked run created by catalog_refresh, reuse it so the
  // pipeline remains single-run and can auto-start when enabled.
  if (existing) {
    const reuseExisting = existing.status === "processing" || isCatalogRefreshRun(existing);
    if (reuseExisting) {
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

      // Only auto-resume catalog_refresh runs. Manual runs stay manual unless already processing.
      if (autoStart && existing.status !== "processing" && isCatalogRefreshRun(existing)) {
        await prisma.productEnrichmentRun.update({
          where: { id: existing.id },
          data: {
            status: "processing",
            blockReason: null,
            updatedAt: new Date(),
          },
        });
      }

      if (autoStart && queueEnabled) {
        const pending = await listPendingEnrichmentItems(existing.id, Math.max(10, enqueueLimit));
        if (pending.length) {
          await markEnrichmentItemsQueued(pending.map((item) => item.id));
          await enqueueEnrichmentItems(pending);
        }
      }

      return { queued: inserted.count, runId: existing.id, appended: true };
    }
  }

  const runStatus = autoStart ? ("processing" as const) : ("paused" as const);
  const run = await createEnrichmentRun({
    scope: "brand",
    brandId,
    productIds: ids,
    status: runStatus,
    metadata: {
      mode: "new_products",
      auto_start: autoStart,
      created_by: "catalog_refresh",
      created_at: new Date().toISOString(),
      provider: productEnrichmentProvider,
      model: productEnrichmentModel,
      prompt_version: productEnrichmentPromptVersion,
      schema_version: productEnrichmentSchemaVersion,
    },
  });

  if (autoStart && queueEnabled) {
    const pending = await listPendingEnrichmentItems(run.id, Math.max(10, enqueueLimit));
    if (pending.length) {
      await markEnrichmentItemsQueued(pending.map((item) => item.id));
      await enqueueEnrichmentItems(pending);
    }
  }

  return { queued: ids.length, runId: run.id, status: runStatus };
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
  const finalizedAt = new Date();
  await prisma.catalogRun.update({
    where: { id: params.runId },
    data: {
      status,
      finishedAt: finalizedAt,
      lastError: enrichmentError ?? lastError ?? null,
      updatedAt: finalizedAt,
    },
  });
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

type AutoFinalizeDormantRunsResult = {
  examined: number;
  finalized: number;
  completed: number;
  failed: number;
  errors: number;
  runIds: string[];
};

const autoFinalizeDormantProcessingRuns = async (): Promise<AutoFinalizeDormantRunsResult> => {
  const limit = Math.max(0, Number(process.env.CATALOG_REFRESH_AUTO_FINALIZE_LIMIT ?? 20));
  if (limit <= 0) {
    return {
      examined: 0,
      finalized: 0,
      completed: 0,
      failed: 0,
      errors: 0,
      runIds: [],
    };
  }

  const minAgeMinutes = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_AUTO_FINALIZE_MIN_AGE_MINUTES ?? 10),
  );
  const includePausedBlocked =
    (process.env.CATALOG_REFRESH_AUTO_FINALIZE_INCLUDE_PAUSED_BLOCKED ?? "true")
      .trim()
      .toLowerCase() !== "false";
  const statuses = includePausedBlocked
    ? (["processing", "paused", "blocked"] as const)
    : (["processing"] as const);
  const staleCutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);

  const dormantRuns = await prisma.$queryRaw<
    Array<{
      runId: string;
      brandId: string;
      startedAt: Date;
      lastError: string | null;
    }>
  >(
    Prisma.sql`
      SELECT
        cr.id AS "runId",
        cr."brandId" AS "brandId",
        cr."startedAt" AS "startedAt",
        cr."lastError" AS "lastError"
      FROM "catalog_runs" cr
      WHERE cr.status IN (${Prisma.join(statuses)})
        AND cr."updatedAt" < ${staleCutoff}
        AND NOT (
          cr.status IN ('paused', 'blocked')
          AND COALESCE(cr."blockReason", '') LIKE 'manual_review%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "catalog_items" ci
          WHERE ci."runId" = cr.id
            AND (
              ci.status IN ('pending', 'queued', 'in_progress')
              OR (ci.status = 'failed' AND ci.attempts < ${CATALOG_MAX_ATTEMPTS})
            )
        )
      ORDER BY cr."updatedAt" ASC
      LIMIT ${limit}
    `,
  );

  if (!dormantRuns.length) {
    return {
      examined: 0,
      finalized: 0,
      completed: 0,
      failed: 0,
      errors: 0,
      runIds: [],
    };
  }

  let finalized = 0;
  let completed = 0;
  let failed = 0;
  let errors = 0;
  const runIds: string[] = [];

  for (const run of dormantRuns) {
    try {
      await finalizeRefreshForRun({
        brandId: run.brandId,
        runId: run.runId,
        startedAt: run.startedAt,
        lastError: run.lastError,
      });
      const nextRun = await prisma.catalogRun.findUnique({
        where: { id: run.runId },
        select: { status: true },
      });
      finalized += 1;
      runIds.push(run.runId);
      if (nextRun?.status === "failed") failed += 1;
      else completed += 1;
    } catch (error) {
      errors += 1;
      console.warn("catalog.refresh.auto_finalize_failed", run.runId, error);
    }
  }

  return {
    examined: dormantRuns.length,
    finalized,
    completed,
    failed,
    errors,
    runIds,
  };
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

type CatalogRefreshAutoReconcileSummary = {
  enabled: boolean;
  attempted: boolean;
  driftDetected: boolean;
  applied: boolean;
  skipped: string | null;
  result: Awaited<ReturnType<typeof reconcileCatalogQueue>> | null;
};

export type CatalogRefreshStuckRemediationStrategy = "balanced";

export type CatalogRefreshStuckRemediationResult = {
  attempted: boolean;
  dryRun: boolean;
  strategy: CatalogRefreshStuckRemediationStrategy;
  limit: number;
  minNoProgressMinutes: number;
  pauseOverCapTarget: number | null;
  processingRuns: number;
  processingRunsWithoutRecentProgress: number;
  processingActiveRunCount?: number;
  activeRunCount: number;
  activeRunCap: number;
  resumed: number;
  paused: number;
  requeued: number;
  reconciled: boolean;
  reconcileResult: Awaited<ReturnType<typeof reconcileCatalogQueue>> | null;
  postReconciled?: boolean;
  postReconcileResult?: Awaited<ReturnType<typeof reconcileCatalogQueue>> | null;
  errors: number;
  runIds: string[];
  sampleRunIds: string[];
};

type RunCatalogRefreshStuckRemediationOptions = {
  dryRun?: boolean;
  strategy?: CatalogRefreshStuckRemediationStrategy;
  limit?: number;
  minNoProgressMinutes?: number;
  pauseOverCapTarget?: number | null;
  pauseOverCapEnabled?: boolean;
  queueEnabled?: boolean;
};

type ProcessingRunProgress = {
  runId: string;
  brandId: string;
  status: string;
  blockReason: string | null;
  updatedAt: Date;
  totalItems: number;
  completed: number;
  completedRecent: number;
  failed: number;
  pending: number;
};

const readProcessingRunProgress = async (
  progressCutoff: Date,
  statuses: Array<"processing" | "paused" | "blocked"> = ["processing"],
) => {
  return prisma.$queryRaw<ProcessingRunProgress[]>(
    Prisma.sql`
      WITH processing_runs AS (
        SELECT
          cr.id AS "runId",
          cr."brandId" AS "brandId",
          cr.status,
          cr."blockReason" AS "blockReason",
          cr."updatedAt" AS "updatedAt",
          cr."totalItems"::int AS "totalItems"
        FROM "catalog_runs" cr
        WHERE cr.status IN (${Prisma.join(statuses)})
      ),
      counts AS (
        SELECT
          ci."runId" AS "runId",
          COUNT(*) FILTER (WHERE ci.status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE ci.status = 'completed' AND ci."completedAt" >= ${progressCutoff})::int AS "completedRecent",
          COUNT(*) FILTER (WHERE ci.status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE ci.status IN ('pending', 'queued', 'in_progress'))::int AS pending
        FROM "catalog_items" ci
        WHERE ci."runId" IN (SELECT "runId" FROM processing_runs)
        GROUP BY ci."runId"
      )
      SELECT
        pr."runId" AS "runId",
        pr."brandId" AS "brandId",
        pr.status,
        pr."blockReason" AS "blockReason",
        pr."updatedAt" AS "updatedAt",
        COALESCE(pr."totalItems", 0)::int AS "totalItems",
        COALESCE(c.completed, 0)::int AS completed,
        COALESCE(c."completedRecent", 0)::int AS "completedRecent",
        COALESCE(c.failed, 0)::int AS failed,
        COALESCE(c.pending, 0)::int AS pending
      FROM processing_runs pr
      LEFT JOIN counts c ON c."runId" = pr."runId"
      ORDER BY pr."updatedAt" ASC
    `,
  );
};

const rankBalancedResumeCandidates = (runs: ProcessingRunProgress[]) => {
  const resumePriority = (status: string) => {
    if (status === "paused") return 3;
    if (status === "blocked") return 2;
    if (status === "processing") return 1;
    return 0;
  };
  return [...runs].sort((a, b) => {
    const aPriority = resumePriority(a.status);
    const bPriority = resumePriority(b.status);
    if (aPriority !== bPriority) return bPriority - aPriority;
    if (a.pending !== b.pending) return b.pending - a.pending;
    if (a.completed !== b.completed) return b.completed - a.completed;
    if (a.failed !== b.failed) return a.failed - b.failed;
    return a.updatedAt.getTime() - b.updatedAt.getTime();
  });
};

const rankBalancedPauseCandidates = (runs: ProcessingRunProgress[]) => {
  return [...runs].sort((a, b) => {
    const aHardStuck = a.pending <= 0 ? 1 : 0;
    const bHardStuck = b.pending <= 0 ? 1 : 0;
    if (aHardStuck !== bHardStuck) return bHardStuck - aHardStuck;
    if (a.completed !== b.completed) return a.completed - b.completed;
    if (a.failed !== b.failed) return b.failed - a.failed;
    return a.updatedAt.getTime() - b.updatedAt.getTime();
  });
};

export const runCatalogRefreshStuckRemediation = async (
  options: RunCatalogRefreshStuckRemediationOptions = {},
): Promise<CatalogRefreshStuckRemediationResult> => {
  const config = getRefreshConfig();
  const dryRun = options.dryRun ?? false;
  const strategy: CatalogRefreshStuckRemediationStrategy = options.strategy ?? "balanced";
  const limit = Math.max(1, Math.floor(options.limit ?? config.stuckRemediateLimit));
  const minNoProgressMinutes = Math.max(
    5,
    Math.floor(options.minNoProgressMinutes ?? config.stuckRemediateWindowMinutes),
  );
  const queueEnabled = options.queueEnabled ?? isCatalogQueueEnabled();
  const pauseOverCapEnabled = options.pauseOverCapEnabled ?? config.stuckPauseOverCapEnabled;
  const pauseOverCapTargetRaw = options.pauseOverCapTarget ?? config.stuckPauseOverCapTarget;
  const pauseOverCapTarget = pauseOverCapEnabled
    ? Math.max(1, Math.floor(pauseOverCapTargetRaw ?? config.stuckPauseOverCapTarget))
    : null;
  const progressCutoff = new Date(Date.now() - minNoProgressMinutes * 60 * 1000);

  const activeStatuses: Array<"processing" | "paused" | "blocked"> = [
    "processing",
    "paused",
    "blocked",
  ];
  const [processingRuns, activeRunCount, processingRunCount] = await Promise.all([
    readProcessingRunProgress(progressCutoff, activeStatuses),
    prisma.catalogRun.count({
      where: { status: { in: activeStatuses } },
    }),
    prisma.catalogRun.count({
      where: { status: "processing" },
    }),
  ]);

  const staleRuns = processingRuns.filter((run) => run.completedRecent <= 0);
  const staleProcessingRuns = staleRuns.filter((run) => run.status === "processing");
  const canResumeRun = (run: ProcessingRunProgress) => {
    if (run.pending <= 0) return false;
    if (run.status !== "blocked") return true;
    const reason = (run.blockReason ?? "").trim().toLowerCase();
    return !reason.startsWith("manual_review");
  };
  const runIds: string[] = [];
  let resumed = 0;
  let paused = 0;
  let requeued = 0;
  let errors = 0;
  let reconciled = false;
  let reconcileResult: Awaited<ReturnType<typeof reconcileCatalogQueue>> | null = null;
  let postReconciled = false;
  let postReconcileResult: Awaited<ReturnType<typeof reconcileCatalogQueue>> | null = null;

  if (queueEnabled) {
    const drift = await readCatalogQueueDriftSummary({
      sampleLimit: config.autoReconcileJobScanLimit,
    });
    if (drift.driftDetected) {
      reconcileResult = await reconcileCatalogQueue({
        dryRun,
        jobScanLimit: config.autoReconcileJobScanLimit,
        reenqueueLimit: config.autoReconcileReenqueueLimit,
      });
      reconciled = true;
    }
  }

  const resumeCapacityByProcessing =
    pauseOverCapTarget !== null ? Math.max(0, pauseOverCapTarget - processingRunCount) : limit;
  const resumeLimit = Math.max(0, Math.min(limit, resumeCapacityByProcessing));
  const resumeCandidates = rankBalancedResumeCandidates(staleRuns.filter(canResumeRun)).slice(
    0,
    resumeLimit,
  );
  const resumeIds = new Set(resumeCandidates.map((run) => run.runId));

  if (dryRun) {
    resumed += resumeCandidates.length;
    requeued += resumeCandidates.reduce((acc, run) => acc + Math.max(1, run.pending), 0);
    runIds.push(...resumeCandidates.map((run) => run.runId));
  } else {
    const enqueueLimit = Math.max(10, Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50));
    for (const run of resumeCandidates) {
      try {
        await prisma.catalogRun.update({
          where: { id: run.runId },
          data: {
            status: "processing",
            blockReason: null,
            lastError: null,
            consecutiveErrors: 0,
            updatedAt: new Date(),
          },
        });
        await resetQueuedItemsAll(run.runId);
        await resetStuckItemsAll(run.runId);
        const refill = await topUpCatalogRunQueue({
          runId: run.runId,
          enqueueLimit,
          queueEnabled,
        });
        resumed += 1;
        requeued += refill.enqueued;
        runIds.push(run.runId);
      } catch (error) {
        errors += 1;
        console.warn("catalog.refresh.stuck_remediation.resume_failed", run.runId, error);
      }
    }
  }

  const shouldRunPostReconcile =
    queueEnabled && !dryRun && (resumed > 0 || paused > 0 || requeued > 0);
  if (shouldRunPostReconcile) {
    try {
      const driftAfterActions = await readCatalogQueueDriftSummary({
        sampleLimit: config.autoReconcileJobScanLimit,
      });
      const postDriftDetected =
        driftAfterActions.waitingItemNotQueued > 0 ||
        driftAfterActions.waitingRunNotProcessing > 0 ||
        driftAfterActions.waitingMissingItem > 0 ||
        driftAfterActions.activeZombieCriticalCount > 0 ||
        driftAfterActions.runsRunnableWithoutQueueLoad > 0;
      if (postDriftDetected) {
        postReconcileResult = await reconcileCatalogQueue({
          dryRun: false,
          jobScanLimit: config.autoReconcileJobScanLimit,
          reenqueueLimit: config.autoReconcileReenqueueLimit,
        });
        postReconciled = true;
      }
    } catch (error) {
      errors += 1;
      console.warn("catalog.refresh.stuck_remediation.post_reconcile_failed", error);
    }
  }

  const overCapBy =
    pauseOverCapTarget !== null && processingRunCount > pauseOverCapTarget
      ? processingRunCount - pauseOverCapTarget
      : 0;
  const pauseCandidates = overCapBy
    ? rankBalancedPauseCandidates(
        staleProcessingRuns.filter((run) => !resumeIds.has(run.runId)),
      ).slice(
        0,
        Math.min(limit, overCapBy),
      )
    : [];

  if (dryRun) {
    paused += pauseCandidates.length;
    runIds.push(...pauseCandidates.map((run) => run.runId));
  } else {
    for (const run of pauseCandidates) {
      try {
        await prisma.$transaction([
          prisma.catalogItem.updateMany({
            where: {
              runId: run.runId,
              status: { in: ["queued", "in_progress"] },
            },
            data: { status: "pending", startedAt: null, updatedAt: new Date() },
          }),
          prisma.catalogRun.update({
            where: { id: run.runId },
            data: {
              status: "paused",
              blockReason: "stuck_over_cap",
              lastError: "stuck_remediation_paused_over_cap",
              updatedAt: new Date(),
            },
          }),
        ]);
        paused += 1;
        runIds.push(run.runId);
      } catch (error) {
        errors += 1;
        console.warn("catalog.refresh.stuck_remediation.pause_failed", run.runId, error);
      }
    }
  }

  const uniqueRunIds = Array.from(new Set(runIds));
  return {
    attempted: resumeCandidates.length > 0 || pauseCandidates.length > 0 || reconciled,
    dryRun,
    strategy,
    limit,
    minNoProgressMinutes,
    pauseOverCapTarget,
    processingRuns: processingRuns.length,
    processingRunsWithoutRecentProgress: staleRuns.length,
    processingActiveRunCount: processingRunCount,
    activeRunCount,
    activeRunCap: config.maxActiveRuns,
    resumed,
    paused,
    requeued,
    reconciled: reconciled || postReconciled,
    reconcileResult,
    postReconciled,
    postReconcileResult,
    errors,
    runIds: uniqueRunIds,
    sampleRunIds: uniqueRunIds.slice(0, 20),
  };
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
  let manualReviewAutoClear: Awaited<ReturnType<typeof autoClearManualReviewByEvidence>> | null = null;
  let autoRemediation: CatalogRefreshForceResult[] = [];
  let archiveAutomation: Awaited<ReturnType<typeof evaluateArchiveCandidates>> | null = null;
  let autoFinalizedRuns: AutoFinalizeDormantRunsResult | null = null;
  let stuckRemediation: CatalogRefreshStuckRemediationResult & { skipped: string | null };
  const autoReconcile: CatalogRefreshAutoReconcileSummary = {
    enabled: config.autoReconcile,
    attempted: false,
    driftDetected: false,
    applied: false,
    skipped: null,
    result: null,
  };

  const queueEnabled = isCatalogQueueEnabled();

  await recoverCatalogRuns(config);
  if (!config.enrichAutoStart) {
    await pauseCatalogRefreshAutoStartDisabledRuns();
  } else {
    await resumeCatalogRefreshEnrichmentRuns();
  }
  await recoverEnrichmentRuns(config);
  await reconcileStaleRefreshStates();

  if (!options?.brandId) {
    if (!queueEnabled) {
      autoReconcile.skipped = "queue_disabled";
    } else if (!config.autoReconcile) {
      autoReconcile.skipped = "auto_reconcile_disabled";
    } else {
      autoReconcile.attempted = true;
      try {
        const drift = await readCatalogQueueDriftSummary({
          sampleLimit: config.autoReconcileJobScanLimit,
        });
        autoReconcile.driftDetected = drift.driftDetected;
        if (!drift.driftDetected) {
          autoReconcile.skipped = "drift_not_detected";
        } else {
          autoReconcile.result = await reconcileCatalogQueue({
            dryRun: false,
            jobScanLimit: config.autoReconcileJobScanLimit,
            reenqueueLimit: config.autoReconcileReenqueueLimit,
          });
          autoReconcile.applied = true;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        autoReconcile.skipped = `auto_reconcile_error:${reason.slice(0, 160)}`;
      }
    }
  } else {
    autoReconcile.skipped = "brand_scope";
  }

  if (!options?.brandId) {
    autoFinalizedRuns = await autoFinalizeDormantProcessingRuns();
  }

  if (!options?.brandId) {
    manualReviewAutoClear = await autoClearManualReviewByEvidence({
      apply: true,
      now,
    });
  }

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

  const activeRunCap = config.maxActiveRuns;
  const activeRunsBeforeAutoRemediation = await prisma.catalogRun.count({
    where: { status: { in: ["processing", "paused", "blocked"] } },
  });
  const autoRemediationCapacity = options?.brandId
    ? config.autoRemediateMaxBrands
    : Math.max(0, activeRunCap - activeRunsBeforeAutoRemediation);

  if (!options?.brandId && !options?.force && autoRemediationCapacity > 0) {
    const autoRemediationMaxBrands = Math.max(
      0,
      Math.min(config.autoRemediateMaxBrands, autoRemediationCapacity),
    );
    const autoRemediationConfig = {
      ...config,
      autoRemediateMaxBrands: autoRemediationMaxBrands,
    };
    autoRemediation = await autoRemediateOperationalStaleBrands({
      brands: brands.map((brand) => ({
        id: brand.id,
        name: brand.name,
        siteUrl: brand.siteUrl,
        manualReview: brand.manualReview,
        metadata: brand.metadata,
      })),
      now,
      config: autoRemediationConfig,
    });
  }

  const [activeRunsBefore, pausedOverCapRuns] = await Promise.all([
    prisma.catalogRun.count({
      where: { status: { in: ["processing", "paused", "blocked"] } },
    }),
    prisma.catalogRun.count({
      where: {
        status: "paused",
        blockReason: "stuck_over_cap",
      },
    }),
  ]);
  const stuckProgressCutoff = new Date(
    Date.now() - config.stuckRemediateWindowMinutes * 60 * 1000,
  );
  const [processingGate] = await prisma.$queryRaw<
    Array<{
      processingRuns: number;
      processingRunsWithoutRecentProgress: number;
    }>
  >(Prisma.sql`
    WITH processing_runs AS (
      SELECT cr.id
      FROM "catalog_runs" cr
      WHERE cr.status = 'processing'
    ),
    recent AS (
      SELECT ci."runId", COUNT(*)::int AS "completedRecent"
      FROM "catalog_items" ci
      WHERE ci.status = 'completed'
        AND ci."completedAt" IS NOT NULL
        AND ci."completedAt" >= ${stuckProgressCutoff}
      GROUP BY ci."runId"
    )
    SELECT
      COUNT(*)::int AS "processingRuns",
      COUNT(*) FILTER (WHERE COALESCE(recent."completedRecent", 0) = 0)::int AS "processingRunsWithoutRecentProgress"
    FROM processing_runs pr
    LEFT JOIN recent ON recent."runId" = pr.id
  `);
  const processingRunsGate = processingGate?.processingRuns ?? 0;
  const processingNoProgressGate = processingGate?.processingRunsWithoutRecentProgress ?? 0;
  stuckRemediation = {
    attempted: false,
    dryRun: false,
    strategy: "balanced",
    limit: config.stuckRemediateLimit,
    minNoProgressMinutes: config.stuckRemediateWindowMinutes,
    pauseOverCapTarget: config.stuckPauseOverCapEnabled ? config.stuckPauseOverCapTarget : null,
    processingRuns: processingRunsGate,
    processingRunsWithoutRecentProgress: processingNoProgressGate,
    processingActiveRunCount: processingRunsGate,
    activeRunCount: activeRunsBefore,
    activeRunCap,
    resumed: 0,
    paused: 0,
    requeued: 0,
    reconciled: false,
    reconcileResult: null,
    errors: 0,
    runIds: [],
    sampleRunIds: [],
    skipped: null,
  };
  const shouldRunStuckRemediation =
    !options?.brandId &&
    !options?.force &&
    config.stuckRemediateEnabled &&
    activeRunsBefore > activeRunCap &&
    (processingNoProgressGate >= config.stuckRemediateThreshold || pausedOverCapRuns > 0);
  if (shouldRunStuckRemediation) {
    try {
      const result = await runCatalogRefreshStuckRemediation({
        dryRun: false,
        strategy: "balanced",
        limit: config.stuckRemediateLimit,
        minNoProgressMinutes: config.stuckRemediateWindowMinutes,
        pauseOverCapTarget: config.stuckPauseOverCapTarget,
        pauseOverCapEnabled: config.stuckPauseOverCapEnabled,
        queueEnabled,
      });
      stuckRemediation = { ...result, skipped: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const previous = stuckRemediation;
      stuckRemediation = {
        ...(previous ?? {
          attempted: false,
          dryRun: false,
          strategy: "balanced" as const,
          limit: config.stuckRemediateLimit,
          minNoProgressMinutes: config.stuckRemediateWindowMinutes,
          pauseOverCapTarget: config.stuckPauseOverCapEnabled ? config.stuckPauseOverCapTarget : null,
          processingRuns: processingRunsGate,
          processingRunsWithoutRecentProgress: processingNoProgressGate,
          processingActiveRunCount: processingRunsGate,
          activeRunCount: activeRunsBefore,
          activeRunCap,
          resumed: 0,
          paused: 0,
          requeued: 0,
          reconciled: false,
          reconcileResult: null,
          errors: 0,
          runIds: [],
          sampleRunIds: [],
          skipped: null,
        }),
        attempted: true,
        errors: (previous?.errors ?? 0) + 1,
        skipped: `stuck_remediation_error:${reason.slice(0, 160)}`,
      };
      console.warn("catalog.refresh.stuck_remediation_failed", reason, error);
    }
  } else if (options?.brandId) {
    stuckRemediation.skipped = "brand_scope";
  } else if (options?.force) {
    stuckRemediation.skipped = "force_mode";
  } else if (!config.stuckRemediateEnabled) {
    stuckRemediation.skipped = "stuck_remediation_disabled";
  } else if (activeRunsBefore <= activeRunCap) {
    stuckRemediation.skipped = "active_within_cap";
  } else if (
    processingNoProgressGate < config.stuckRemediateThreshold &&
    pausedOverCapRuns <= 0
  ) {
    stuckRemediation.skipped = "below_processing_no_progress_threshold";
  }
  const activeBrandRows = await prisma.catalogRun.findMany({
    where: { status: { in: ["processing", "paused", "blocked"] } },
    select: { brandId: true },
    distinct: ["brandId"],
  });
  const activeBrandIds = new Set(activeBrandRows.map((row) => row.brandId));
  const activeRunCapacityRemaining = options?.brandId
    ? activeRunCap
    : Math.max(0, activeRunCap - activeRunsBefore);
  const throttledByActiveCap = !options?.brandId && activeRunCapacityRemaining <= 0;

  const archiveAutomationEnabled =
    (process.env.CATALOG_REFRESH_ARCHIVE_AUTOMATION_ENABLED ?? "true")
      .trim()
      .toLowerCase() === "true";
  const archiveAutomationDryRun =
    (process.env.CATALOG_REFRESH_ARCHIVE_AUTOMATION_DRY_RUN ?? "false")
      .trim()
      .toLowerCase() === "true";
  const archiveAutomationLimit = Math.max(
    1,
    Number(process.env.CATALOG_REFRESH_ARCHIVE_AUTOMATION_LIMIT ?? 10),
  );
  if (!options?.brandId && archiveAutomationEnabled) {
    archiveAutomation = await evaluateArchiveCandidates({
      dryRun: archiveAutomationDryRun,
      scope: "all",
      reasons: ["404_real", "no_products_validated"],
      limit: archiveAutomationLimit,
      createdBy: "catalog_refresh_cron",
    });
  }

  const candidates = options?.brandId
    ? brands.filter((brand) => brand.id === options.brandId)
    : brands.filter((brand) => {
        if (activeBrandIds.has(brand.id)) return false;
        if (brand.manualReview) return false;
        const metadata = readMetadata(brand.metadata);
        return options?.force ? true : isBrandDueForRefresh(metadata, now, config);
      });

  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selectionCap = options?.brandId
    ? 1
    : Math.max(0, Math.min(config.maxBrands, activeRunCapacityRemaining));
  const selected = shuffled.slice(0, selectionCap);
  if (!selected.length) {
    return {
      status: "ok",
      processed: 0,
      selected: 0,
      brandConcurrency: 0,
      activeRunsBefore,
      activeRunCap,
      activeRunCapacityRemaining,
      throttledByActiveCap,
      results,
      autoRemediation,
      autoFinalizedRuns,
      manualReviewAutoClear,
      archiveAutomation,
      autoReconcile,
      stuckRemediation,
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

    const failedRows = await prisma.$queryRaw<{ url: string; lastError: string | null }[]>(
      Prisma.sql`
        SELECT DISTINCT ON (ci.url)
          ci.url,
          ci."lastError"
        FROM "catalog_items" ci
        INNER JOIN "catalog_runs" cr ON cr.id = ci."runId"
        WHERE cr."brandId" = ${brand.id}
          AND ci.status = 'failed'
          AND ci."updatedAt" >= ${lookbackStart}
        ORDER BY ci.url ASC, ci."updatedAt" DESC
        LIMIT ${config.failedUrlLimit}
      `,
    );
    const failedRefs = failedRows
      .filter((row) => isRetryableCatalogFailedRef(row.lastError))
      .map((row) => ({ url: row.url }));
    const mergedRefs = refs.length ? refs.concat(failedRefs) : failedRefs;
    const deduped = Array.from(new Map(mergedRefs.map((ref) => [ref.url, ref])).values());
    const sanitizedRefs = sanitizeRefsForPlatform(
      deduped,
      platformForRun ?? brand.ecommercePlatform,
    );

    if (!sanitizedRefs.length) {
      return { brandId: brand.id, status: "skipped", reason: "no_refs" };
    }

    const run = await createRunWithItems({
      brandId: brand.id,
      platform: platformForRun ?? brand.ecommercePlatform,
      refs: sanitizedRefs,
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
    const refill = await topUpCatalogRunQueue({
      runId: run.id,
      enqueueLimit: Math.max(10, enqueueLimit),
      queueEnabled,
    });

    if (config.drainOnRun) {
      await drainCatalogRun({
        runId: run.id,
        batch: Math.min(Math.max(refill.enqueued, 1), 50),
        concurrency: Math.min(10, Math.max(refill.enqueued, 1)),
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
    activeRunsBefore,
    activeRunCap,
    activeRunCapacityRemaining: Math.max(0, activeRunCapacityRemaining - selected.length),
    throttledByActiveCap,
    results,
    autoRemediation,
    autoFinalizedRuns,
    manualReviewAutoClear,
    archiveAutomation,
    autoReconcile,
    stuckRemediation,
  };
};
