import { NextResponse } from "next/server";
import { getCatalogFacetsLiteWithVersion, getCatalogFacetsStaticWithVersion } from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;
const facetsLiteTimeoutMs = Math.max(1_000, Number(process.env.CATALOG_FACETS_LITE_TIMEOUT_MS ?? 8_000));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams, { categoryMode: "single" });
  const filters = { ...parsedFilters, inStock: true, enrichedOnly: true };
  const computePromise = getCatalogFacetsLiteWithVersion(filters);
  const timeoutFallback = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), facetsLiteTimeoutMs);
  });

  let facets: Awaited<ReturnType<typeof getCatalogFacetsLiteWithVersion>>["facets"];
  let taxonomyVersion: number;
  let facetsSource = "lite";

  try {
    const result = await Promise.race([computePromise, timeoutFallback]);
    if (result) {
      facets = result.facets;
      taxonomyVersion = result.taxonomyVersion;
    } else {
      computePromise.catch((error) => {
        console.warn("[catalog.facets-lite] timed out, using static fallback", { error });
      });
      const fallback = await getCatalogFacetsStaticWithVersion();
      facets = fallback.facets;
      taxonomyVersion = fallback.taxonomyVersion;
      facetsSource = "static-timeout-fallback";
    }
  } catch (error) {
    console.warn("[catalog.facets-lite] failed, using static fallback", { error });
    const fallback = await getCatalogFacetsStaticWithVersion();
    facets = fallback.facets;
    taxonomyVersion = fallback.taxonomyVersion;
    facetsSource = "static-error-fallback";
  }

  return NextResponse.json(
    { facets, taxonomyVersion },
    {
      headers: {
        // Cache corto en CDN para que al volver a una pestaña inactiva no “parpadeen” los filtros.
        "cache-control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
        "x-catalog-facets-source": facetsSource,
      },
    },
  );
}
