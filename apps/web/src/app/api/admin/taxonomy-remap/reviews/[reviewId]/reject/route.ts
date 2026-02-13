import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runTaxonomyAutoReseedBatch } from "@/lib/taxonomy-remap/auto-reseed";

export const runtime = "nodejs";
export const maxDuration = 300;

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

type ReviewState = {
  id: string;
  status: string;
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

  const existing = await prisma.$queryRaw<ReviewState[]>(Prisma.sql`
    SELECT id, "status"
    FROM "taxonomy_remap_reviews"
    WHERE id = ${reviewId}
    LIMIT 1
  `);

  const row = existing[0];
  if (!row) {
    return NextResponse.json({ error: "review not found" }, { status: 404 });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `review is already ${row.status}` },
      { status: 409 },
    );
  }

  const decidedByUserId = resolveAdminUserId(admin);

  await prisma.$executeRaw(Prisma.sql`
    UPDATE "taxonomy_remap_reviews"
    SET
      "status" = 'rejected',
      "decisionNote" = ${note},
      "decisionError" = NULL,
      "decidedAt" = NOW(),
      "decidedByUserId" = ${decidedByUserId},
      "updatedAt" = NOW()
    WHERE id = ${reviewId}
  `);

  let autoReseed = null;
  try {
    autoReseed = await runTaxonomyAutoReseedBatch({ trigger: "decision" });
  } catch (error) {
    autoReseed = {
      triggered: false,
      reason: "error",
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }

  return NextResponse.json({
    ok: true,
    reviewId,
    status: "rejected",
    autoReseed,
  });
}
