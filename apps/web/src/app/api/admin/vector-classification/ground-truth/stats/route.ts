import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSubcategoryReady } from "@/lib/vector-classification/centroids";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Get confirmed counts per subcategory
    const confirmedRows = await prisma.$queryRaw<
      Array<{ subcategory: string; category: string; confirmed_count: bigint }>
    >(Prisma.sql`
      SELECT gt.subcategory, gt.category, COUNT(*) as confirmed_count
      FROM ground_truth_products gt
      WHERE gt."isActive" = true
      GROUP BY gt.subcategory, gt.category
    `);

    // Get total products per subcategory
    const totalRows = await prisma.$queryRaw<
      Array<{ subcategory: string; category: string; total: bigint }>
    >(Prisma.sql`
      SELECT p.subcategory, p.category, COUNT(*) as total
      FROM products p
      WHERE (p.status = 'active' OR p.status IS NULL)
        AND p."imageCoverUrl" IS NOT NULL
        AND p.subcategory IS NOT NULL
      GROUP BY p.subcategory, p.category
    `);

    // Build a lookup for confirmed counts
    const confirmedMap = new Map<string, { category: string; count: number }>();
    for (const row of confirmedRows) {
      confirmedMap.set(row.subcategory, {
        category: row.category,
        count: Number(row.confirmed_count),
      });
    }

    // Merge and compute isReady
    const stats = totalRows.map((row) => {
      const confirmed = confirmedMap.get(row.subcategory);
      const confirmedCount = confirmed?.count ?? 0;
      return {
        subcategory: row.subcategory,
        category: row.category,
        totalProducts: Number(row.total),
        confirmedCount,
        isReady: isSubcategoryReady(confirmedCount, Number(row.total)),
      };
    });

    // Sort by subcategory name
    stats.sort((a, b) => a.subcategory.localeCompare(b.subcategory));

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[vector-classification/ground-truth/stats] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
