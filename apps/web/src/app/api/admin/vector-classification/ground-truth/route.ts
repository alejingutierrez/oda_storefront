import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const subcategory = searchParams.get("subcategory");
    if (!subcategory) {
      return NextResponse.json(
        { error: "subcategory is required" },
        { status: 400 },
      );
    }

    const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("limit")) || 40)));
    const offset = (page - 1) * limit;

    const products = await prisma.$queryRaw<
      Array<{
        id: string;
        productId: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        category: string | null;
        subcategory: string | null;
        gender: string | null;
        confirmedAt: Date;
      }>
    >(Prisma.sql`
      SELECT
        gt.id,
        gt."productId",
        p.name,
        p."imageCoverUrl",
        b.name as "brandName",
        gt.category,
        gt.subcategory,
        gt.gender,
        gt."createdAt" as "confirmedAt"
      FROM ground_truth_products gt
      JOIN products p ON p.id = gt."productId"
      JOIN brands b ON b.id = p."brandId"
      WHERE gt.subcategory = ${subcategory}
        AND gt."isActive" = true
      ORDER BY gt."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) as total
        FROM ground_truth_products gt
        WHERE gt.subcategory = ${subcategory}
          AND gt."isActive" = true
      `,
    );
    const total = Number(countRows[0]?.total ?? 0);

    return NextResponse.json({
      products,
      total,
      page,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("[vector-classification/ground-truth] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      productId?: string;
      subcategory?: string;
      category?: string;
      gender?: string;
    } | null;

    if (!body?.productId || !body.subcategory || !body.category) {
      return NextResponse.json(
        { error: "productId, subcategory, and category are required" },
        { status: 400 },
      );
    }

    const groundTruth = await prisma.groundTruthProduct.upsert({
      where: {
        productId_subcategory: {
          productId: body.productId,
          subcategory: body.subcategory,
        },
      },
      update: {
        category: body.category,
        gender: body.gender ?? null,
        isActive: true,
      },
      create: {
        productId: body.productId,
        subcategory: body.subcategory,
        category: body.category,
        gender: body.gender ?? null,
        isActive: true,
      },
    });

    return NextResponse.json({ ok: true, groundTruth });
  } catch (error) {
    console.error("[vector-classification/ground-truth] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
