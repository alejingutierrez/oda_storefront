import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRefreshConfig, isBrandDueForRefresh } from "@/lib/catalog/refresh";

export const runtime = "nodejs";

const readMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = getRefreshConfig();
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.intervalDays * 24 * 60 * 60 * 1000);

  const [brandTotals] = await prisma.$queryRaw<
    Array<{ total: number; fresh: number; stale: number }>
  >(
    Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE (\"metadata\" -> 'catalog_refresh' ->> 'lastCompletedAt')::timestamptz >= ${windowStart}
        )::int AS fresh,
        COUNT(*) FILTER (
          WHERE (\"metadata\" -> 'catalog_refresh' ->> 'lastCompletedAt') IS NULL
             OR (\"metadata\" -> 'catalog_refresh' ->> 'lastCompletedAt')::timestamptz < ${windowStart}
        )::int AS stale
      FROM \"brands\"
      WHERE \"isActive\" = true
        AND \"siteUrl\" IS NOT NULL
    `,
  );

  const [newProducts] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"products\"
      WHERE \"createdAt\" >= ${windowStart}
    `,
  );

  const [priceChanges] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"price_history\"
      WHERE \"capturedAt\" >= ${windowStart}
    `,
  );

  const [stockChanges] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"stock_history\"
      WHERE \"capturedAt\" >= ${windowStart}
    `,
  );

  const [stockStatusChanges] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM \"variants\"
      WHERE (\"metadata\" ->> 'last_stock_status_changed_at')::timestamptz >= ${windowStart}
    `,
  );

  const brands = await prisma.brand.findMany({
    where: { isActive: true, siteUrl: { not: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      siteUrl: true,
      ecommercePlatform: true,
      manualReview: true,
      metadata: true,
      _count: { select: { products: true } },
    },
  });

  const brandRows = brands.map((brand) => {
    const metadata = readMetadata(brand.metadata);
    const refresh = metadata.catalog_refresh ?? {};
    return {
      id: brand.id,
      name: brand.name,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
      manualReview: brand.manualReview,
      productCount: brand._count.products,
      refresh,
      due: isBrandDueForRefresh(metadata, now, config),
    };
  });

  return NextResponse.json({
    config,
    windowStart: windowStart.toISOString(),
    summary: {
      totalBrands: brandTotals?.total ?? 0,
      freshBrands: brandTotals?.fresh ?? 0,
      staleBrands: brandTotals?.stale ?? 0,
      newProducts: newProducts?.count ?? 0,
      priceChanges: priceChanges?.count ?? 0,
      stockChanges: stockChanges?.count ?? 0,
      stockStatusChanges: stockStatusChanges?.count ?? 0,
    },
    brands: brandRows,
  });
}

