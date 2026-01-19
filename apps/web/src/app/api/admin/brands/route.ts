import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

const toInt = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = toInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(toInt(url.searchParams.get("pageSize"), 25), 100);
  const filter = url.searchParams.get("filter") ?? "all";
  const offset = (page - 1) * pageSize;

  const summaryRows = await prisma.$queryRawUnsafe<
    Array<{
      total: number;
      unprocessed: number;
      queued: number;
      processing: number;
      completed: number;
      failed: number;
    }>
  >(
    `SELECT
      (SELECT COUNT(*)::int FROM "brands" WHERE "isActive" = true) AS total,
      (SELECT COUNT(*)::int FROM "brands" b WHERE b."isActive" = true AND NOT EXISTS (
        SELECT 1 FROM "brand_scrape_jobs" j WHERE j."brandId" = b.id AND j.status = 'completed'
      )) AS unprocessed,
      (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'queued') AS queued,
      (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'processing') AS processing,
      (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'completed') AS completed,
      (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'failed') AS failed
    `,
  );

  const summary = summaryRows[0] ?? {
    total: 0,
    unprocessed: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  const filterClause =
    filter === "unprocessed"
      ? "AND NOT EXISTS (SELECT 1 FROM \"brand_scrape_jobs\" j WHERE j.\"brandId\" = b.id AND j.status = 'completed')"
      : "";

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM "brands" b WHERE b."isActive" = true ${filterClause}`,
  );

  const totalCount = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const brands = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      name: string;
      slug: string;
      city: string | null;
      siteUrl: string | null;
      instagram: string | null;
      isActive: boolean;
      lastStatus: string | null;
      lastCreatedAt: string | null;
      lastFinishedAt: string | null;
      lastResult: unknown | null;
      hasCompleted: boolean | null;
    }>
  >(
    `WITH latest_job AS (
        SELECT DISTINCT ON ("brandId") * FROM "brand_scrape_jobs" ORDER BY "brandId", "createdAt" DESC
      ), completed_brand AS (
        SELECT DISTINCT "brandId" FROM "brand_scrape_jobs" WHERE status = 'completed'
      )
      SELECT
        b.id,
        b.name,
        b.slug,
        b.city,
        b."siteUrl",
        b.instagram,
        b."isActive",
        lj.status as "lastStatus",
        lj."createdAt" as "lastCreatedAt",
        lj."finishedAt" as "lastFinishedAt",
        lj.result as "lastResult",
        (cb."brandId" IS NOT NULL) as "hasCompleted"
      FROM "brands" b
      LEFT JOIN latest_job lj ON lj."brandId" = b.id
      LEFT JOIN completed_brand cb ON cb."brandId" = b.id
      WHERE b."isActive" = true ${filterClause}
      ORDER BY b.name ASC
      LIMIT ${pageSize} OFFSET ${offset}`,
  );

  return NextResponse.json({
    page,
    pageSize,
    totalPages,
    totalCount,
    summary,
    brands,
  });
}
