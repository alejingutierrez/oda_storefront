import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import {
  CURATION_MAX_PRODUCT_IDS,
  CurationValidationError,
  applyCurationChanges,
  coerceRawChanges,
  normalizeCurationChanges,
  normalizeProductIds,
} from "@/lib/product-curation/apply-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const productIdsRaw = body && typeof body === "object" ? (body as Record<string, unknown>).productIds : [];
    const productIds = normalizeProductIds(productIdsRaw);

    if (!productIds.length) {
      return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
    }
    if (productIds.length > CURATION_MAX_PRODUCT_IDS) {
      return NextResponse.json(
        { error: "too_many_product_ids", limit: CURATION_MAX_PRODUCT_IDS },
        { status: 400 },
      );
    }

    const rawChanges = coerceRawChanges(body);
    const changes = await normalizeCurationChanges(rawChanges);

    const actorEmail = typeof (admin as { email?: unknown }).email === "string" ? (admin as { email: string }).email : null;
    const actorUserId = typeof (admin as { id?: unknown }).id === "string" ? (admin as { id: string }).id : null;

    const result = await applyCurationChanges({
      productIds,
      changes,
      actorEmail,
      actorUserId,
      source: "bulk_modal",
    });

    if (result.globalUpdatedCount > 0) {
      invalidateCatalogCache();
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CurationValidationError) {
      return NextResponse.json(
        {
          error: error.code,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.status },
      );
    }

    console.error("product-curation.bulk.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
