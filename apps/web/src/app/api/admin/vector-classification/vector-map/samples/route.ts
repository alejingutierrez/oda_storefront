import { NextResponse } from "next/server";
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
    const centroidId = searchParams.get("centroidId");
    const level = searchParams.get("level") ?? "subcategory";
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 40);

    if (!centroidId) {
      return NextResponse.json({ error: "centroidId is required" }, { status: 400 });
    }

    // Find the centroid to get its label
    let filterField: string;
    let filterValue: string;

    if (level === "category") {
      const centroid = await prisma.$queryRawUnsafe<{ category: string }[]>(
        `SELECT category FROM category_centroids WHERE id = $1`,
        centroidId,
      );
      if (!centroid[0]) {
        return NextResponse.json({ error: "centroid not found" }, { status: 404 });
      }
      filterField = "category";
      filterValue = centroid[0].category;
    } else {
      const centroid = await prisma.$queryRawUnsafe<{ subcategory: string }[]>(
        `SELECT subcategory FROM subcategory_centroids WHERE id = $1`,
        centroidId,
      );
      if (!centroid[0]) {
        return NextResponse.json({ error: "centroid not found" }, { status: 404 });
      }
      filterField = "subcategory";
      filterValue = centroid[0].subcategory;
    }

    const products = await prisma.$queryRawUnsafe<
      {
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string | null;
      }[]
    >(
      `SELECT p.id, p.name, p."imageCoverUrl", b.name AS "brandName"
       FROM products p
       LEFT JOIN brands b ON b.id = p."brandId"
       WHERE p."${filterField}" = $1
         AND p.status = 'active'
         AND p."hasInStock" = true
         AND p."imageCoverUrl" IS NOT NULL
       ORDER BY RANDOM()
       LIMIT $2`,
      filterValue,
      limit,
    );

    return NextResponse.json({ products });
  } catch (error) {
    console.error("[vector-map/samples] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
