import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readCatalogQueueDriftSummary } from "@/lib/catalog/queue-drift";
import { getRefreshConfig, isBrandDueForRefresh } from "@/lib/catalog/refresh";
import {
  computeOperational100Real,
  deriveCatalogStatus,
  hasStatusMismatch,
} from "@/lib/catalog/refresh-status";
import { readHeartbeat } from "@/lib/redis";

export const runtime = "nodejs";

const readMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const readFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const parseDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const readForceResult = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as {
        at?: string;
        mode?: string;
        runId?: string | null;
        reason?: string | null;
        status?: string | null;
      })
    : null;

type ArchiveCandidateState = {
  reason: "404_real" | "no_products_validated";
  confidence: number;
  firstDetectedAt: string | null;
  lastValidatedAt: string | null;
  nextCheckAt: string | null;
  evidenceSummary: Record<string, unknown> | null;
};

const readArchiveCandidate = (metadata: Record<string, unknown>): ArchiveCandidateState | null => {
  const lifecycle = readMetadata(metadata.catalog_lifecycle);
  const entry = readMetadata(lifecycle.archiveCandidate);
  const reasonRaw = typeof entry.reason === "string" ? entry.reason : null;
  const reason =
    reasonRaw === "404_real" || reasonRaw === "no_products_validated"
      ? reasonRaw
      : null;
  if (!reason) return null;
  const confidenceRaw = Number(entry.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;
  return {
    reason,
    confidence,
    firstDetectedAt: parseDate(entry.firstDetectedAt)?.toISOString() ?? null,
    lastValidatedAt: parseDate(entry.lastValidatedAt)?.toISOString() ?? null,
    nextCheckAt: parseDate(entry.nextCheckAt)?.toISOString() ?? null,
    evidenceSummary:
      entry.evidenceSummary &&
      typeof entry.evidenceSummary === "object" &&
      !Array.isArray(entry.evidenceSummary)
        ? (entry.evidenceSummary as Record<string, unknown>)
        : null,
  };
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const includeEnrichmentAlerts = new URL(req.url).searchParams.get("includeEnrichmentAlerts") === "true";
  const config = getRefreshConfig();
  const activeRunCap = Math.max(
    1,
    Number(
      (
        config as {
          maxActiveRuns?: number;
        }
      ).maxActiveRuns ?? config.maxBrands * 3,
    ),
  );
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.intervalDays * 24 * 60 * 60 * 1000);

  const [newProducts] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"products\"
      WHERE \"createdAt\" >= ${windowStart}
    `,
  );

  const [priceChanges] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"price_history\"
      WHERE \"capturedAt\" >= ${windowStart}
    `,
  );

  const [stockChanges] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"stock_history\"
      WHERE \"capturedAt\" >= ${windowStart}
    `,
  );

  const [stockStatusChanges] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"variants\"
      WHERE (\"metadata\" ->> 'last_stock_status_changed_at')::timestamptz >= ${windowStart}
    `,
  );

  const brands = await prisma.brand.findMany({
    where: { isActive: true, siteUrl: { not: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      siteUrl: true,
      ecommercePlatform: true,
      manualReview: true,
      metadata: true,
      _count: { select: { products: true } },
    },
  });
  const brandIds = brands.map((brand) => brand.id);
  const latestRunRows = brandIds.length
    ? await prisma.$queryRaw<Array<{ brandId: string; runStatus: string; runUpdatedAt: Date }>>(
        Prisma.sql`
          SELECT DISTINCT ON (cr."brandId")
            cr."brandId" AS "brandId",
            cr.status AS "runStatus",
            cr."updatedAt" AS "runUpdatedAt"
          FROM "catalog_runs" cr
          WHERE cr."brandId" IN (${Prisma.join(brandIds)})
          ORDER BY cr."brandId", cr."updatedAt" DESC
        `,
      )
    : [];
  const latestRunByBrand = new Map(
    latestRunRows.map((row) => [row.brandId, { status: row.runStatus, updatedAt: row.runUpdatedAt }]),
  );
  const archiveWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let archivedBrandsTotalRow: Array<{ count: number }> = [{ count: 0 }];
  let archivedLast24hRow: Array<{ count: number }> = [{ count: 0 }];
  let archiveByReasonRows: Array<{ reason: string; count: number }> = [];
  let recentArchiveEvents: Array<{
    id: string;
    brandId: string;
    brandName: string;
    reason: string;
    createdAt: Date;
  }> = [];
  try {
    [
      archivedBrandsTotalRow,
      archivedLast24hRow,
      archiveByReasonRows,
      recentArchiveEvents,
    ] = await Promise.all([
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "brands" b
          WHERE b."isActive" = false
            AND COALESCE((b."metadata"->'catalog_lifecycle'->>'status'), '') = 'archived'
        `,
      ),
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "brand_archive_events" bae
          WHERE bae."createdAt" >= ${archiveWindowStart}
        `,
      ),
      prisma.$queryRaw<Array<{ reason: string; count: number }>>(
        Prisma.sql`
          SELECT bae.reason, COUNT(*)::int AS count
          FROM "brand_archive_events" bae
          GROUP BY bae.reason
        `,
      ),
      prisma.$queryRaw<
        Array<{
          id: string;
          brandId: string;
          brandName: string;
          reason: string;
          createdAt: Date;
        }>
      >(
        Prisma.sql`
          SELECT
            bae.id,
            bae."brandId" AS "brandId",
            b.name AS "brandName",
            bae.reason,
            bae."createdAt" AS "createdAt"
          FROM "brand_archive_events" bae
          INNER JOIN "brands" b ON b.id = bae."brandId"
          WHERE bae."createdAt" >= ${archiveWindowStart}
          ORDER BY bae."createdAt" DESC
          LIMIT 200
        `,
      ),
    ]);
  } catch (error) {
    console.warn("catalog_refresh.state.archive_metrics_unavailable", error);
  }

  const brandRows = brands.map((brand) => {
    const metadata = readMetadata(brand.metadata);
    const refresh = (metadata.catalog_refresh ?? {}) as Record<string, unknown>;
    const archiveCandidate = readArchiveCandidate(metadata);
    const schedulerDue = isBrandDueForRefresh(metadata, now, config);
    const latestRun = latestRunByBrand.get(brand.id);
    const refreshStatus =
      typeof refresh.lastStatus === "string" ? refresh.lastStatus : null;
    const derivedStatus = deriveCatalogStatus(latestRun?.status ?? null, refreshStatus);
    return {
      id: brand.id,
      name: brand.name,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
      manualReview: brand.manualReview,
      productCount: brand._count.products,
      refresh,
      runStatus: latestRun?.status ?? null,
      runUpdatedAt: latestRun?.updatedAt ? latestRun.updatedAt.toISOString() : null,
      catalogStatus: derivedStatus.catalogStatus,
      statusDiagnostics: derivedStatus.diagnostics,
      schedulerDue,
      due: schedulerDue,
      archiveCandidate,
    };
  });

  const getLastCompletedAt = (brand: (typeof brandRows)[number]) =>
    parseDate(brand.refresh?.lastCompletedAt);

  const getLastFinishedAt = (brand: (typeof brandRows)[number]) =>
    parseDate(brand.refresh?.lastFinishedAt);

  const getOperationalTimestamp = (brand: (typeof brandRows)[number]) =>
    getLastFinishedAt(brand) ?? getLastCompletedAt(brand);

  const isAutoEligible = (brand: (typeof brandRows)[number]) => !brand.manualReview;

  const isOperationalFresh = (brand: (typeof brandRows)[number]) => {
    if (!isAutoEligible(brand)) return false;
    const operationalAt = getOperationalTimestamp(brand);
    return operationalAt ? operationalAt >= windowStart : false;
  };

  const isOperationalOverdue = (brand: (typeof brandRows)[number]) => {
    if (!isAutoEligible(brand)) return false;
    const operationalAt = getOperationalTimestamp(brand);
    return !operationalAt || operationalAt < windowStart;
  };

  const isQualityFresh = (brand: (typeof brandRows)[number]) => {
    if (!isAutoEligible(brand)) return false;
    const completedAt = getLastCompletedAt(brand);
    return completedAt ? completedAt >= windowStart : false;
  };

  const rowsWithOperationalStatus = brandRows.map((brand) => {
    const operationalAt = getOperationalTimestamp(brand);
    const lastForceAttemptAt = parseDate(brand.refresh?.lastForceAttemptAt);
    const lastForceResult = readForceResult(brand.refresh?.lastForceResult);
    return {
      ...brand,
      lastOperationalAt: operationalAt ? operationalAt.toISOString() : null,
      operationalOverdue: isOperationalOverdue(brand),
      lastForceAttemptAt: lastForceAttemptAt ? lastForceAttemptAt.toISOString() : null,
      lastForceResult:
        lastForceResult && typeof lastForceResult.mode === "string"
          ? {
              at:
                typeof lastForceResult.at === "string" && parseDate(lastForceResult.at)
                  ? new Date(lastForceResult.at).toISOString()
                  : null,
              mode: lastForceResult.mode,
              runId: typeof lastForceResult.runId === "string" ? lastForceResult.runId : null,
              reason:
                typeof lastForceResult.reason === "string" ? lastForceResult.reason : null,
              status:
                typeof lastForceResult.status === "string" ? lastForceResult.status : null,
            }
          : null,
    };
  });
  const statusMismatchRows = rowsWithOperationalStatus
    .filter((brand) =>
      hasStatusMismatch(
        brand.statusDiagnostics?.runStatus ?? null,
        brand.statusDiagnostics?.refreshStatus ?? null,
      ),
    )
    .map((brand) => ({
      brandId: brand.id,
      brandName: brand.name,
      runStatus: brand.statusDiagnostics?.runStatus ?? null,
      refreshStatus: brand.statusDiagnostics?.refreshStatus ?? null,
    }));

  const autoEligibleBrands = rowsWithOperationalStatus.filter(isAutoEligible).length;
  const operationalFreshBrands = rowsWithOperationalStatus.filter(isOperationalFresh).length;
  const qualityFreshBrands = rowsWithOperationalStatus.filter(isQualityFresh).length;
  const operationalStaleBrands = Math.max(0, autoEligibleBrands - operationalFreshBrands);
  const qualityStaleBrands = Math.max(0, autoEligibleBrands - qualityFreshBrands);

  const staleBreakdown = {
    processing: 0,
    paused: 0,
    failed: 0,
    completed_stale: 0,
    unknown: 0,
    no_status: 0,
    manual_review: 0,
  };

  for (const brand of rowsWithOperationalStatus) {
    if (brand.manualReview) {
      staleBreakdown.manual_review += 1;
      continue;
    }
    if (isOperationalFresh(brand)) continue;
    const status = (brand.catalogStatus ?? "").toLowerCase();
    if (status === "processing") {
      staleBreakdown.processing += 1;
      continue;
    }
    if (status === "paused" || status === "blocked") {
      staleBreakdown.paused += 1;
      continue;
    }
    if (status === "failed") {
      staleBreakdown.failed += 1;
      continue;
    }
    if (status === "completed") {
      staleBreakdown.completed_stale += 1;
      continue;
    }
    staleBreakdown.unknown += 1;
  }
  staleBreakdown.no_status = staleBreakdown.completed_stale + staleBreakdown.unknown;

  // Metrics are aligned to the same window shown in the UI. We treat "coverage" as discovery
  // coverage (sitemap/adapter refs already present in DB pre-run), and "success" as run success
  // rate (completed items / total items).
  const windowBrands = rowsWithOperationalStatus.filter((brand) => {
    if (brand.manualReview) return false;
    const finishedAt = getOperationalTimestamp(brand);
    return finishedAt ? finishedAt >= windowStart : false;
  });

  const discoveryRows = windowBrands
    .map((brand) => {
      const count = readFiniteNumber(brand.refresh?.lastCombinedCount);
      const matched = readFiniteNumber(brand.refresh?.lastCombinedMatched);
      const coverage = readFiniteNumber(brand.refresh?.lastCombinedCoverage);
      return { count, matched, coverage };
    })
    .filter((row) => row.coverage !== null || (row.count !== null && row.matched !== null));

  const discoveryCoverageValues = discoveryRows
    .map((row) => row.coverage)
    .filter((value): value is number => value !== null);
  const discoveryMean =
    discoveryCoverageValues.length > 0
      ? discoveryCoverageValues.reduce((acc, value) => acc + value, 0) / discoveryCoverageValues.length
      : 0;

  const discoveryWeighted = (() => {
    let total = 0;
    let matched = 0;
    for (const row of discoveryRows) {
      if (row.count === null || row.matched === null) continue;
      if (row.count <= 0) continue;
      total += row.count;
      matched += Math.max(0, Math.min(row.count, row.matched));
    }
    return total > 0 ? matched / total : null;
  })();

  const avgDiscoveryCoverage = discoveryWeighted ?? discoveryMean ?? 0;

  const successRows = windowBrands
    .map((brand) => {
      const successRate = readFiniteNumber(brand.refresh?.lastRunSuccessRate);
      const totalItems = readFiniteNumber(brand.refresh?.lastRunTotalItems);
      const completedItems = readFiniteNumber(brand.refresh?.lastRunCompletedItems);
      const derived =
        totalItems !== null && completedItems !== null && totalItems > 0
          ? completedItems / totalItems
          : null;
      return { successRate: successRate ?? derived, totalItems, completedItems };
    })
    .filter((row) => row.successRate !== null);

  const successMean =
    successRows.length > 0
      ? successRows.reduce((acc, row) => acc + (row.successRate ?? 0), 0) / successRows.length
      : 0;

  const successWeighted = (() => {
    let total = 0;
    let completed = 0;
    for (const row of successRows) {
      if (row.totalItems === null || row.completedItems === null) continue;
      if (row.totalItems <= 0) continue;
      total += row.totalItems;
      completed += Math.max(0, Math.min(row.totalItems, row.completedItems));
    }
    return total > 0 ? completed / total : null;
  })();

  const avgRunSuccessRate = successWeighted ?? successMean ?? 0;
  const progressWindowMinutes = Math.max(
    5,
    Number(process.env.CATALOG_PROGRESS_WINDOW_MINUTES ?? 20),
  );
  const progressCutoff = new Date(Date.now() - progressWindowMinutes * 60 * 1000);

  const overdueBrandIds = rowsWithOperationalStatus
    .filter((brand) => !brand.manualReview && brand.operationalOverdue)
    .map((brand) => brand.id);

  const latestRunProgressByBrand = new Map<
    string,
    {
      runId: string;
      status: string;
      total: number;
      completed: number;
      failed: number;
      pending: number;
      completedRecent: number;
      progressPct: number;
      updatedAt: string;
    }
  >();

  if (overdueBrandIds.length) {
    const latestRunRows = await prisma.$queryRaw<
      Array<{
        brandId: string;
        runId: string;
        status: string;
        updatedAt: Date;
        totalItems: number | null;
        completed: number;
        completedRecent: number;
        failed: number;
        pending: number;
      }>
    >(
      Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON (cr."brandId")
            cr."brandId" AS "brandId",
            cr.id AS "runId",
            cr.status,
            cr."updatedAt" AS "updatedAt",
            cr."totalItems"::int AS "totalItems"
          FROM "catalog_runs" cr
          WHERE cr."brandId" IN (${Prisma.join(overdueBrandIds)})
          ORDER BY cr."brandId", cr."updatedAt" DESC
        ),
        counts AS (
          SELECT
            ci."runId" AS "runId",
            COUNT(*) FILTER (WHERE ci.status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE ci.status = 'completed' AND ci."completedAt" >= ${progressCutoff})::int AS "completedRecent",
            COUNT(*) FILTER (WHERE ci.status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE ci.status IN ('pending', 'queued', 'in_progress'))::int AS pending
          FROM "catalog_items" ci
          WHERE ci."runId" IN (SELECT "runId" FROM latest)
          GROUP BY ci."runId"
        )
        SELECT
          l."brandId" AS "brandId",
          l."runId" AS "runId",
          l.status,
          l."updatedAt" AS "updatedAt",
          l."totalItems" AS "totalItems",
          COALESCE(c.completed, 0)::int AS completed,
          COALESCE(c."completedRecent", 0)::int AS "completedRecent",
          COALESCE(c.failed, 0)::int AS failed,
          COALESCE(c.pending, 0)::int AS pending
        FROM latest l
        LEFT JOIN counts c ON c."runId" = l."runId"
      `,
    );

    latestRunRows.forEach((row) => {
      const totalFromCounts = Math.max(0, row.completed + row.failed + row.pending);
      const total = row.totalItems && row.totalItems > 0 ? row.totalItems : totalFromCounts;
      const progressPct = total > 0 ? Math.round(((row.completed + row.failed) / total) * 100) : 0;
      latestRunProgressByBrand.set(row.brandId, {
        runId: row.runId,
        status: row.status,
        total,
        completed: row.completed,
        completedRecent: row.completedRecent,
        failed: row.failed,
        pending: row.pending,
        progressPct,
        updatedAt: row.updatedAt.toISOString(),
      });
    });
  }

  const [catalogHeartbeat, enrichHeartbeat, queueDrift, processingProgress, activeRunStatusCounts] = await Promise.all([
    readHeartbeat("workers:catalog:alive"),
    readHeartbeat("workers:enrich:alive"),
    readCatalogQueueDriftSummary({
      sampleLimit: Math.max(
        50,
        Number(process.env.CATALOG_REFRESH_DRIFT_SAMPLE_LIMIT ?? 200),
      ),
    }),
    prisma.$queryRaw<
      Array<{
        processingRuns: number;
        processingRunsWithRecentProgress: number;
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
          AND ci."completedAt" >= ${progressCutoff}
        GROUP BY ci."runId"
      )
      SELECT
        COUNT(*)::int AS "processingRuns",
        COUNT(*) FILTER (WHERE COALESCE(recent."completedRecent", 0) > 0)::int AS "processingRunsWithRecentProgress",
        COUNT(*) FILTER (WHERE COALESCE(recent."completedRecent", 0) = 0)::int AS "processingRunsWithoutRecentProgress"
      FROM processing_runs pr
      LEFT JOIN recent ON recent."runId" = pr.id
    `),
    prisma.catalogRun.groupBy({
      by: ["status"],
      where: { status: { in: ["processing", "paused", "blocked"] } },
      _count: { _all: true },
    }),
  ]);
  const processingProgressRow = processingProgress[0] ?? {
    processingRuns: 0,
    processingRunsWithRecentProgress: 0,
    processingRunsWithoutRecentProgress: 0,
  };
  const processingRunCount =
    activeRunStatusCounts.find((row) => row.status === "processing")?._count._all ?? 0;
  const pausedRunCount =
    activeRunStatusCounts.find((row) => row.status === "paused")?._count._all ?? 0;
  const blockedRunCount =
    activeRunStatusCounts.find((row) => row.status === "blocked")?._count._all ?? 0;
  const activeRunCountTotal = processingRunCount + pausedRunCount + blockedRunCount;
  const schedulingCapacityRemaining = Math.max(0, activeRunCap - processingRunCount);
  const catalogBacklog = queueDrift.waiting + queueDrift.active + queueDrift.delayed;
  const heartbeatMissing = catalogBacklog > 0 && !catalogHeartbeat.online;
  const activeZombieCriticalCount = Number(
    (
      queueDrift as {
        activeZombieCriticalCount?: number;
      }
    ).activeZombieCriticalCount ?? queueDrift.activeZombieCount ?? 0,
  );
  const activeHungDetected =
    queueDrift.activeHungDetected || activeZombieCriticalCount > 0;
  const operational100RealSummary = computeOperational100Real({
    freshBrands: operationalFreshBrands,
    autoEligibleBrands,
    heartbeatMissing,
    queueDriftDetected: queueDrift.driftDetected,
    activeHungDetected,
    processingRunsWithoutRecentProgress:
      processingProgressRow.processingRunsWithoutRecentProgress,
  });

  const alertLimit = 12;
  const alertTopBrands = Math.max(
    1,
    Number(process.env.CATALOG_ALERT_TOP_BRANDS ?? 25),
  );
  const queueDriftCritical =
    queueDrift.waitingItemNotQueued > 0 || activeZombieCriticalCount > 0;
  const queueDriftLevel: "warning" | "danger" = queueDriftCritical ? "danger" : "warning";
  type RefreshAlert = {
    id: string;
    type: string;
    level: "info" | "warning" | "danger";
    title: string;
    detail?: string;
    brandId?: string;
    action?: { type: string; label: string; brandId?: string };
  };
  const criticalOperationalAlerts: RefreshAlert[] = [];
  const nonCriticalAlerts: RefreshAlert[] = [];
  const pushAlert = (alert: RefreshAlert, options?: { critical?: boolean }) => {
    if (options?.critical) {
      criticalOperationalAlerts.push(alert);
      return;
    }
    nonCriticalAlerts.push(alert);
  };

  if (queueDrift.driftDetected) {
    pushAlert({
      id: "catalog_queue_drift",
      type: "catalog_queue_drift",
      level: queueDriftLevel,
      title: "Drift detectado entre BullMQ y DB",
      detail: `waiting(sample=${queueDrift.waitingSampleSize}): non_queued=${queueDrift.waitingItemNotQueued}, run_not_processing=${queueDrift.waitingRunNotProcessing}, missing_item=${queueDrift.waitingMissingItem}. runs_without_queue_load=${queueDrift.runsRunnableWithoutQueueLoad}.`,
      action: { type: "reconcile_catalog", label: "Reconciliar cola" },
    }, { critical: true });
  }
  if (heartbeatMissing) {
    pushAlert({
      id: "catalog_worker_heartbeat_missing",
      type: "catalog_worker_heartbeat_missing",
      level: "danger",
      title: "Heartbeat de worker catálogo ausente con backlog activo",
      detail: `backlog=${catalogBacklog} · ttl=${catalogHeartbeat.ttlSeconds ?? "n/a"} · enrich_online=${enrichHeartbeat.online ? "si" : "no"}.`,
      action: { type: "reconcile_catalog", label: "Reconciliar cola" },
    }, { critical: true });
  }
  if (processingProgressRow.processingRunsWithoutRecentProgress > 0) {
    pushAlert({
      id: "catalog_processing_no_recent_progress",
      type: "catalog_processing_no_recent_progress",
      level: queueDriftLevel,
      title: "Runs processing sin progreso reciente",
      detail: `${processingProgressRow.processingRunsWithoutRecentProgress}/${processingProgressRow.processingRuns} sin completions en ${progressWindowMinutes} min.`,
      action: { type: "reconcile_catalog", label: "Reconciliar cola" },
    }, { critical: true });
  }

  const dueBrands = rowsWithOperationalStatus
    .filter((brand) => !brand.manualReview && brand.operationalOverdue);
  const processingNoProgressEntries: Array<{
    brandId: string;
    brandName: string;
    runId: string;
    runStatus: string;
    completed: number;
    total: number;
    completedRecent: number;
    pending: number;
    failed: number;
    progressPct: number;
    updatedAt: string;
  }> = [];
  dueBrands.forEach((brand) => {
    const latestProgress = latestRunProgressByBrand.get(brand.id);
    const forceMode = brand.lastForceResult?.mode ?? null;
    if (latestProgress && latestProgress.status === "processing") {
      const hasRecentProgress = latestProgress.completedRecent > 0;
      if (latestProgress.status === "processing" && hasRecentProgress) {
        pushAlert({
          id: `stale_auto_recovering:${brand.id}`,
          type: "stale_auto_recovering",
          level: "info",
          title: `Auto-recovery en curso: ${brand.name}`,
          detail: `Run ${latestProgress.runId} · ${latestProgress.completed}/${latestProgress.total} (${latestProgress.progressPct}%) · completions recientes=${latestProgress.completedRecent}.`,
          brandId: brand.id,
        });
        return;
      }

      processingNoProgressEntries.push({
        brandId: brand.id,
        brandName: brand.name,
        runId: latestProgress.runId,
        runStatus: latestProgress.status,
        completed: latestProgress.completed,
        total: latestProgress.total,
        completedRecent: latestProgress.completedRecent,
        pending: latestProgress.pending,
        failed: latestProgress.failed,
        progressPct: latestProgress.progressPct,
        updatedAt: latestProgress.updatedAt,
      });
      return;
    }

    if (forceMode === "no_refs") {
      pushAlert({
        id: `stale_no_refs:${brand.id}`,
        type: "stale_no_refs",
        level: "warning",
        title: `Sin refs para auto-recovery: ${brand.name}`,
        detail: `Último intento: ${brand.lastForceAttemptAt ?? "sin registro"} · motivo ${brand.lastForceResult?.reason ?? "no_refs"}.`,
        brandId: brand.id,
        action: { type: "force_refresh", label: "Forzar refresh", brandId: brand.id },
      });
      return;
    }

    pushAlert({
      id: `stale:${brand.id}`,
      type: "stale_brand",
      level: "warning",
      title: `Marca vencida: ${brand.name}`,
      detail: `Último refresh finalizado: ${brand.refresh?.lastFinishedAt ?? brand.refresh?.lastCompletedAt ?? "sin registro"}.`,
      brandId: brand.id,
      action: { type: "force_refresh", label: "Forzar refresh", brandId: brand.id },
    });
  });

  const processingNoProgressSorted = [...processingNoProgressEntries].sort((a, b) => {
    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  });
  const highProgressThreshold = Math.max(
    50,
    Math.min(100, Number(process.env.CATALOG_ALERT_HIGH_PROGRESS_THRESHOLD ?? 99)),
  );
  const highProgressNoProgress = processingNoProgressSorted.filter(
    (entry) => entry.progressPct >= highProgressThreshold,
  );
  const highProgressNoProgressTop = highProgressNoProgress.slice(0, alertTopBrands);
  const processingNoProgressTop = processingNoProgressSorted.slice(0, alertTopBrands);
  const processingNoProgressOverflow = Math.max(
    0,
    processingNoProgressSorted.length - processingNoProgressTop.length,
  );
  processingNoProgressTop.forEach((entry) => {
    pushAlert({
      id: `stale_processing_no_progress:${entry.brandId}`,
      type: "stale_processing_no_progress",
      level: queueDriftLevel,
      title: `Processing sin progreso real: ${entry.brandName}`,
      detail: `Run ${entry.runId} · status ${entry.runStatus} · ${entry.completed}/${entry.total} · completions recientes=${entry.completedRecent}.`,
      brandId: entry.brandId,
      action: { type: "resume_catalog_strong", label: "Resume fuerte", brandId: entry.brandId },
    }, { critical: true });
  });
  if (processingNoProgressOverflow > 0) {
    pushAlert({
      id: "stale_processing_no_progress:overflow",
      type: "stale_processing_no_progress_overflow",
      level: queueDriftLevel,
      title: `Processing sin progreso real: +${processingNoProgressOverflow} marcas adicionales`,
      detail: `Mostrando top ${processingNoProgressTop.length} de ${processingNoProgressSorted.length}.`,
      action: {
        type: "remediate_catalog_balanced",
        label: "Remediación masiva (balanceada)",
      },
    }, { critical: true });
  }

  const alertStuckMinutes = Math.max(
    5,
    Number(process.env.CATALOG_ALERT_STUCK_MINUTES ?? 90),
  );
  const stuckCatalogCutoff = new Date(Date.now() - alertStuckMinutes * 60 * 1000);
  const stuckCatalogRuns = await prisma.catalogRun.findMany({
    where: {
      status: { in: ["processing", "paused", "blocked"] },
      updatedAt: { lt: stuckCatalogCutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: alertLimit,
    include: { brand: { select: { id: true, name: true } } },
  });
  stuckCatalogRuns.forEach((run) => {
    pushAlert({
      id: `catalog_stuck:${run.id}`,
      type: "catalog_stuck",
      level: run.status === "processing" && queueDriftCritical ? "danger" : "warning",
      title: `Catálogo atascado: ${run.brand?.name ?? "Marca"}`,
      detail: `Status ${run.status} · Última actividad ${run.updatedAt.toISOString()}`,
      brandId: run.brandId,
      action: run.brandId
        ? { type: "resume_catalog_strong", label: "Resume fuerte", brandId: run.brandId }
        : undefined,
    }, { critical: run.status === "processing" });
  });

  if (includeEnrichmentAlerts) {
    const enrichmentAlertMinutes = Math.max(
      5,
      Number(process.env.PRODUCT_ENRICHMENT_ALERT_STUCK_MINUTES ?? 90),
    );
    const stuckEnrichCutoff = new Date(Date.now() - enrichmentAlertMinutes * 60 * 1000);
    const stuckEnrichmentRuns = await prisma.productEnrichmentRun.findMany({
      where: {
        status: { in: ["processing", "paused", "blocked"] },
        updatedAt: { lt: stuckEnrichCutoff },
      },
      orderBy: { updatedAt: "asc" },
      take: alertLimit,
      include: { brand: { select: { id: true, name: true } } },
    });
    stuckEnrichmentRuns.forEach((run) => {
      const meta = readMetadata(run.metadata);
      const createdBy = typeof meta.created_by === "string" ? meta.created_by : null;
      const autoStart = typeof meta.auto_start === "boolean" ? meta.auto_start : null;
      const isQueuedByRefresh = createdBy === "catalog_refresh" && autoStart === false;

      const titlePrefix =
        run.status === "processing"
          ? "Enriquecimiento atascado"
          : run.status === "blocked"
            ? "Enriquecimiento bloqueado"
            : isQueuedByRefresh
              ? "Enriquecimiento pendiente"
              : "Enriquecimiento pausado";

      const level =
        run.status === "processing"
          ? ("danger" as const)
          : run.status === "blocked"
            ? ("danger" as const)
            : isQueuedByRefresh
              ? ("info" as const)
              : ("warning" as const);

      const parts = [
        `Status ${run.status}`,
        run.blockReason ? `Bloqueo ${run.blockReason}` : null,
        run.lastError ? `Error ${run.lastError}` : null,
        `Última actividad ${run.updatedAt.toISOString()}`,
      ].filter(Boolean) as string[];

      pushAlert({
        id: `enrich_stuck:${run.id}`,
        type: isQueuedByRefresh ? "enrichment_queued" : "enrichment_stuck",
        level,
        title: `${titlePrefix}: ${run.brand?.name ?? "Marca"}`,
        detail: parts.join(" · "),
        brandId: run.brandId ?? undefined,
        action: run.brandId
          ? {
              type: "resume_enrichment",
              label: isQueuedByRefresh ? "Procesar" : "Reanudar",
              brandId: run.brandId,
            }
          : undefined,
      });
    });
  }

  const operationalMissingBrands = rowsWithOperationalStatus
    .filter((brand) => brand.operationalOverdue)
    .map((brand) => {
      const operationalAt = getOperationalTimestamp(brand);
      const daysStale = operationalAt
        ? Math.max(0, Math.floor((now.getTime() - operationalAt.getTime()) / (24 * 60 * 60 * 1000)))
        : null;
      const runProgress = latestRunProgressByBrand.get(brand.id) ?? null;
      return {
        id: brand.id,
        name: brand.name,
        lastOperationalAt: operationalAt ? operationalAt.toISOString() : null,
        lastStatus: typeof brand.refresh?.lastStatus === "string" ? brand.refresh.lastStatus : null,
        daysStale,
        runProgress,
        lastForceResult: brand.lastForceResult ?? null,
        lastForceAttemptAt: brand.lastForceAttemptAt ?? null,
      };
    })
    .sort((a, b) => {
      if (!a.lastOperationalAt && !b.lastOperationalAt) return a.name.localeCompare(b.name, "es");
      if (!a.lastOperationalAt) return -1;
      if (!b.lastOperationalAt) return 1;
      return new Date(a.lastOperationalAt).getTime() - new Date(b.lastOperationalAt).getTime();
    });

  const oldestOperationalCandidate = rowsWithOperationalStatus
    .filter((brand) => !brand.manualReview)
    .map((brand) => ({
      id: brand.id,
      name: brand.name,
      lastOperationalAt: brand.lastOperationalAt,
    }))
    .sort((a, b) => {
      if (!a.lastOperationalAt && !b.lastOperationalAt) return a.name.localeCompare(b.name, "es");
      if (!a.lastOperationalAt) return -1;
      if (!b.lastOperationalAt) return 1;
      return new Date(a.lastOperationalAt).getTime() - new Date(b.lastOperationalAt).getTime();
    })[0];

  const dedupeAlertsById = (items: RefreshAlert[]) => {
    const map = new Map<string, RefreshAlert>();
    for (const alert of items) {
      if (!map.has(alert.id)) map.set(alert.id, alert);
    }
    return Array.from(map.values());
  };
  const dedupedCriticalAlerts = dedupeAlertsById(criticalOperationalAlerts);
  const dedupedNonCritical = dedupeAlertsById(nonCriticalAlerts).filter(
    (alert) => !dedupedCriticalAlerts.some((critical) => critical.id === alert.id),
  );
  const alerts = [...dedupedCriticalAlerts, ...dedupedNonCritical].slice(0, alertLimit);
  const archiveByReason = {
    "404_real": 0,
    "no_products_validated": 0,
  };
  archiveByReasonRows.forEach((row) => {
    if (row.reason === "404_real") archiveByReason["404_real"] = row.count;
    if (row.reason === "no_products_validated") archiveByReason["no_products_validated"] = row.count;
  });
  const archiveCandidates = rowsWithOperationalStatus
    .filter((brand) => Boolean(brand.archiveCandidate))
    .map((brand) => ({
      brandId: brand.id,
      brandName: brand.name,
      reason: brand.archiveCandidate?.reason ?? "404_real",
      confidence: brand.archiveCandidate?.confidence ?? 0,
      evidence: brand.archiveCandidate?.evidenceSummary ?? {},
      firstDetectedAt: brand.archiveCandidate?.firstDetectedAt ?? null,
      lastValidatedAt: brand.archiveCandidate?.lastValidatedAt ?? null,
      nextCheckAt: brand.archiveCandidate?.nextCheckAt ?? null,
    }))
    .sort((a, b) => b.confidence - a.confidence);
  const archiveAlerts = recentArchiveEvents.map((event) => ({
    id: `archive:${event.id}`,
    type:
      event.reason === "404_real"
        ? "brand_archived_404_real"
        : "brand_archived_no_products_validated",
    level: "danger" as const,
    title:
      event.reason === "404_real"
        ? `Marca archivada por 404 real: ${event.brandName}`
        : `Marca archivada por no_products validado: ${event.brandName}`,
    detail: `Motivo ${event.reason} · archivada ${event.createdAt.toISOString()}.`,
    brandId: event.brandId,
    reason: event.reason,
    archivedAt: event.createdAt.toISOString(),
  }));
  const archivedBrandsTotal = archivedBrandsTotalRow[0]?.count ?? 0;
  const archivedLast24h = archivedLast24hRow[0]?.count ?? 0;

  return NextResponse.json({
    config,
    windowStart: windowStart.toISOString(),
    summary: {
      totalBrands: brandRows.length,
      autoEligibleBrands,
      freshBrands: operationalFreshBrands,
      staleBrands: operationalStaleBrands,
      operationalFreshBrands,
      qualityFreshBrands,
      operationalStaleBrands,
      qualityStaleBrands,
      staleBreakdown,
      activeRunCount: activeRunCountTotal,
      activeRunCountTotal,
      activeRunCap,
      processingRunCount,
      pausedRunCount,
      blockedRunCount,
      schedulingCapacityRemaining,
      activeRunCapacityRemaining: schedulingCapacityRemaining,
      avgDiscoveryCoverage,
      avgRunSuccessRate,
      newProducts: newProducts?.count ?? 0,
      priceChanges: priceChanges?.count ?? 0,
      stockChanges: stockChanges?.count ?? 0,
      stockStatusChanges: stockStatusChanges?.count ?? 0,
      operationalCoverageExact: operational100RealSummary.operationalCoverageExact,
      operationalHealthOk: operational100RealSummary.operationalHealthOk,
      operational100Real: operational100RealSummary.operational100Real,
      operationalCoveragePctRaw: operational100RealSummary.operationalCoveragePctRaw,
      operationalCoveragePctDisplay: operational100RealSummary.operationalCoveragePctDisplay,
      realGapReasons: operational100RealSummary.realGapReasons,
      statusMismatchCount: statusMismatchRows.length,
      statusMismatchSample: statusMismatchRows.slice(0, 10),
      queueDriftDetected: queueDrift.driftDetected,
      heartbeatMissing,
      activeHungDetected,
      processingRuns: processingProgressRow.processingRuns,
      processingRunsWithRecentProgress: processingProgressRow.processingRunsWithRecentProgress,
      processingRunsWithoutRecentProgress:
        processingProgressRow.processingRunsWithoutRecentProgress,
      processingNoProgressCount: processingNoProgressSorted.length,
      processingNoProgressTop: processingNoProgressTop,
      processingNoProgressOverflow,
      highProgressNoProgressCount: highProgressNoProgress.length,
      highProgressNoProgressTop,
      archivedBrandsTotal,
      archivedLast24h,
      archiveCandidatesCount: archiveCandidates.length,
      archiveByReason,
    },
    diagnostics: {
      queueDrift,
      heartbeat: {
        catalog: catalogHeartbeat,
        enrich: enrichHeartbeat,
        heartbeatMissing,
      },
      progress: {
        windowMinutes: progressWindowMinutes,
        processingRuns: processingProgressRow.processingRuns,
        processingRunsWithRecentProgress:
          processingProgressRow.processingRunsWithRecentProgress,
        processingRunsWithoutRecentProgress:
          processingProgressRow.processingRunsWithoutRecentProgress,
      },
      processingNoProgress: {
        windowMinutes: progressWindowMinutes,
        topLimit: alertTopBrands,
        total: processingNoProgressSorted.length,
        overflow: processingNoProgressOverflow,
        top: processingNoProgressTop,
        all: processingNoProgressSorted,
      },
      highProgressNoProgress: {
        threshold: highProgressThreshold,
        total: highProgressNoProgress.length,
        top: highProgressNoProgressTop,
      },
    },
    brands: rowsWithOperationalStatus,
    operationalMissingBrands,
    oldestOperationalRefresh: oldestOperationalCandidate
      ? {
          brandId: oldestOperationalCandidate.id,
          brandName: oldestOperationalCandidate.name,
          lastOperationalAt: oldestOperationalCandidate.lastOperationalAt,
          neverRefreshed: oldestOperationalCandidate.lastOperationalAt === null,
        }
      : null,
    archiveAlerts,
    archiveCandidates,
    criticalOperationalAlerts: dedupedCriticalAlerts,
    alerts,
  });
}
