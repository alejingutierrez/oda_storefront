import { NextResponse } from "next/server";
import { getCatalogProducts } from "@/lib/catalog-data";
import {
  parseCatalogFiltersFromSearchParams,
  parseCatalogPageFromSearchParams,
  parseCatalogSortFromSearchParams,
} from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = parseCatalogPageFromSearchParams(url.searchParams, 1);
  const sort = parseCatalogSortFromSearchParams(url.searchParams, "new");
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams);
  const filters = { ...parsedFilters, inStock: true };

  const result = await getCatalogProducts({ filters, page, sort });

  return NextResponse.json(result, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

