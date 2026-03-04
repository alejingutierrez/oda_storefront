import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRefreshConfig, isBrandDueForRefresh } from "@/lib/catalog/refresh";
import {
  computeOperational100Real,
  deriveCatalogStatus,
  hasStatusMismatch,
} from "@/lib/catalog/refresh-status";

export const runtime = "nodejs";

const readMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const parseDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const readFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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

  const [newProducts, priceChanges, stockChanges, stockStatusChanges, brands, archivedBrandsTotalRow, archivedLast24hRow] =
    await Promise.all([
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "products"
          WHERE "createdAt" >= ${windowStart}
        `,
      ),
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "price_history"
          WHERE "capturedAt" >= ${windowStart}
        `,
      ),
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "stock_history"
          WHERE "capturedAt" >= ${windowStart}
        `,
      ),
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "variants"
          WHERE ("metadata" ->> 'last_stock_status_changed_at')::timestamptz >= ${windowStart}
        `,
      ),
      prisma.brand.findMany({
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
      }),
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
          WHERE bae."createdAt" >= ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
        `,
      ),
    ]);

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

  const brandRows = brands.map((brand) => {
    const metadata = readMetadata(brand.metadata);
    const refresh = (metadata.catalog_refresh ?? {}) as Record<string, unknown>;
    const archiveCandidate = readArchiveCandidate(metadata);
    const schedulerDue = isBrandDueForRefresh(metadata, now, config);
    const latestRun = latestRunByBrand.get(brand.id);
    const refreshStatus =
      typeof refresh.lastStatus === "string" ? refresh.lastStatus : null;
    const derivedStatus = deriveCatalogStatus(latestRun?.status ?? null, refreshStatus);
    const lastOperationalAt =
      parseDate(refresh.lastFinishedAt) ?? parseDate(refresh.lastCompletedAt);
    const lastForceAttemptAt = parseDate(refresh.lastForceAttemptAt);
    const lastForceResult = readForceResult(refresh.lastForceResult);
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
      operationalOverdue:
        !brand.manualReview && (!lastOperationalAt || lastOperationalAt < windowStart),
      lastOperationalAt: lastOperationalAt ? lastOperationalAt.toISOString() : null,
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
      archiveCandidate,
    };
  });

  const autoEligibleBrands = brandRows.filter((brand) => !brand.manualReview).length;
  const operationalFreshBrands = brandRows.filter(
    (brand) => !brand.manualReview && !brand.operationalOverdue,
  ).length;
  const qualityFreshBrands = brandRows.filter((brand) => {
    if (brand.manualReview) return false;
    const completedAt = parseDate(brand.refresh.lastCompletedAt);
    return completedAt ? completedAt >= windowStart : false;
  }).length;
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
  for (const brand of brandRows) {
    if (brand.manualReview) {
      staleBreakdown.manual_review += 1;
      continue;
    }
    if (!brand.operationalOverdue) continue;
    const status = (brand.catalogStatus ?? "").toLowerCase();
    if (status === "processing") staleBreakdown.processing += 1;
    else if (status === "paused" || status === "blocked") staleBreakdown.paused += 1;
    else if (status === "failed") staleBreakdown.failed += 1;
    else if (status === "completed") staleBreakdown.completed_stale += 1;
    else staleBreakdown.unknown += 1;
  }
  staleBreakdown.no_status = staleBreakdown.completed_stale + staleBreakdown.unknown;

  const activeRunStatusCounts = await prisma.catalogRun.groupBy({
    by: ["status"],
    where: { status: { in: ["processing", "paused", "blocked"] } },
    _count: { _all: true },
  });
  const processingRunCount =
    activeRunStatusCounts.find((row) => row.status === "processing")?._count._all ?? 0;
  const pausedRunCount =
    activeRunStatusCounts.find((row) => row.status === "paused")?._count._all ?? 0;
  const blockedRunCount =
    activeRunStatusCounts.find((row) => row.status === "blocked")?._count._all ?? 0;
  const activeRunCountTotal = processingRunCount + pausedRunCount + blockedRunCount;
  const schedulingCapacityRemaining = Math.max(0, activeRunCap - processingRunCount);

  const avgDiscoveryCoverageValues = brandRows
    .map((brand) => readFiniteNumber(brand.refresh.lastCombinedCoverage))
    .filter((value): value is number => value !== null);
  const avgRunSuccessRateValues = brandRows
    .map((brand) => readFiniteNumber(brand.refresh.lastRunSuccessRate))
    .filter((value): value is number => value !== null);
  const avgDiscoveryCoverage =
    avgDiscoveryCoverageValues.length > 0
      ? avgDiscoveryCoverageValues.reduce((acc, value) => acc + value, 0) /
        avgDiscoveryCoverageValues.length
      : 0;
  const avgRunSuccessRate =
    avgRunSuccessRateValues.length > 0
      ? avgRunSuccessRateValues.reduce((acc, value) => acc + value, 0) /
        avgRunSuccessRateValues.length
      : 0;

  const statusMismatchRows = brandRows
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

  const alerts = brandRows
    .filter((brand) => !brand.manualReview && brand.operationalOverdue)
    .slice(0, 12)
    .map((brand) => ({
      id: `stale:${brand.id}`,
      type: "stale_brand",
      level: "warning" as const,
      title: `Marca vencida: ${brand.name}`,
      detail: `Último refresh finalizado: ${brand.refresh.lastFinishedAt ?? brand.refresh.lastCompletedAt ?? "sin registro"}.`,
      brandId: brand.id,
      action: { type: "force_refresh", label: "Forzar refresh", brandId: brand.id },
    }));

  const operationalMissingBrands = brandRows
    .filter((brand) => brand.operationalOverdue)
    .map((brand) => {
      const operationalAt = parseDate(brand.lastOperationalAt);
      const daysStale = operationalAt
        ? Math.max(0, Math.floor((now.getTime() - operationalAt.getTime()) / (24 * 60 * 60 * 1000)))
        : null;
      return {
        id: brand.id,
        name: brand.name,
        lastOperationalAt: brand.lastOperationalAt,
        lastStatus: typeof brand.refresh.lastStatus === "string" ? brand.refresh.lastStatus : null,
        daysStale,
        runProgress: null,
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
  const oldestOperationalCandidate = operationalMissingBrands[0] ?? null;

  const archiveByReason = {
    "404_real": 0,
    "no_products_validated": 0,
  };
  const archiveCandidates = brandRows
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

  const operational100RealSummary = computeOperational100Real({
    freshBrands: operationalFreshBrands,
    autoEligibleBrands,
    heartbeatMissing: false,
    queueDriftDetected: false,
    activeHungDetected: false,
    processingRunsWithoutRecentProgress: 0,
  });

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
      newProducts: newProducts[0]?.count ?? 0,
      priceChanges: priceChanges[0]?.count ?? 0,
      stockChanges: stockChanges[0]?.count ?? 0,
      stockStatusChanges: stockStatusChanges[0]?.count ?? 0,
      operationalCoverageExact: operational100RealSummary.operationalCoverageExact,
      operationalHealthOk: operational100RealSummary.operationalHealthOk,
      operational100Real: operational100RealSummary.operational100Real,
      operationalCoveragePctRaw: operational100RealSummary.operationalCoveragePctRaw,
      operationalCoveragePctDisplay: operational100RealSummary.operationalCoveragePctDisplay,
      realGapReasons: operational100RealSummary.realGapReasons,
      statusMismatchCount: statusMismatchRows.length,
      statusMismatchSample: statusMismatchRows.slice(0, 10),
      queueDriftDetected: false,
      heartbeatMissing: false,
      activeHungDetected: false,
      processingRuns: processingRunCount,
      processingRunsWithRecentProgress: 0,
      processingRunsWithoutRecentProgress: 0,
      processingNoProgressCount: 0,
      processingNoProgressTop: [],
      processingNoProgressOverflow: 0,
      highProgressNoProgressCount: 0,
      highProgressNoProgressTop: [],
      archivedBrandsTotal: archivedBrandsTotalRow[0]?.count ?? 0,
      archivedLast24h: archivedLast24hRow[0]?.count ?? 0,
      archiveCandidatesCount: archiveCandidates.length,
      archiveByReason,
    },
    brands: brandRows,
    operationalMissingBrands,
    oldestOperationalRefresh: oldestOperationalCandidate
      ? {
          brandId: oldestOperationalCandidate.id,
          brandName: oldestOperationalCandidate.name,
          lastOperationalAt: oldestOperationalCandidate.lastOperationalAt,
          neverRefreshed: oldestOperationalCandidate.lastOperationalAt === null,
        }
      : null,
    archiveAlerts: [],
    archiveCandidates,
    criticalOperationalAlerts: [],
    alerts,
  });
}
