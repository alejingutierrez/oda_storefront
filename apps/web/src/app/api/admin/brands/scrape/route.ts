import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { recoverStaleBrandScrapeJobs } from "@/lib/brand-scrape-queue";

export const runtime = "nodejs";

const ALLOWED_COUNTS = new Set([1, 5, 10, 25, 50]);

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");

  const recoveredStale = await recoverStaleBrandScrapeJobs();

  const counts = await prisma.brandScrapeJob.groupBy({
    by: ["status"],
    _count: true,
  });

  const summary = counts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count;
    return acc;
  }, {});

  const queued = await prisma.brandScrapeJob.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 8,
    include: {
      brand: { select: { id: true, name: true, slug: true } },
    },
  });

  const processing = await prisma.brandScrapeJob.findFirst({
    where: { status: "processing" },
    orderBy: { startedAt: "desc" },
    include: {
      brand: { select: { id: true, name: true, slug: true } },
    },
  });

  const recent = await prisma.brandScrapeJob.findMany({
    where: { status: { in: ["completed", "failed"] } },
    orderBy: { finishedAt: "desc" },
    take: 6,
    include: {
      brand: { select: { id: true, name: true, slug: true } },
    },
  });

  let batchCounts: Record<string, number> | null = null;
  if (batchId) {
    const batchRows = await prisma.brandScrapeJob.groupBy({
      by: ["status"],
      where: { batchId },
      _count: true,
    });
    batchCounts = batchRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count;
      return acc;
    }, {});
  }

  return NextResponse.json({
    counts: summary,
    queued,
    processing,
    recent,
    recoveredStale,
    batchId,
    batchCounts,
  });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const count = typeof body?.count === "number" ? body.count : 0;

  if (!ALLOWED_COUNTS.has(count)) {
    return NextResponse.json({ error: "invalid_count" }, { status: 400 });
  }

  const brands = await prisma.$queryRaw<
    Array<{ id: string; name: string; slug: string }>
  >(Prisma.sql`
    WITH active_brands AS (
        SELECT id, name, slug, "updatedAt"
        FROM "brands"
        WHERE "isActive" = true
      ),
      completed_brand AS (
        SELECT DISTINCT "brandId"
        FROM "brand_scrape_jobs"
        WHERE status = 'completed'
      ),
      inflight_brand AS (
        SELECT DISTINCT "brandId"
        FROM "brand_scrape_jobs"
        WHERE status IN ('queued', 'processing')
      )
      SELECT b.id, b.name, b.slug
      FROM active_brands b
      LEFT JOIN completed_brand cb ON cb."brandId" = b.id
      LEFT JOIN inflight_brand ib ON ib."brandId" = b.id
      WHERE cb."brandId" IS NULL
        AND ib."brandId" IS NULL
      ORDER BY b."updatedAt" ASC
      LIMIT ${count}
  `);

  if (!brands.length) {
    return NextResponse.json({ batchId: null, enqueued: 0, brands: [] });
  }

  const batchId = crypto.randomUUID();
  await prisma.brandScrapeJob.createMany({
    data: brands.map((brand) => ({
      brandId: brand.id,
      batchId,
      status: "queued",
    })),
  });

  return NextResponse.json({ batchId, enqueued: brands.length, brands });
}
