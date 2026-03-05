import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import {
  CurationValidationError,
  applyCurationChanges,
  normalizeProductIds,
} from "@/lib/product-curation/apply-engine";
import type { ParsedCurationChange } from "@/lib/product-curation/apply-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

type BadgeAction = "set_top_pick" | "set_favorite" | "clear";

const isValidAction = (value: unknown): value is BadgeAction =>
  value === "set_top_pick" || value === "set_favorite" || value === "clear";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const productIds = normalizeProductIds(payload.productIds);
    if (!productIds.length) {
      return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
    }
    if (productIds.length > 100) {
      return NextResponse.json({ error: "too_many_product_ids", limit: 100 }, { status: 400 });
    }

    const action = payload.action;
    if (!isValidAction(action)) {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }

    const startPriorityRaw = payload.startPriority;
    let startPriority: number | null = null;
    if (startPriorityRaw !== undefined && startPriorityRaw !== null) {
      const parsed = Number(startPriorityRaw);
      if (Number.isFinite(parsed) && parsed >= 1) {
        startPriority = Math.floor(parsed);
      }
    }

    let change: ParsedCurationChange;
    if (action === "clear") {
      change = {
        field: "editorialBadge",
        op: "clear",
        kind: "editorial",
        badgeKind: null,
        startPriority: null,
      };
    } else {
      change = {
        field: "editorialBadge",
        op: "replace",
        kind: "editorial",
        badgeKind: action === "set_top_pick" ? "top_pick" : "favorite",
        startPriority,
      };
    }

    const actorEmail = typeof (admin as { email?: unknown }).email === "string" ? (admin as { email: string }).email : null;
    const actorUserId = typeof (admin as { id?: unknown }).id === "string" ? (admin as { id: string }).id : null;

    const result = await applyCurationChanges({
      productIds,
      changes: [change],
      actorEmail,
      actorUserId,
      source: "real_style_filter",
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

    console.error("real-style-filter.badge.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
