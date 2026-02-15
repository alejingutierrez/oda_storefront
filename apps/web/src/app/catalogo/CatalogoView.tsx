import Header from "@/components/Header";
import CatalogoClient from "@/app/catalogo/CatalogoClient";
import {
  getCatalogFacetsLite,
  getCatalogPriceInsights,
  getCatalogProducts,
  getCatalogSubcategories,
  type CatalogFilters,
} from "@/lib/catalog-data";
import { getMegaMenuData } from "@/lib/home-data";
import {
  canonicalizeCatalogSearchParams,
  resolveSearchParams,
  parseCatalogFiltersFromSearchParams,
  parseCatalogSortFromSearchParams,
  type SearchParams,
} from "@/lib/catalog-filters";

export default async function CatalogoView({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await resolveSearchParams(searchParams);
  const { params } = canonicalizeCatalogSearchParams(rawParams);

  const sort = parseCatalogSortFromSearchParams(params, "new");
  const parsedFilters = parseCatalogFiltersFromSearchParams(params, { categoryMode: "single" });
  const filters: CatalogFilters = { ...parsedFilters, inStock: true, enrichedOnly: true };
  // Subcategorias: solo dependen de categoria + genero (y constraints globales), no del resto de filtros.
  // Esto evita "poison" del cache (misma key para category+gender) y hace el comportamiento consistente
  // entre SSR y el panel cliente.
  const subcategoriesFilters: CatalogFilters = {
    categories: filters.categories,
    genders: filters.genders,
    inStock: true,
    enrichedOnly: true,
  };

  const facetsPromise = getCatalogFacetsLite(filters).catch((error) => {
    console.error("CatalogoView: fallo cargando facets-lite", error);
    return null;
  });
  const priceInsightsPromise = getCatalogPriceInsights(filters).catch((error) => {
    console.error("CatalogoView: fallo cargando price insights", error);
    return null;
  });
  const subcategoriesPromise = getCatalogSubcategories(subcategoriesFilters).catch((error) => {
    console.error("CatalogoView: fallo cargando subcategorias", error);
    return [];
  });

  const [menu, products, initialFacets, initialPriceInsights, initialSubcategories] = await Promise.all([
    getMegaMenuData(),
    getCatalogProducts({ filters, page: 1, sort }),
    facetsPromise,
    priceInsightsPromise,
    subcategoriesPromise,
  ]);
  const searchKeyParams = new URLSearchParams(params.toString());
  searchKeyParams.delete("page");
  const searchKey = searchKeyParams.toString();

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />
      <CatalogoClient
        initialItems={products.items}
        totalCount={products.totalCount}
        initialSearchParams={searchKey}
        initialFacets={initialFacets}
        initialPriceInsights={initialPriceInsights}
        initialSubcategories={initialSubcategories}
      />
    </main>
  );
}
