import Header from "@/components/Header";
import CatalogoClient from "@/app/catalogo/CatalogoClient";
import { getCatalogProductsPage, type CatalogFilters } from "@/lib/catalog-data";
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

  const [menu, page] = await Promise.all([getMegaMenuData(), getCatalogProductsPage({ filters, page: 1, sort })]);
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
        plpContext={plp ?? null}
      />
    </main>
  );
}
