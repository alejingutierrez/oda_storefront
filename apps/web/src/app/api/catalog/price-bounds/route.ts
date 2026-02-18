import { NextResponse } from "next/server";
import { getCatalogPriceBounds, getCatalogPriceInsights } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "lite" ? "lite" : "full";
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams, { categoryMode: "single" });
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const insights =
    mode === "lite"
      ? {
          bounds: await getCatalogPriceBounds(filters),
          histogram: null,
          stats: null,
        }
      : await getCatalogPriceInsights(filters);

  return NextResponse.json(
    insights,
    {
      headers: {
        // Cache corto en CDN para estabilidad (pestañas inactivas / back-forward).
        "cache-control":
          mode === "lite"
            ? "public, max-age=0, s-maxage=60, stale-while-revalidate=600"
            : "public, max-age=0, s-maxage=300, stale-while-revalidate=1800",
      },
    },
  );
}
