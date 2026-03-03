import { NextResponse } from "next/server";
import { getCatalogSubcategoriesWithVersion } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams, { categoryMode: "single" });
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const { items, taxonomyVersion } = await getCatalogSubcategoriesWithVersion(filters);

  return NextResponse.json(
    { items, taxonomyVersion },
    {
      headers: {
        // Cache corto en CDN para estabilidad (pestañas inactivas / back-forward).
        "cache-control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}
