import { NextResponse } from "next/server";
import { getCatalogPriceInsights } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams, { categoryMode: "single" });
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const insights = await getCatalogPriceInsights(filters);

  return NextResponse.json(
    { bounds: insights.bounds, histogram: insights.histogram, stats: insights.stats },
    {
      headers: {
        // Cache corto en CDN para estabilidad (pestañas inactivas / back-forward).
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
      },
    },
  );
}
