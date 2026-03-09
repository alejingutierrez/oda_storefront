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
    const search = searchParams.get("search")?.trim() || null;
    const offset = (page - 1) * limit;

    const searchFilter = search
      ? Prisma.sql`AND p.name ILIKE ${"%" + search + "%"}`
      : Prisma.empty;

    const products = await prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        category: string | null;
        subcategory: string | null;
        gender: string | null;
        groundTruthId: string | null;
        isConfirmed: boolean;
      }>
    >(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name as "brandName",
        p.category,
        p.subcategory,
        p.gender,
        gt.id as "groundTruthId",
        CASE WHEN gt.id IS NOT NULL THEN true ELSE false END as "isConfirmed"
      FROM products p
      JOIN brands b ON b.id = p."brandId"
      LEFT JOIN ground_truth_products gt
        ON gt."productId" = p.id
        AND gt.subcategory = ${subcategory}
        AND gt."isActive" = true
      WHERE p.subcategory = ${subcategory}
        AND p.status = 'active'
        AND p."imageCoverUrl" IS NOT NULL
        ${searchFilter}
      ORDER BY gt.id IS NOT NULL DESC, p.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) as total
        FROM products p
        WHERE p.subcategory = ${subcategory}
          AND p.status = 'active'
          AND p."imageCoverUrl" IS NOT NULL
          ${searchFilter}
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
    console.error("[vector-classification/products] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
