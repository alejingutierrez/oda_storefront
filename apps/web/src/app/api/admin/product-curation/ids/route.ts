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

const MAX_LIMIT = 1200;

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
  const limit = Math.min(MAX_LIMIT, parsePositiveInt(params.get("limit"), MAX_LIMIT));

  const sort = parseCatalogSortFromSearchParams(params, "relevancia");
  const parsedFilters = parseCatalogFiltersFromSearchParams(params);
  // Curación humana se alinea con catálogo público: solo enriquecidos y en stock.
  const filters = { ...parsedFilters, enrichedOnly: true, inStock: true };
  const where = buildWhere(filters);
  const orderBy = buildOrderBy(sort);

  const limitPlusOne = limit + 1;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    select p.id
    from products p
    join brands b on b.id = p."brandId"
    ${where}
    ${orderBy}
    limit ${limitPlusOne}
  `);

  const hasMore = rows.length > limit;
  const ids = rows.slice(0, limit).map((row) => row.id);

  return NextResponse.json({ ids, limit, hasMore });
}
