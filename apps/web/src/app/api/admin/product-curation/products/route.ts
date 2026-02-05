import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { buildOrderBy, buildWhere } from "@/lib/catalog-query";
import {
  parseCatalogFiltersFromSearchParams,
  parseCatalogSortFromSearchParams,
} from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

const parsePositiveInt = (value: string | null, fallback: number) => {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const params = url.searchParams;
  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = Math.min(60, Math.max(1, parsePositiveInt(params.get("pageSize"), 36)));
  const sort = parseCatalogSortFromSearchParams(params, "relevancia");
  const filters = parseCatalogFiltersFromSearchParams(params);

  const offset = Math.max(0, (page - 1) * pageSize);
  const where = buildWhere(filters);
  const orderBy = buildOrderBy(sort);

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        category: string | null;
        subcategory: string | null;
        gender: string | null;
        season: string | null;
        stylePrimary: string | null;
        styleSecondary: string | null;
        status: string | null;
        sourceUrl: string | null;
        updatedAt: Date;
        minPrice: string | null;
        maxPrice: string | null;
        currency: string | null;
        variantCount: bigint;
        inStockCount: bigint;
        hasEnrichment: boolean;
      }>
    >(Prisma.sql`
      select
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name as "brandName",
        p.category,
        p.subcategory,
        p.gender,
        p.season,
        p."stylePrimary",
        p."styleSecondary",
        p.status,
        p."sourceUrl",
        p."updatedAt",
        (
          select min(v.price)
          from variants v
          where v."productId" = p.id and v.price > 0
        ) as "minPrice",
        (
          select max(v.price)
          from variants v
          where v."productId" = p.id and v.price > 0
        ) as "maxPrice",
        (
          select v.currency
          from variants v
          where v."productId" = p.id and v.price > 0
          limit 1
        ) as currency,
        (
          select count(*)
          from variants v
          where v."productId" = p.id
        ) as "variantCount",
        (
          select count(*)
          from variants v
          where v."productId" = p.id
            and (v.stock > 0 or v."stockStatus" in ('in_stock','preorder'))
        ) as "inStockCount",
        ((p."metadata" -> 'enrichment') is not null) as "hasEnrichment"
      from products p
      join brands b on b.id = p."brandId"
      ${where}
      ${orderBy}
      limit ${pageSize}
      offset ${offset}
    `),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      select count(*) as total
      from products p
      join brands b on b.id = p."brandId"
      ${where}
    `),
  ]);

  const totalCount = Number(countRows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasMore = page < totalPages;

  return NextResponse.json({
    page,
    pageSize,
    totalCount,
    totalPages,
    hasMore,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      imageCoverUrl: row.imageCoverUrl,
      brandName: row.brandName,
      category: row.category,
      subcategory: row.subcategory,
      gender: row.gender,
      season: row.season,
      stylePrimary: row.stylePrimary,
      styleSecondary: row.styleSecondary,
      status: row.status,
      sourceUrl: row.sourceUrl,
      updatedAt: row.updatedAt,
      minPrice: row.minPrice,
      maxPrice: row.maxPrice,
      currency: row.currency,
      variantCount: Number(row.variantCount ?? 0),
      inStockCount: Number(row.inStockCount ?? 0),
      hasEnrichment: Boolean(row.hasEnrichment),
    })),
  });
}

