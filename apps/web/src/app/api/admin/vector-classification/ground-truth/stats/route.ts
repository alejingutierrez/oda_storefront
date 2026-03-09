import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isSubcategoryReady,
  isCategoryReady,
} from "@/lib/vector-classification/centroids";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const level = searchParams.get("level"); // "category" or null (default: subcategory)
    const filterCategory = searchParams.get("category"); // optional category filter

    if (level === "category") {
      return await getCategoryStats();
    }

    return await getSubcategoryStats(filterCategory);
  } catch (error) {
    console.error("[vector-classification/ground-truth/stats] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}

/**
 * Category-level readiness stats: how many confirmed ground-truth
 * products exist per category vs total products.
 */
async function getCategoryStats() {
  // Get confirmed counts per category
  const confirmedRows = await prisma.$queryRaw<
    Array<{ category: string; confirmed_count: bigint }>
  >(Prisma.sql`
    SELECT gt.category, COUNT(DISTINCT gt."productId") as confirmed_count
    FROM ground_truth_products gt
    WHERE gt."isActive" = true
      AND gt.category IS NOT NULL
    GROUP BY gt.category
  `);

  // Get total products per category
  const totalRows = await prisma.$queryRaw<
    Array<{ category: string; total: bigint }>
  >(Prisma.sql`
    SELECT p.category, COUNT(*) as total
    FROM products p
    WHERE (p.status = 'active' OR p.status IS NULL)
      AND p."imageCoverUrl" IS NOT NULL
      AND p.category IS NOT NULL
    GROUP BY p.category
  `);

  // Build lookup
  const confirmedMap = new Map<string, number>();
  for (const row of confirmedRows) {
    confirmedMap.set(row.category, Number(row.confirmed_count));
  }

  // Merge and compute isReady
  const stats = totalRows.map((row) => {
    const confirmedCount = confirmedMap.get(row.category) ?? 0;
    const totalProducts = Number(row.total);
    return {
      category: row.category,
      totalProducts,
      confirmedCount,
      isReady: isCategoryReady(confirmedCount, totalProducts),
    };
  });

  stats.sort((a, b) => a.category.localeCompare(b.category));

  return NextResponse.json({ stats, level: "category" });
}

/**
 * Subcategory-level readiness stats, optionally filtered to a single
 * category for on-demand per-category subcategory training.
 */
async function getSubcategoryStats(filterCategory: string | null) {
  const categoryCondition = filterCategory
    ? Prisma.sql`AND gt.category = ${filterCategory}`
    : Prisma.empty;
  const productCategoryCondition = filterCategory
    ? Prisma.sql`AND p.category = ${filterCategory}`
    : Prisma.empty;

  // Get confirmed counts per subcategory
  const confirmedRows = await prisma.$queryRaw<
    Array<{ subcategory: string; category: string; confirmed_count: bigint }>
  >(Prisma.sql`
    SELECT gt.subcategory, gt.category, COUNT(*) as confirmed_count
    FROM ground_truth_products gt
    WHERE gt."isActive" = true
      ${categoryCondition}
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
      ${productCategoryCondition}
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
}
