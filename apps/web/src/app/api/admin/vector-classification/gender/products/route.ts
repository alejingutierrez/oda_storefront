import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const VALID_GENDERS = ["Mujer", "Hombre", "Unisex", "Infantil"];

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") || "sin_asignar";
    const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
    const limit = Math.min(120, Math.max(1, Math.floor(Number(searchParams.get("limit")) || 60)));
    const offset = (page - 1) * limit;

    const genderFilter =
      filter === "sin_asignar"
        ? Prisma.sql`AND p.gender IS NULL`
        : VALID_GENDERS.includes(filter)
          ? Prisma.sql`AND p.gender = ${filter}`
          : Prisma.sql`AND p.gender IS NULL`;

    const products = await prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        gender: string | null;
      }>
    >(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name AS "brandName",
        p.gender
      FROM products p
      JOIN brands b ON b.id = p."brandId"
      WHERE (p.status = 'active' OR p.status IS NULL)
        AND p."imageCoverUrl" IS NOT NULL
        ${genderFilter}
      ORDER BY p."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM products p
        WHERE (p.status = 'active' OR p.status IS NULL)
          AND p."imageCoverUrl" IS NOT NULL
          ${genderFilter}
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
    console.error("[gender/products] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
