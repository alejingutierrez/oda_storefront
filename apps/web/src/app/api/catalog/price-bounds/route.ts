import { NextResponse } from "next/server";
import { getCatalogPriceInsights } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams);
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const insights = await getCatalogPriceInsights(filters, 18);

  return NextResponse.json(
    { bounds: insights.bounds, histogram: insights.histogram },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
