import { NextResponse } from "next/server";
import { getCatalogPriceBounds } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams);
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const bounds = await getCatalogPriceBounds(filters);

  return NextResponse.json(
    { bounds },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

