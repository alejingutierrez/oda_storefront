import { NextResponse } from "next/server";
import { getCatalogFacetsStaticWithVersion } from "@/lib/catalog-data";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const { facets, taxonomyVersion } = await getCatalogFacetsStaticWithVersion();

  return NextResponse.json(
    { facets, taxonomyVersion },
    {
      headers: {
        // Cache corto en CDN para estabilidad (pestañas inactivas / back-forward).
        "cache-control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}
