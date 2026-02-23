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

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    return {
      id: brand.id,
      name: brand.name,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
      manualReview: brand.manualReview,
      productCount: brand._count.products,
      refresh,
      due: isBrandDueForRefresh(metadata, now, config),
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

  const isQualityFresh = (brand: (typeof brandRows)[number]) => {
    if (!isAutoEligible(brand)) return false;
    const completedAt = getLastCompletedAt(brand);
    return completedAt ? completedAt >= windowStart : false;
  };

  const autoEligibleBrands = brandRows.filter(isAutoEligible).length;
  const operationalFreshBrands = brandRows.filter(isOperationalFresh).length;
  const qualityFreshBrands = brandRows.filter(isQualityFresh).length;
  const operationalStaleBrands = Math.max(0, autoEligibleBrands - operationalFreshBrands);
  const qualityStaleBrands = Math.max(0, autoEligibleBrands - qualityFreshBrands);

  const staleBreakdown = {
    processing: 0,
    failed: 0,
    no_status: 0,
    manual_review: 0,
  };

  for (const brand of brandRows) {
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
  const windowBrands = brandRows.filter((brand) => {
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

  const dueBrands = brandRows.filter((brand) => !brand.manualReview && brand.due).slice(0, alertLimit);
  dueBrands.forEach((brand) => {
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
        ? { type: "resume_enrichment", label: isQueuedByRefresh ? "Procesar" : "Reanudar", brandId: run.brandId }
        : undefined,
    });
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
      avgDiscoveryCoverage,
      avgRunSuccessRate,
      newProducts: newProducts?.count ?? 0,
      priceChanges: priceChanges?.count ?? 0,
      stockChanges: stockChanges?.count ?? 0,
      stockStatusChanges: stockStatusChanges?.count ?? 0,
    },
    brands: brandRows,
    alerts,
  });
}
