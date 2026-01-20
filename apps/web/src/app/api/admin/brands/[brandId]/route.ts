import { NextRequest, NextResponse } from "next/server";
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

  return NextResponse.json({ brand, lastJob });
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

  await prisma.brand.update({
    where: { id: brandId },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
