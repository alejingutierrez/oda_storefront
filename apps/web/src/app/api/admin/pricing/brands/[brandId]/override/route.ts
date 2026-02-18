import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import { toInputJson } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteParams = {
  params: Promise<{ brandId: string }>;
};

const readObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { brandId } = await params;
  if (!brandId) return NextResponse.json({ error: "missing_brand" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const nextOverrideRaw = "currency_override" in body ? body.currency_override : undefined;
  const nextOverride =
    nextOverrideRaw === null
      ? null
      : typeof nextOverrideRaw === "string" && nextOverrideRaw.trim()
        ? nextOverrideRaw.trim().toUpperCase()
        : undefined;

  if (nextOverride !== "USD" && nextOverride !== null) {
    return NextResponse.json({ error: "currency_override_invalid" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, metadata: true } });
  if (!brand) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existingMetadata = readObject(brand.metadata) ?? {};
  const pricing = { ...(readObject(existingMetadata.pricing) ?? {}) };
  const now = new Date().toISOString();

  if (nextOverride === "USD") {
    pricing.currency_override = "USD";
    pricing.currency_override_source = "manual";
    pricing.currency_override_applied_at = now;
    pricing.currency_override_reason = "manual_admin";
    // Keep previous stats if any; manual override is intentionally explicit.
    if (!pricing.currency_override_stats) pricing.currency_override_stats = null;
  } else {
    pricing.currency_override = null;
    pricing.currency_override_source = null;
    pricing.currency_override_applied_at = null;
    pricing.currency_override_reason = null;
    pricing.currency_override_stats = null;
  }

  const nextMetadata = { ...existingMetadata, pricing };

  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: toInputJson(nextMetadata) },
  });

  invalidateCatalogCache();

  return NextResponse.json({ ok: true });
}

