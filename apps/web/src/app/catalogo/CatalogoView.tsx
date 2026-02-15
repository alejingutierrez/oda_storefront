import Header from "@/components/Header";
import CatalogoClient from "@/app/catalogo/CatalogoClient";
import { getCatalogProductsPage, type CatalogFilters } from "@/lib/catalog-data";
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
      />
    </main>
  );
}
