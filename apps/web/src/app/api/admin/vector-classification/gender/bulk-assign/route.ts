import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const VALID_GENDERS = ["Mujer", "Hombre", "Unisex", "Infantil"];

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const productIds = Array.isArray(body?.productIds) ? body.productIds.filter((id: unknown) => typeof id === "string" && id.trim()) : [];
  const gender = typeof body?.gender === "string" ? body.gender.trim() : "";

  if (productIds.length === 0) {
    return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
  }
  if (productIds.length > 500) {
    return NextResponse.json({ error: "too_many_products" }, { status: 400 });
  }
  if (!VALID_GENDERS.includes(gender)) {
    return NextResponse.json({ error: "invalid_gender" }, { status: 400 });
  }

  try {
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        WITH updated AS (
          UPDATE products
          SET gender = ${gender}, "updatedAt" = now()
          WHERE id = ANY(${productIds}::text[])
            AND "imageCoverUrl" IS NOT NULL
          RETURNING id
        )
        SELECT COUNT(*)::bigint AS count FROM updated
      `,
    );

    const updatedCount = Number(result[0]?.count ?? 0);

    return NextResponse.json({ ok: true, updatedCount });
  } catch (error) {
    console.error("[gender/bulk-assign] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
