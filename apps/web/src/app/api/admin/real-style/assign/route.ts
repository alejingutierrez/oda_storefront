import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRealStyleKey } from "@/lib/real-style/constants";
import {
  getRealStyleSummary,
  isEligibleRealStyleProduct,
} from "@/lib/real-style/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const toJsonValue = (value: Record<string, unknown>): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const productId = typeof body?.productId === "string" ? body.productId.trim() : "";
  const realStyleRaw = typeof body?.realStyle === "string" ? body.realStyle.trim() : "";
  const includeSummaryRaw = body?.includeSummary;
  const includeSummary =
    includeSummaryRaw == null
      ? true
      : typeof includeSummaryRaw === "boolean"
        ? includeSummaryRaw
        : null;

  if (!productId) {
    return NextResponse.json({ error: "missing_product_id" }, { status: 400 });
  }

  if (!isRealStyleKey(realStyleRaw)) {
    return NextResponse.json({ error: "invalid_real_style" }, { status: 400 });
  }
  if (includeSummary == null) {
    return NextResponse.json({ error: "invalid_include_summary" }, { status: 400 });
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, realStyle: true, metadata: true },
    });

    if (!product) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (product.realStyle) {
      const summary = includeSummary ? await getRealStyleSummary() : undefined;
      return NextResponse.json(
        {
          error: "already_assigned",
          conflict: true,
          currentRealStyle: product.realStyle,
          ...(summary ? { summary } : {}),
        },
        { status: 409 },
      );
    }

    const eligible = await isEligibleRealStyleProduct(productId);
    if (!eligible) {
      const summary = includeSummary ? await getRealStyleSummary() : undefined;
      return NextResponse.json(
        {
          error: "product_not_eligible",
          conflict: true,
          ...(summary ? { summary } : {}),
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const actorEmail = typeof (admin as { email?: unknown }).email === "string"
      ? (admin as { email: string }).email
      : null;
    const actorUserId = typeof (admin as { id?: unknown }).id === "string"
      ? (admin as { id: string }).id
      : null;

    const metadata = asRecord(product.metadata) ?? {};
    const existingHuman = asRecord(metadata.enrichment_human) ?? {};
    const existingChanges = Array.isArray(existingHuman.changes)
      ? existingHuman.changes.filter((entry) => Boolean(entry) && typeof entry === "object")
      : [];

    const nextChange = {
      field: "real_style",
      op: "replace",
      value: realStyleRaw,
      source: "real_style_board",
      at: nowIso,
      by: actorEmail,
      byUserId: actorUserId,
    };

    const nextHuman = {
      ...existingHuman,
      source: "real_style_board",
      updatedAt: nowIso,
      updatedBy: actorEmail,
      updatedByUserId: actorUserId,
      real_style: {
        value: realStyleRaw,
        assignedAt: nowIso,
        assignedBy: actorEmail,
        assignedByUserId: actorUserId,
      },
      changes: [...existingChanges, nextChange].slice(-50),
    };

    const nextMetadata = {
      ...metadata,
      enrichment_human: nextHuman,
    };

    const updated = await prisma.product.updateMany({
      where: {
        id: productId,
        realStyle: null,
      },
      data: {
        realStyle: realStyleRaw,
        metadata: toJsonValue(nextMetadata),
      },
    });

    if (updated.count === 0) {
      const summary = includeSummary ? await getRealStyleSummary() : undefined;
      return NextResponse.json(
        {
          error: "assign_conflict",
          conflict: true,
          ...(summary ? { summary } : {}),
        },
        { status: 409 },
      );
    }

    const summary = includeSummary ? await getRealStyleSummary() : undefined;

    return NextResponse.json({
      ok: true,
      assigned: {
        productId,
        realStyle: realStyleRaw,
        assignedAt: nowIso,
      },
      ...(summary ? { summary } : {}),
    });
  } catch (error) {
    console.error("real-style.assign.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
