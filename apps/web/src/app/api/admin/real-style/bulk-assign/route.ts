import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRealStyleKey, type RealStyleKey } from "@/lib/real-style/constants";
import { getRealStyleSummary } from "@/lib/real-style/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const productIds = Array.isArray(body?.productIds)
    ? body.productIds.filter((id: unknown) => typeof id === "string" && id.trim())
    : [];
  const realStyleRaw = typeof body?.realStyle === "string" ? body.realStyle.trim() : "";
  const includeSummary = body?.includeSummary !== false;

  if (productIds.length === 0) {
    return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
  }
  if (productIds.length > 500) {
    return NextResponse.json({ error: "too_many_products" }, { status: 400 });
  }
  if (!isRealStyleKey(realStyleRaw)) {
    return NextResponse.json({ error: "invalid_real_style" }, { status: 400 });
  }

  try {
    /* Atomic bulk assign — only updates products where real_style IS NULL */
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        WITH candidates AS (
          SELECT p.id
          FROM products p
          WHERE p.id = ANY(${productIds}::text[])
            AND p."real_style" IS NULL
            AND p."hasInStock" = true
            AND p."imageCoverUrl" IS NOT NULL
            AND (p."metadata" -> 'enrichment') IS NOT NULL
          FOR UPDATE SKIP LOCKED
        ),
        updated AS (
          UPDATE products p
          SET
            "real_style" = ${realStyleRaw},
            "updatedAt" = now()
          FROM candidates c
          WHERE p.id = c.id
          RETURNING p.id
        )
        SELECT COUNT(*)::bigint AS count FROM updated
      `,
    );

    const assignedCount = Number(result[0]?.count ?? 0);
    const skippedCount = productIds.length - assignedCount;

    const summary = includeSummary ? await getRealStyleSummary() : undefined;

    return NextResponse.json({
      ok: true,
      assignedCount,
      skippedCount,
      ...(summary ? { summary } : {}),
    });
  } catch (error) {
    const errorCode =
      typeof error === "object" && error && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;
    const isBusyError = errorCode === "55P03" || errorCode === "57014";
    console.error("[real-style/bulk-assign] POST error:", { errorCode, error });
    if (isBusyError) {
      return NextResponse.json({ error: "assign_busy", conflict: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
