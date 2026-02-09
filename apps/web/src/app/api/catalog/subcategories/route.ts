import { NextResponse } from "next/server";
import { getCatalogSubcategories } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams);
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const items = await getCatalogSubcategories(filters);

  return NextResponse.json(
    { items },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

