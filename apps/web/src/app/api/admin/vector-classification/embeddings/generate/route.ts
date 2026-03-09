import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateEmbeddingsForBatch } from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      batchSize?: number;
    } | null;

    const batchSize = Math.min(
      2000,
      Math.max(1, Math.floor(Number(body?.batchSize) || 500)),
    );

    // Find products without embeddings
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id
      FROM products p
      LEFT JOIN product_embeddings pe ON pe."productId" = p.id
      WHERE pe.id IS NULL
        AND p.status = 'active'
        AND p."imageCoverUrl" IS NOT NULL
      LIMIT ${batchSize}
    `);

    const productIds = rows.map((r) => r.id);

    if (productIds.length === 0) {
      return NextResponse.json({ ok: true, generated: 0, remaining: 0 });
    }

    const generated = await generateEmbeddingsForBatch(productIds);

    // Count remaining products without embeddings
    const remainingRows = await prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) as count
        FROM products p
        LEFT JOIN product_embeddings pe ON pe."productId" = p.id
        WHERE pe.id IS NULL
          AND p.status = 'active'
          AND p."imageCoverUrl" IS NOT NULL
      `,
    );
    const remaining = Number(remainingRows[0]?.count ?? 0);

    return NextResponse.json({ ok: true, generated, remaining });
  } catch (error) {
    console.error("[vector-classification/embeddings/generate] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
