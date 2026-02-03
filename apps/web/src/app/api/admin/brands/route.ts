import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { profileBrandTechnology } from "@/lib/brand-tech-profiler";
import { normalizeSiteUrl } from "@/lib/brand-site";

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

const normalizeListParam = (values: string[]) => {
  const items = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(items));
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
  const categories = normalizeListParam(url.searchParams.getAll("category"));
  const sort = url.searchParams.get("sort");
  const order = url.searchParams.get("order");
  const offset = (page - 1) * pageSize;

  const categoryFilter = categories.length
    ? Prisma.sql`AND b."category" IN (${Prisma.join(categories)})`
    : Prisma.sql``;
  const activeBrandWhere = categories.length
    ? Prisma.sql`WHERE "isActive" = true AND "category" IN (${Prisma.join(categories)})`
    : Prisma.sql`WHERE "isActive" = true`;
  const filterClause =
    filter === "unprocessed"
      ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "brand_scrape_jobs" j WHERE j."brandId" = b.id AND j.status = 'completed')`
      : filter === "processed"
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "brand_scrape_jobs" j WHERE j."brandId" = b.id AND j.status = 'completed')`
        : Prisma.sql``;

  const sortByProductCount = sort === "productCount";
  const sortOrder = order === "asc" || order === "desc" ? order : "desc";
  const orderClause = sortByProductCount
    ? sortOrder === "asc"
      ? Prisma.sql`ORDER BY "productCount" ASC, b.name ASC`
      : Prisma.sql`ORDER BY "productCount" DESC, b.name ASC`
    : Prisma.sql`ORDER BY b.name ASC`;

  const summaryRows = await prisma.$queryRaw<
    Array<{
      total: number;
      unprocessed: number;
      processed: number;
      unprocessedQueued: number;
      unprocessedFailed: number;
      unprocessedNoJobs: number;
      unprocessedManualReview: number;
      unprocessedCloudflare: number;
      queuedJobs: number;
      processingJobs: number;
      completedJobs: number;
      failedJobs: number;
    }>
  >(Prisma.sql`
    WITH active_brands AS (
        SELECT id, "manualReview", metadata
        FROM "brands"
        ${activeBrandWhere}
      ),
      completed_brand AS (
        SELECT DISTINCT j."brandId"
        FROM "brand_scrape_jobs" j
        INNER JOIN active_brands b ON b.id = j."brandId"
        WHERE j.status = 'completed'
      ),
      latest_job AS (
        SELECT DISTINCT ON (j."brandId") j."brandId", j.status
        FROM "brand_scrape_jobs" j
        INNER JOIN active_brands b ON b.id = j."brandId"
        ORDER BY j."brandId", j."createdAt" DESC
      ),
      unprocessed AS (
        SELECT b.id, b."manualReview", b.metadata, lj.status AS "latestStatus"
        FROM active_brands b
        LEFT JOIN completed_brand cb ON cb."brandId" = b.id
        LEFT JOIN latest_job lj ON lj."brandId" = b.id
        WHERE cb."brandId" IS NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM active_brands) AS total,
        (SELECT COUNT(*)::int FROM completed_brand) AS processed,
        (SELECT COUNT(*)::int FROM unprocessed) AS unprocessed,
        (SELECT COUNT(*)::int FROM unprocessed WHERE "latestStatus" = 'queued') AS "unprocessedQueued",
        (SELECT COUNT(*)::int FROM unprocessed WHERE "latestStatus" = 'failed') AS "unprocessedFailed",
        (SELECT COUNT(*)::int FROM unprocessed WHERE "latestStatus" IS NULL) AS "unprocessedNoJobs",
        (SELECT COUNT(*)::int FROM unprocessed WHERE COALESCE("manualReview", false) = true) AS "unprocessedManualReview",
        (SELECT COUNT(*)::int FROM unprocessed
          WHERE COALESCE((metadata -> 'tech_profile' -> 'risks')::jsonb, '[]'::jsonb) @> '["cloudflare"]'::jsonb
        ) AS "unprocessedCloudflare",
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
    unprocessedQueued: 0,
    unprocessedFailed: 0,
    unprocessedNoJobs: 0,
    unprocessedManualReview: 0,
    unprocessedCloudflare: 0,
    queuedJobs: 0,
    processingJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
  };

  const countRows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "brands" b
    WHERE b."isActive" = true
    ${categoryFilter}
    ${filterClause}
  `);

  const totalCount = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const brands = await prisma.$queryRaw<
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
  >(Prisma.sql`
    WITH latest_job AS (
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
      WHERE b."isActive" = true
      ${categoryFilter}
      ${filterClause}
      ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
  `);

  const categoryRows = await prisma.$queryRaw<Array<{ category: string }>>(Prisma.sql`
    SELECT DISTINCT TRIM("category") AS category
    FROM "brands"
    WHERE "isActive" = true
      AND "category" IS NOT NULL
      AND TRIM("category") <> ''
    ORDER BY TRIM("category") ASC
  `);
  const availableCategories = categoryRows.map((row) => row.category).filter(Boolean);

  return NextResponse.json({
    page,
    pageSize,
    totalPages,
    totalCount,
    summary,
    brands,
    categories: availableCategories,
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

  const siteInfo = normalizeSiteUrl(payload.siteUrl);
  if (payload.siteUrl && !siteInfo) {
    return NextResponse.json({ error: "URL de sitio inválida." }, { status: 400 });
  }
  const siteUrl = siteInfo?.normalized ?? null;
  if (siteInfo?.host) {
    const existing = await prisma.brand.findMany({
      where: { siteUrl: { not: null } },
      select: { id: true, name: true, siteUrl: true, isActive: true },
    });
    const duplicate = existing.find((brand) => {
      const host = normalizeSiteUrl(brand.siteUrl)?.host;
      return host === siteInfo.host;
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error: `Ya existe una marca con el dominio ${siteInfo.host}.`,
          existing: {
            id: duplicate.id,
            name: duplicate.name,
            siteUrl: duplicate.siteUrl,
            isActive: duplicate.isActive,
          },
        },
        { status: 409 },
      );
    }
  }
  const skipTechProfile = normalizeBoolean(payload.skipTechProfile, false) ?? false;
  let techProfile: Awaited<ReturnType<typeof profileBrandTechnology>> | null = null;
  if (siteUrl && !skipTechProfile) {
    techProfile = await profileBrandTechnology({ siteUrl } as any);
    const deleteSignals = new Set([
      "social",
      "bot_protection",
      "unreachable",
      "parked_domain",
      "landing_no_store",
      "no_pdp_candidates",
    ]);
    if (techProfile.platform === "unknown" || techProfile.risks?.some((risk) => deleteSignals.has(risk))) {
      return NextResponse.json(
        {
          error: "tech_platform_unknown",
          message: "Marca rechazada: tecnologia desconocida o no procesable.",
          profile: techProfile,
        },
        { status: 400 },
      );
    }
  }

  const data = {
    name,
    slug,
    siteUrl,
    category: normalizeString(payload.category),
    productCategory: normalizeString(payload.productCategory),
    market: normalizeString(payload.market),
    style: normalizeString(payload.style),
    scale: normalizeString(payload.scale),
    ecommercePlatform: techProfile?.platform ?? normalizeString(payload.ecommercePlatform),
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
    metadata: techProfile
      ? {
          ...(normalizeJson(payload.metadata) ?? {}),
          tech_profile: {
            ...techProfile,
            capturedAt: new Date().toISOString(),
          },
        }
      : normalizeJson(payload.metadata),
    isActive: normalizeBoolean(payload.isActive, true) ?? true,
  };

  const brand = await prisma.brand.create({ data });

  return NextResponse.json({ brand });
}
