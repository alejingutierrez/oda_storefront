import { NextResponse } from "next/server";
import { getCatalogFacetsStatic } from "@/lib/catalog-data";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const facets = await getCatalogFacetsStatic();

  return NextResponse.json(
    { facets },
    {
      headers: {
        // Cache corto en CDN para estabilidad (pestañas inactivas / back-forward).
        "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}

