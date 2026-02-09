import Header from "@/components/Header";
import CatalogoFiltersPanel from "@/components/CatalogoFiltersPanel";
import CatalogToolbar from "@/components/CatalogToolbar";
import CatalogProductsInfinite from "@/components/CatalogProductsInfinite";
import CatalogMobileDock from "@/components/CatalogMobileDock";
import {
  getCatalogFacetsLite,
  getCatalogProducts,
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
  const parsedFilters = parseCatalogFiltersFromSearchParams(params);
  const filters: CatalogFilters = { ...parsedFilters, inStock: true, enrichedOnly: true };

  const [menu, facets, products] = await Promise.all([
    getMegaMenuData(),
    getCatalogFacetsLite(filters),
    getCatalogProducts({ filters, page: 1, sort }),
  ]);
  const priceBounds = { min: null, max: null };

  const activeBrandCount = facets.brands.filter((brand) => brand.count > 0).length;
  const searchKeyParams = new URLSearchParams(params.toString());
  searchKeyParams.delete("page");
  const searchKey = searchKeyParams.toString();

  const chipLabels = {
    gender: Object.fromEntries(facets.genders.map((item) => [item.value, item.label])),
    category: Object.fromEntries(facets.categories.map((item) => [item.value, item.label])),
    subcategory: {} as Record<string, string>,
    brandId: Object.fromEntries(facets.brands.map((item) => [item.value, item.label])),
    color: Object.fromEntries(facets.colors.map((item) => [item.value, item.label])),
    material: Object.fromEntries(facets.materials.map((item) => [item.value, item.label])),
    pattern: Object.fromEntries(facets.patterns.map((item) => [item.value, item.label])),
  };

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />

      <section className="oda-container pb-28 pt-10 lg:pb-16">
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
            labels={chipLabels}
          />

          <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="hidden lg:block lg:sticky lg:top-28 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto lg:pr-1">
              <CatalogoFiltersPanel facets={facets} subcategories={[]} priceBounds={priceBounds} />
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

      <CatalogMobileDock
        totalCount={products.totalCount}
        activeBrandCount={activeBrandCount}
        facets={facets}
        subcategories={[]}
        priceBounds={priceBounds}
      />
    </main>
  );
}
