import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ReviewRow = {
  id: string;
  status: string;
  productId: string;
  fromCategory: string | null;
  fromSubcategory: string | null;
  fromGender: string | null;
  toCategory: string | null;
  toSubcategory: string | null;
  toGender: string | null;
  confidence: number | null;
  reasons: unknown;
  source: string | null;
  runKey: string | null;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 100);
};

const toNullableText = (value: unknown) => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 2000) : null;
};

const resolveAdminUserId = (admin: unknown): string | null => {
  if (!admin || typeof admin !== "object") return null;
  if (!("id" in admin)) return null;
  const id = (admin as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { reviewId } = await context.params;
  if (!reviewId) {
    return NextResponse.json({ error: "reviewId is required" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { note?: string } | null;
  const note = toNullableText(body?.note);

  const rows = await prisma.$queryRaw<ReviewRow[]>(Prisma.sql`
    SELECT
      r.id,
      r."status",
      r."productId",
      r."fromCategory",
      r."fromSubcategory",
      r."fromGender",
      r."toCategory",
      r."toSubcategory",
      r."toGender",
      r."confidence",
      r."reasons",
      r."source",
      r."runKey"
    FROM "taxonomy_remap_reviews" r
    WHERE r.id = ${reviewId}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "review not found" }, { status: 404 });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `review is already ${row.status}` },
      { status: 409 },
    );
  }

  if (!row.toCategory && !row.toSubcategory && !row.toGender) {
    return NextResponse.json(
      { error: "review has no proposed changes" },
      { status: 422 },
    );
  }

  const decidedByUserId = resolveAdminUserId(admin);
  const decisionPayload = {
    review_id: row.id,
    source: row.source,
    run_key: row.runKey,
    from: {
      category: row.fromCategory,
      subcategory: row.fromSubcategory,
      gender: row.fromGender,
    },
    to: {
      category: row.toCategory,
      subcategory: row.toSubcategory,
      gender: row.toGender,
    },
    confidence: row.confidence,
    reasons: toStringArray(row.reasons),
    decided_at: new Date().toISOString(),
    decided_by: decidedByUserId,
    decision: "accepted",
    note,
  };

  await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`
      UPDATE "products"
      SET
        "category" = COALESCE(${row.toCategory}, "category"),
        "subcategory" = COALESCE(${row.toSubcategory}, "subcategory"),
        "gender" = COALESCE(${row.toGender}, "gender"),
        "metadata" = jsonb_set(
          CASE WHEN jsonb_typeof("metadata") = 'object' THEN "metadata" ELSE '{}'::jsonb END,
          '{taxonomy_remap,last_review}',
          ${JSON.stringify(decisionPayload)}::jsonb,
          true
        ),
        "updatedAt" = NOW()
      WHERE id = ${row.productId}
    `),
    prisma.$executeRaw(Prisma.sql`
      UPDATE "taxonomy_remap_reviews"
      SET
        "status" = 'accepted',
        "decisionNote" = ${note},
        "decisionError" = NULL,
        "decidedAt" = NOW(),
        "decidedByUserId" = ${decidedByUserId},
        "updatedAt" = NOW()
      WHERE id = ${row.id}
    `),
  ]);

  return NextResponse.json({
    ok: true,
    reviewId: row.id,
    productId: row.productId,
    status: "accepted",
  });
}
