import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

const normalizeString = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const normalizeBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

type RouteParams = {
  params: Promise<{ brandId: string }>;
};

type ProductStatsRow = {
  productCount: number;
  avgPrice: Prisma.Decimal | number | string | null;
  avgPriceCurrency: string | null;
};

type ProductPreviewRow = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  sourceUrl: string | null;
  category: string | null;
  subcategory: string | null;
  updatedAt: Date;
  minPrice: Prisma.Decimal | number | string | null;
  maxPrice: Prisma.Decimal | number | string | null;
  currency: string | null;
};

const toNumber = (value: Prisma.Decimal | number | string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { brandId } = await params;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const lastJob = await prisma.brandScrapeJob.findFirst({
    where: { brandId },
    orderBy: { createdAt: "desc" },
  });

  const [statsRow] = await prisma.$queryRaw<ProductStatsRow[]>(Prisma.sql`
    WITH product_min AS (
      SELECT p.id AS product_id, MIN(v.price)::numeric AS min_price
      FROM "products" p
      JOIN "variants" v ON v."productId" = p.id
      WHERE p."brandId" = ${brandId}
      GROUP BY p.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM "products" p WHERE p."brandId" = ${brandId}) AS "productCount",
      (SELECT AVG(min_price) FROM product_min) AS "avgPrice",
      (
        SELECT MODE() WITHIN GROUP (ORDER BY v.currency)
        FROM "variants" v
        JOIN "products" p ON p.id = v."productId"
        WHERE p."brandId" = ${brandId}
      ) AS "avgPriceCurrency"
  `);

  const previewRows = await prisma.$queryRaw<ProductPreviewRow[]>(Prisma.sql`
    WITH product_prices AS (
      SELECT
        v."productId",
        MIN(v.price)::numeric AS "minPrice",
        MAX(v.price)::numeric AS "maxPrice",
        MODE() WITHIN GROUP (ORDER BY v.currency) AS currency
      FROM "variants" v
      JOIN "products" p ON p.id = v."productId"
      WHERE p."brandId" = ${brandId}
      GROUP BY v."productId"
    )
    SELECT
      p.id,
      p.name,
      p."imageCoverUrl" AS "imageCoverUrl",
      p."sourceUrl" AS "sourceUrl",
      p.category,
      p.subcategory,
      p."updatedAt" AS "updatedAt",
      pp."minPrice" AS "minPrice",
      pp."maxPrice" AS "maxPrice",
      pp.currency
    FROM "products" p
    LEFT JOIN product_prices pp ON pp."productId" = p.id
    WHERE p."brandId" = ${brandId}
    ORDER BY p."updatedAt" DESC
    LIMIT 10
  `);

  const productStats = {
    productCount: statsRow?.productCount ?? 0,
    avgPrice: toNumber(statsRow?.avgPrice),
    avgPriceCurrency: statsRow?.avgPriceCurrency ?? null,
  };

  const previewProducts = previewRows.map((row) => ({
    id: row.id,
    name: row.name,
    imageCoverUrl: row.imageCoverUrl,
    sourceUrl: row.sourceUrl,
    category: row.category,
    subcategory: row.subcategory,
    updatedAt: row.updatedAt,
    minPrice: toNumber(row.minPrice),
    maxPrice: toNumber(row.maxPrice),
    currency: row.currency ?? productStats.avgPriceCurrency,
  }));

  return NextResponse.json({ brand, lastJob, productStats, previewProducts });
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { brandId } = await params;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if ("name" in payload) {
    const name = normalizeString(payload.name);
    if (!name) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    data.name = name;
  }

  if ("slug" in payload) {
    const rawSlug = normalizeString(payload.slug);
    if (!rawSlug) {
      return NextResponse.json({ error: "slug_invalid" }, { status: 400 });
    }
    const baseSlug = normalizeSlug(rawSlug);
    data.slug = await ensureUniqueSlug(baseSlug, brandId);
  }

  if ("siteUrl" in payload) data.siteUrl = normalizeString(payload.siteUrl);
  if ("category" in payload) data.category = normalizeString(payload.category);
  if ("productCategory" in payload) data.productCategory = normalizeString(payload.productCategory);
  if ("market" in payload) data.market = normalizeString(payload.market);
  if ("style" in payload) data.style = normalizeString(payload.style);
  if ("scale" in payload) data.scale = normalizeString(payload.scale);
  if ("ecommercePlatform" in payload) {
    data.ecommercePlatform = normalizeString(payload.ecommercePlatform);
  }
  if ("manualReview" in payload) {
    const manualReview = normalizeBoolean(payload.manualReview);
    if (manualReview === null) {
      return NextResponse.json({ error: "manualReview_invalid" }, { status: 400 });
    }
    data.manualReview = manualReview;
  }
  if ("avgPrice" in payload) data.avgPrice = normalizeNumber(payload.avgPrice);
  if ("reviewed" in payload) data.reviewed = normalizeString(payload.reviewed);
  if ("ratingStars" in payload) data.ratingStars = normalizeString(payload.ratingStars);
  if ("ratingScore" in payload) data.ratingScore = normalizeNumber(payload.ratingScore);
  if ("sourceSheet" in payload) data.sourceSheet = normalizeString(payload.sourceSheet);
  if ("sourceFile" in payload) data.sourceFile = normalizeString(payload.sourceFile);
  if ("description" in payload) data.description = normalizeString(payload.description);
  if ("logoUrl" in payload) data.logoUrl = normalizeString(payload.logoUrl);
  if ("contactPhone" in payload) data.contactPhone = normalizeString(payload.contactPhone);
  if ("contactEmail" in payload) data.contactEmail = normalizeString(payload.contactEmail);
  if ("instagram" in payload) data.instagram = normalizeString(payload.instagram);
  if ("tiktok" in payload) data.tiktok = normalizeString(payload.tiktok);
  if ("facebook" in payload) data.facebook = normalizeString(payload.facebook);
  if ("whatsapp" in payload) data.whatsapp = normalizeString(payload.whatsapp);
  if ("address" in payload) data.address = normalizeString(payload.address);
  if ("city" in payload) data.city = normalizeString(payload.city);
  if ("lat" in payload) data.lat = normalizeNumber(payload.lat);
  if ("lng" in payload) data.lng = normalizeNumber(payload.lng);
  if ("openingHours" in payload) data.openingHours = normalizeJson(payload.openingHours);
  if ("metadata" in payload) data.metadata = normalizeJson(payload.metadata);

  if ("isActive" in payload) {
    const isActive = normalizeBoolean(payload.isActive);
    if (isActive === null) {
      return NextResponse.json({ error: "isActive_invalid" }, { status: 400 });
    }
    data.isActive = isActive;
  }

  const brand = await prisma.brand.update({
    where: { id: brandId },
    data,
  });

  return NextResponse.json({ brand });
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { brandId } = await params;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
  if (!brand) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Elimina eventos asociados por brandId y tambien por productos/variantes de la marca.
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "events" e
        USING "products" p
        WHERE e."productId" = p.id AND p."brandId" = ${brandId}
      `);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "events" e
        USING "variants" v
        JOIN "products" p ON p.id = v."productId"
        WHERE e."variantId" = v.id AND p."brandId" = ${brandId}
      `);
      await tx.event.deleteMany({ where: { brandId } });

      // Limpia runs y anuncios ligados a la marca antes del delete en cascada.
      await tx.productEnrichmentRun.deleteMany({ where: { brandId } });
      await tx.announcement.deleteMany({ where: { brandId } });

      await tx.brand.delete({ where: { id: brandId } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "delete_failed";
    return NextResponse.json({ error: "delete_failed", message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
