import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

const toInt = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeString = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const normalizeBoolean = (value: unknown, fallback: boolean | null = null) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};

const normalizeNumber = (value: unknown, fallback: number | null = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeJson = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

const normalizeSlug = (value: string) => slugify(value).replace(/\s+/g, "-");

const ensureUniqueSlug = async (base: string, currentId?: string | null) => {
  let slug = base;
  let counter = 1;
  while (counter < 50) {
    const existing = await prisma.brand.findFirst({
      where: {
        slug,
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return slug;
    counter += 1;
    slug = `${base}-${counter}`;
  }
  return `${base}-${Date.now()}`;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = toInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(toInt(url.searchParams.get("pageSize"), 15), 100);
  const filter = url.searchParams.get("filter") ?? "all";
  const offset = (page - 1) * pageSize;

  const summaryRows = await prisma.$queryRawUnsafe<
    Array<{
      total: number;
      unprocessed: number;
      processed: number;
      queuedJobs: number;
      processingJobs: number;
      completedJobs: number;
      failedJobs: number;
    }>
  >(
    `WITH completed_brand AS (
        SELECT DISTINCT "brandId" FROM "brand_scrape_jobs" WHERE status = 'completed'
      )
      SELECT
        (SELECT COUNT(*)::int FROM "brands" WHERE "isActive" = true) AS total,
        (SELECT COUNT(*)::int FROM "brands" b WHERE b."isActive" = true AND NOT EXISTS (
          SELECT 1 FROM "brand_scrape_jobs" j WHERE j."brandId" = b.id AND j.status = 'completed'
        )) AS unprocessed,
        (SELECT COUNT(*)::int FROM completed_brand) AS processed,
        (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'queued') AS "queuedJobs",
        (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'processing') AS "processingJobs",
        (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'completed') AS "completedJobs",
        (SELECT COUNT(*)::int FROM "brand_scrape_jobs" WHERE status = 'failed') AS "failedJobs"
    `,
  );

  const summary = summaryRows[0] ?? {
    total: 0,
    unprocessed: 0,
    processed: 0,
    queuedJobs: 0,
    processingJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
  };

  const filterClause =
    filter === "unprocessed"
      ? "AND NOT EXISTS (SELECT 1 FROM \"brand_scrape_jobs\" j WHERE j.\"brandId\" = b.id AND j.status = 'completed')"
      : filter === "processed"
        ? "AND EXISTS (SELECT 1 FROM \"brand_scrape_jobs\" j WHERE j.\"brandId\" = b.id AND j.status = 'completed')"
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
      description: string | null;
      logoUrl: string | null;
      category: string | null;
      productCategory: string | null;
      market: string | null;
      style: string | null;
      scale: string | null;
      avgPrice: number | null;
      ecommercePlatform: string | null;
      manualReview: boolean;
      contactEmail: string | null;
      contactPhone: string | null;
      isActive: boolean;
      productCount: number;
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
        b.description,
        b."logoUrl",
        b.category,
        b."productCategory",
        b.market,
        b.style,
        b.scale,
        b."avgPrice",
        b."ecommercePlatform",
        b."manualReview",
        b."contactEmail",
        b."contactPhone",
        b."isActive",
        (SELECT COUNT(*)::int FROM "products" p WHERE p."brandId" = b.id) AS "productCount",
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

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const name = normalizeString(payload.name);
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const rawSlug = normalizeString(payload.slug) ?? name;
  const baseSlug = normalizeSlug(rawSlug);
  if (!baseSlug) {
    return NextResponse.json({ error: "slug_invalid" }, { status: 400 });
  }

  const slug = await ensureUniqueSlug(baseSlug);

  const data = {
    name,
    slug,
    siteUrl: normalizeString(payload.siteUrl),
    category: normalizeString(payload.category),
    productCategory: normalizeString(payload.productCategory),
    market: normalizeString(payload.market),
    style: normalizeString(payload.style),
    scale: normalizeString(payload.scale),
    ecommercePlatform: normalizeString(payload.ecommercePlatform),
    avgPrice: normalizeNumber(payload.avgPrice),
    manualReview: normalizeBoolean(payload.manualReview, false) ?? false,
    reviewed: normalizeString(payload.reviewed),
    ratingStars: normalizeString(payload.ratingStars),
    ratingScore: normalizeNumber(payload.ratingScore),
    sourceSheet: normalizeString(payload.sourceSheet),
    sourceFile: normalizeString(payload.sourceFile),
    description: normalizeString(payload.description),
    logoUrl: normalizeString(payload.logoUrl),
    contactPhone: normalizeString(payload.contactPhone),
    contactEmail: normalizeString(payload.contactEmail),
    instagram: normalizeString(payload.instagram),
    tiktok: normalizeString(payload.tiktok),
    facebook: normalizeString(payload.facebook),
    whatsapp: normalizeString(payload.whatsapp),
    address: normalizeString(payload.address),
    city: normalizeString(payload.city),
    lat: normalizeNumber(payload.lat),
    lng: normalizeNumber(payload.lng),
    openingHours: normalizeJson(payload.openingHours),
    metadata: normalizeJson(payload.metadata),
    isActive: normalizeBoolean(payload.isActive, true) ?? true,
  };

  const brand = await prisma.brand.create({ data });

  return NextResponse.json({ brand });
}
