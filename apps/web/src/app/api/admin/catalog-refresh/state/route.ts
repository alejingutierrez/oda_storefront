import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRefreshConfig, isBrandDueForRefresh } from "@/lib/catalog/refresh";

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

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const includeEnrichmentAlerts = new URL(req.url).searchParams.get("includeEnrichmentAlerts") === "true";
  const config = getRefreshConfig();
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

  const brandRows = brands.map((brand) => {
    const metadata = readMetadata(brand.metadata);
    const refresh = (metadata.catalog_refresh ?? {}) as Record<string, unknown>;
    const schedulerDue = isBrandDueForRefresh(metadata, now, config);
    return {
      id: brand.id,
      name: brand.name,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
      manualReview: brand.manualReview,
      productCount: brand._count.products,
      refresh,
      schedulerDue,
      due: schedulerDue,
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

  const autoEligibleBrands = rowsWithOperationalStatus.filter(isAutoEligible).length;
  const operationalFreshBrands = rowsWithOperationalStatus.filter(isOperationalFresh).length;
  const qualityFreshBrands = rowsWithOperationalStatus.filter(isQualityFresh).length;
  const operationalStaleBrands = Math.max(0, autoEligibleBrands - operationalFreshBrands);
  const qualityStaleBrands = Math.max(0, autoEligibleBrands - qualityFreshBrands);

  const staleBreakdown = {
    processing: 0,
    failed: 0,
    no_status: 0,
    manual_review: 0,
  };

  for (const brand of rowsWithOperationalStatus) {
    if (brand.manualReview) {
      staleBreakdown.manual_review += 1;
      continue;
    }
    if (isOperationalFresh(brand)) continue;
    const status = typeof brand.refresh?.lastStatus === "string" ? brand.refresh.lastStatus : "";
    if (status === "processing") {
      staleBreakdown.processing += 1;
      continue;
    }
    if (status === "failed") {
      staleBreakdown.failed += 1;
      continue;
    }
    staleBreakdown.no_status += 1;
  }

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
        failed: row.failed,
        pending: row.pending,
        progressPct,
        updatedAt: row.updatedAt.toISOString(),
      });
    });
  }

  const alertLimit = 12;
  const alerts: Array<{
    id: string;
    type: string;
    level: "info" | "warning" | "danger";
    title: string;
    detail?: string;
    brandId?: string;
    action?: { type: string; label: string; brandId?: string };
  }> = [];

  const dueBrands = rowsWithOperationalStatus
    .filter((brand) => !brand.manualReview && brand.operationalOverdue)
    .slice(0, alertLimit);
  dueBrands.forEach((brand) => {
    const latestProgress = latestRunProgressByBrand.get(brand.id);
    const forceMode = brand.lastForceResult?.mode ?? null;
    if (
      latestProgress &&
      ["processing", "paused", "blocked"].includes(latestProgress.status)
    ) {
      alerts.push({
        id: `stale_auto_recovering:${brand.id}`,
        type: "stale_auto_recovering",
        level: "info",
        title: `Auto-recovery en curso: ${brand.name}`,
        detail: `Run ${latestProgress.runId} · ${latestProgress.completed}/${latestProgress.total} (${latestProgress.progressPct}%) · status ${latestProgress.status}.`,
        brandId: brand.id,
        action:
          latestProgress.status === "paused" || latestProgress.status === "blocked"
            ? { type: "resume_catalog", label: "Reanudar", brandId: brand.id }
            : undefined,
      });
      return;
    }

    if (forceMode === "no_refs") {
      alerts.push({
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

    alerts.push({
      id: `stale:${brand.id}`,
      type: "stale_brand",
      level: "warning",
      title: `Marca vencida: ${brand.name}`,
      detail: `Último refresh finalizado: ${brand.refresh?.lastFinishedAt ?? brand.refresh?.lastCompletedAt ?? "sin registro"}.`,
      brandId: brand.id,
      action: { type: "force_refresh", label: "Forzar refresh", brandId: brand.id },
    });
  });

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
    alerts.push({
      id: `catalog_stuck:${run.id}`,
      type: "catalog_stuck",
      level: "danger",
      title: `Catálogo atascado: ${run.brand?.name ?? "Marca"}`,
      detail: `Status ${run.status} · Última actividad ${run.updatedAt.toISOString()}`,
      brandId: run.brandId,
      action: run.brandId
        ? { type: "resume_catalog", label: "Reanudar", brandId: run.brandId }
        : undefined,
    });
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

      alerts.push({
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
      avgDiscoveryCoverage,
      avgRunSuccessRate,
      newProducts: newProducts?.count ?? 0,
      priceChanges: priceChanges?.count ?? 0,
      stockChanges: stockChanges?.count ?? 0,
      stockStatusChanges: stockStatusChanges?.count ?? 0,
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
    alerts,
  });
}
