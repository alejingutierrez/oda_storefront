import Header from "@/components/Header";
import CatalogoFiltersPanel from "@/components/CatalogoFiltersPanel";
import CatalogToolbar from "@/components/CatalogToolbar";
import CatalogProductsInfinite from "@/components/CatalogProductsInfinite";
import {
  getCatalogFacetsLite,
  getCatalogProducts,
  getCatalogPriceBounds,
  getCatalogSubcategories,
  type CatalogFilters,
} from "@/lib/catalog-data";
import { getMegaMenuData } from "@/lib/home-data";
import {
  resolveSearchParams,
  parseCatalogFiltersFromSearchParams,
  parseCatalogSortFromSearchParams,
  type SearchParams,
} from "@/lib/catalog-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CatalogoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await resolveSearchParams(searchParams);
  const sort = parseCatalogSortFromSearchParams(params, "new");
  const parsedFilters = parseCatalogFiltersFromSearchParams(params);
  const filters: CatalogFilters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const [menu, facets, subcategories, products, priceBounds] = await Promise.all([
    getMegaMenuData(),
    getCatalogFacetsLite(filters),
    getCatalogSubcategories(filters),
    getCatalogProducts({ filters, page: 1, sort }),
    getCatalogPriceBounds(filters),
  ]);

  const activeBrandCount = facets.brands.filter((brand) => brand.count > 0).length;
  const searchKeyParams = new URLSearchParams(params.toString());
  searchKeyParams.delete("page");
  const searchKey = searchKeyParams.toString();

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />

      <section className="oda-container pb-16 pt-10">
        <div className="flex flex-col gap-6">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="font-display text-4xl text-[color:var(--oda-ink)]">Catálogo</h1>
              <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
                Descubre marcas locales con inventario disponible.
              </p>
            </div>
          </div>

          <CatalogToolbar
            totalCount={products.totalCount}
            activeBrandCount={activeBrandCount}
            searchKey={searchKey}
          />

          <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto lg:pr-1">
              <CatalogoFiltersPanel
                facets={facets}
                subcategories={subcategories}
                priceBounds={priceBounds}
              />
            </div>
            <CatalogProductsInfinite
              key={searchKey}
              initialItems={products.items}
              totalCount={products.totalCount}
              initialSearchParams={searchKey}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
