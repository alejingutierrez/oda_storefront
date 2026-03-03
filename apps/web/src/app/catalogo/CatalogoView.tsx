import Header from "@/components/Header";
import CatalogoClient from "@/app/catalogo/CatalogoClient";
import {
  getCatalogFacetsLiteWithVersion,
  getCatalogPriceBounds,
  getCatalogPriceInsightsFixedPlp,
  getCatalogProductsPage,
  type CatalogFilters,
} from "@/lib/catalog-data";
import { getMegaMenuData } from "@/lib/home-data";
import type { CatalogPlpContext } from "@/lib/catalog-plp";
import {
  canonicalizeCatalogSearchParams,
  resolveSearchParams,
  parseCatalogFiltersFromSearchParams,
  parseCatalogSortFromSearchParams,
  type SearchParams,
} from "@/lib/catalog-filters";

function applyPlpLockedParams(params: URLSearchParams, plp?: CatalogPlpContext | null): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (!plp) return next;

  const lockedKeys = Array.from(new Set((plp.lockedKeys ?? []).map((key) => key.trim()).filter(Boolean)));
  const lockedParams = new URLSearchParams(plp.lockedParams || "");

  // SSR guardrail: el contexto PLP manda, aunque la URL query llegue sin esos params.
  for (const key of lockedKeys) next.delete(key);
  for (const [key, value] of lockedParams.entries()) next.append(key, value);

  return next;
}

function isFixedPlpBaseRequest(params: URLSearchParams, plp?: CatalogPlpContext | null): boolean {
  if (!plp) return false;
  const lockedKeys = Array.from(new Set((plp.lockedKeys ?? []).map((key) => key.trim()).filter(Boolean)));
  const allowed = new Set<string>(["page", "sort", ...lockedKeys]);
  for (const key of new Set(Array.from(params.keys()))) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

export default async function CatalogoView({
  searchParams,
  plp,
}: {
  searchParams: SearchParams;
  plp?: CatalogPlpContext | null;
}) {
  const rawParams = await resolveSearchParams(searchParams);
  const effectiveRawParams = applyPlpLockedParams(rawParams, plp);
  const { params } = canonicalizeCatalogSearchParams(effectiveRawParams);

  const sort = parseCatalogSortFromSearchParams(params, "new");
  const parsedFilters = parseCatalogFiltersFromSearchParams(params, { categoryMode: "single" });
  const filters: CatalogFilters = { ...parsedFilters, inStock: true, enrichedOnly: true };
  const hasPriceFilter =
    (parsedFilters.priceRanges?.length ?? 0) > 0 ||
    parsedFilters.priceMin !== undefined ||
    parsedFilters.priceMax !== undefined;
  const fixedPlpBaseRequest = isFixedPlpBaseRequest(params, plp);
  const initialPriceInsightsPromise = fixedPlpBaseRequest
    ? getCatalogPriceInsightsFixedPlp(filters).catch(async (error) => {
        console.error("catalog.price_insights_fixed_plp_ssr_failed", {
          error: error instanceof Error ? error.message : String(error),
          lockedParams: plp?.lockedParams ?? "",
        });
        const bounds = await getCatalogPriceBounds(filters);
        return { bounds, histogram: null, stats: null };
      })
    : getCatalogPriceBounds(filters).then((bounds) => ({ bounds, histogram: null, stats: null }));

  const [menu, page, facets, initialPriceInsights] = await Promise.all([
    getMegaMenuData(),
    getCatalogProductsPage({ filters, page: 1, sort }),
    hasPriceFilter
      ? Promise.resolve(null)
      : getCatalogFacetsLiteWithVersion(filters).then((result) => ({
          ...result.facets,
          taxonomyVersion: result.taxonomyVersion,
        })),
    initialPriceInsightsPromise,
  ]);
  const searchKeyParams = new URLSearchParams(params.toString());
  searchKeyParams.delete("page");
  const searchKey = searchKeyParams.toString();

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />
      <CatalogoClient
        initialItems={page.items}
        totalCount={null}
        initialSearchParams={searchKey}
        initialFacets={facets}
        initialPriceInsights={initialPriceInsights}
        plpContext={plp ?? null}
      />
    </main>
  );
}
