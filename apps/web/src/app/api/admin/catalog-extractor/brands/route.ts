import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 2000) : 50;
  const platformParam = url.searchParams.get("platform");
  const platform = platformParam && platformParam !== "all" ? platformParam : null;
  const onlyNoRun = url.searchParams.get("onlyNoRun") === "true";

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      siteUrl: { not: null },
      ecommercePlatform: platform ? platform : { not: null },
      catalogRuns: onlyNoRun ? { none: {} } : undefined,
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      siteUrl: true,
      ecommercePlatform: true,
      metadata: true,
      _count: { select: { products: true } },
    },
  });

  const brandIds = brands.map((brand) => brand.id);
  const runs = await prisma.catalogRun.findMany({
    where: { brandId: { in: brandIds } },
    orderBy: { updatedAt: "desc" },
  });
  const runByBrand = new Map<string, string>();
  runs.forEach((run) => {
    if (!runByBrand.has(run.brandId)) runByBrand.set(run.brandId, run.id);
  });

  const runIds = Array.from(new Set(runByBrand.values()));
  const counts = runIds.length
    ? await prisma.catalogItem.groupBy({
        by: ["runId", "status"],
        where: { runId: { in: runIds } },
        _count: { _all: true },
      })
    : [];
  const countMap = new Map<string, Map<string, number>>();
  counts.forEach((row) => {
    const runMap = countMap.get(row.runId) ?? new Map<string, number>();
    runMap.set(row.status, row._count._all);
    countMap.set(row.runId, runMap);
  });

  const runMetaMap = new Map(runs.map((run) => [run.id, run]));

  const brandsWithState = brands.map((brand) => {
    const metadata =
      brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
        ? (brand.metadata as Record<string, unknown>)
        : {};
    const finished =
      metadata.catalog_extract_finished &&
      typeof metadata.catalog_extract_finished === "object" &&
      !Array.isArray(metadata.catalog_extract_finished);
    const runId = runByBrand.get(brand.id) ?? null;
    const run = runId ? runMetaMap.get(runId) : null;
    const countsForRun = runId ? countMap.get(runId) : null;
    const completed = countsForRun?.get("completed") ?? 0;
    const failed = countsForRun?.get("failed") ?? 0;
    const total = run?.totalItems ?? (countsForRun ? Array.from(countsForRun.values()).reduce((a, b) => a + b, 0) : 0);
    const pending = Math.max(0, total - completed - failed);
    const runState = run
      ? {
          status: run.status,
          runId: run.id,
          cursor: completed,
          total,
          completed,
          failed,
          pending,
          lastError: run.lastError ?? null,
          blockReason: run.blockReason ?? null,
          lastUrl: run.lastUrl ?? null,
          lastStage: run.lastStage ?? null,
          consecutiveErrors: run.consecutiveErrors ?? 0,
        }
      : null;
    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
      _count: brand._count,
      runState,
      finished,
    };
  });

  const visibleBrands = brandsWithState.filter((brand) => !brand.finished);
  const nextBrand = visibleBrands.find((brand) => brand.runState?.status !== "completed") ?? null;

  return NextResponse.json({ brands: visibleBrands, nextBrandId: nextBrand?.id ?? null });
}
