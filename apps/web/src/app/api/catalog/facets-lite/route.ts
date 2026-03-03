import { NextResponse } from "next/server";
import { getCatalogFacetsLiteWithVersion } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams, { categoryMode: "single" });
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const { facets, taxonomyVersion } = await getCatalogFacetsLiteWithVersion(filters);

  return NextResponse.json(
    { facets, taxonomyVersion },
    {
      headers: {
        // Cache corto en CDN para que al volver a una pestaña inactiva no “parpadeen” los filtros.
        "cache-control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}
