import { NextResponse } from "next/server";
import { getCatalogProductsCount } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams, { categoryMode: "single" });
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const totalCount = await getCatalogProductsCount({ filters });

  return NextResponse.json(
    { totalCount },
    {
      headers: {
        // Cache corto en CDN: el catálogo es público y ya revalida en server (`unstable_cache`).
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
      },
    },
  );
}

