import Header from "@/components/Header";
import CatalogProductCard from "@/components/CatalogProductCard";
import CatalogFiltersPanel from "@/components/CatalogFiltersPanel";
import SectionHeading from "@/components/SectionHeading";
import {
  CATALOG_PAGE_SIZE,
  getCatalogFacets,
  getCatalogProducts,
  getCatalogStats,
  getCatalogSubcategories,
  type CatalogFilters,
} from "@/lib/catalog-data";
import { getMegaMenuData } from "@/lib/home-data";
import { labelize, labelizeSubcategory } from "@/lib/navigation";
import {
  resolveSearchParams,
  parseCatalogFiltersFromSearchParams,
  parseCatalogPageFromSearchParams,
  parseCatalogSortFromSearchParams,
  type SearchParams,
} from "@/lib/catalog-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ActiveFilter = {
  label: string;
  href: string;
};

function updateParam(
  params: URLSearchParams,
  key: string,
  value?: string,
  options: { resetPage?: boolean } = {}
) {
  const next = new URLSearchParams(params.toString());
  if (value === undefined || value === "") {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  if (options.resetPage !== false && key !== "page") {
    next.set("page", "1");
  }
  const query = next.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

function clearPriceParams(params: URLSearchParams) {
  const next = new URLSearchParams(params.toString());
  next.delete("price_min");
  next.delete("price_max");
  next.set("page", "1");
  const query = next.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

function removeValue(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params.toString());
  const values = next.getAll(key);
  next.delete(key);
  for (const item of values) {
    if (item !== value) next.append(key, item);
  }
  next.set("page", "1");
  const query = next.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

export default async function CatalogoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await resolveSearchParams(searchParams);
  const page = parseCatalogPageFromSearchParams(params, 1);
  const sort = parseCatalogSortFromSearchParams(params, "relevancia");
  const filters: CatalogFilters = parseCatalogFiltersFromSearchParams(params);

  const [menu, stats, facets, products] = await Promise.all([
    getMegaMenuData(),
    getCatalogStats(),
    getCatalogFacets(filters),
    getCatalogProducts({ filters, page, sort }),
  ]);

  const subcategories = await getCatalogSubcategories(filters);

  const totalPages = Math.max(1, Math.ceil(products.totalCount / CATALOG_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const activeFilters: ActiveFilter[] = [];

  if (filters.q) {
    activeFilters.push({
      label: `Busqueda: ${filters.q}`,
      href: updateParam(params, "q", ""),
    });
  }

  if (filters.categories) {
    for (const value of filters.categories) {
      activeFilters.push({
        label: `Categoria: ${labelize(value)}`,
        href: removeValue(params, "category", value),
      });
    }
  }

  if (filters.subcategories) {
    for (const value of filters.subcategories) {
      activeFilters.push({
        label: `Subcategoria: ${labelizeSubcategory(value)}`,
        href: removeValue(params, "subcategory", value),
      });
    }
  }

  if (filters.genders) {
    for (const value of filters.genders) {
      activeFilters.push({
        label: `Genero: ${value}`,
        href: removeValue(params, "gender", value),
      });
    }
  }

  if (filters.brandIds) {
    for (const value of filters.brandIds) {
      const label = facets.brands.find((brand) => brand.value === value)?.label ?? "Marca";
      activeFilters.push({
        label: `Marca: ${label}`,
        href: removeValue(params, "brandId", value),
      });
    }
  }

  if (filters.colors) {
    for (const value of filters.colors) {
      activeFilters.push({
        label: `Color: ${value}`,
        href: removeValue(params, "color", value),
      });
    }
  }

  if (filters.sizes) {
    for (const value of filters.sizes) {
      activeFilters.push({
        label: `Talla: ${value}`,
        href: removeValue(params, "size", value),
      });
    }
  }

  if (filters.fits) {
    for (const value of filters.fits) {
      activeFilters.push({
        label: `Fit: ${labelize(value)}`,
        href: removeValue(params, "fit", value),
      });
    }
  }

  if (filters.materials) {
    for (const value of filters.materials) {
      activeFilters.push({
        label: `Material: ${labelize(value)}`,
        href: removeValue(params, "material", value),
      });
    }
  }

  if (filters.patterns) {
    for (const value of filters.patterns) {
      activeFilters.push({
        label: `Patron: ${labelize(value)}`,
        href: removeValue(params, "pattern", value),
      });
    }
  }

  if (filters.occasions) {
    for (const value of filters.occasions) {
      activeFilters.push({
        label: `Ocasion: ${labelize(value)}`,
        href: removeValue(params, "occasion", value),
      });
    }
  }

  if (filters.seasons) {
    for (const value of filters.seasons) {
      activeFilters.push({
        label: `Temporada: ${labelize(value)}`,
        href: removeValue(params, "season", value),
      });
    }
  }

  if (filters.styles) {
    for (const value of filters.styles) {
      activeFilters.push({
        label: `Estilo: ${labelize(value)}`,
        href: removeValue(params, "style", value),
      });
    }
  }

  if (filters.inStock) {
    activeFilters.push({
      label: "Solo en stock",
      href: updateParam(params, "in_stock", ""),
    });
  }

  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    activeFilters.push({
      label: `Precio: ${filters.priceMin ?? "0"} - ${filters.priceMax ?? "∞"}`,
      href: clearPriceParams(params),
    });
  }

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />

      <section className="oda-container flex flex-col gap-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Home / Catalogo
        </div>
        <SectionHeading title="Catalogo completo" subtitle="Marketplace" />
        <div className="grid gap-4 rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Marcas</p>
            <p className="mt-1 text-2xl font-semibold text-[color:var(--oda-ink)]">
              {stats.brandCount.toLocaleString("es-CO")}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Productos</p>
            <p className="mt-1 text-2xl font-semibold text-[color:var(--oda-ink)]">
              {stats.productCount.toLocaleString("es-CO")}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Variantes</p>
            <p className="mt-1 text-2xl font-semibold text-[color:var(--oda-ink)]">
              {stats.variantCount.toLocaleString("es-CO")}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Colores</p>
            <p className="mt-1 text-2xl font-semibold text-[color:var(--oda-ink)]">
              {stats.colorCount.toLocaleString("es-CO")}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Combos</p>
            <p className="mt-1 text-2xl font-semibold text-[color:var(--oda-ink)]">
              {stats.comboCount.toLocaleString("es-CO")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={updateParam(params, "sort", "new")}
            className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            Nuevos
          </a>
          <a
            href={filters.inStock ? updateParam(params, "in_stock", "") : updateParam(params, "in_stock", "1")}
            className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            En stock
          </a>
          <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Bajó de precio · pronto
          </span>
          <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Combos cálidos · pronto
          </span>
          <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Estilo urbano · pronto
          </span>
        </div>
      </section>

      <section className="oda-container grid gap-8 pb-16 lg:grid-cols-[320px_minmax(0,1fr)]">
        <CatalogFiltersPanel facets={facets} subcategories={subcategories} />

        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[color:var(--oda-border)] bg-white px-6 py-4">
            <p className="text-sm text-[color:var(--oda-ink-soft)]">
              {products.totalCount.toLocaleString("es-CO")} resultados · pagina {safePage} de {totalPages}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
              <span className="text-[color:var(--oda-taupe)]">Ordenar</span>
              <a href={updateParam(params, "sort", "relevancia")}>Relevancia</a>
              <a href={updateParam(params, "sort", "new")}>Nuevos</a>
              <a href={updateParam(params, "sort", "price_asc")}>Precio ↑</a>
              <a href={updateParam(params, "sort", "price_desc")}>Precio ↓</a>
              <a href="/catalogo" className="text-[color:var(--oda-taupe)]">
                Limpiar
              </a>
            </div>
          </div>

          {products.items.length === 0 ? (
            <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-10 text-center">
              <p className="text-lg font-semibold text-[color:var(--oda-ink)]">
                No encontramos productos con esos filtros.
              </p>
              <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
                Prueba ajustar categoria, color o rango de precio para ampliar resultados.
              </p>
              <a
                href="/catalogo"
                className="mt-6 inline-flex rounded-full bg-[color:var(--oda-ink)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
              >
                Volver al catalogo completo
              </a>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {products.items.map((product) => (
                <CatalogProductCard key={product.id} product={product} />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-2xl border border-[color:var(--oda-border)] bg-white px-6 py-4 text-sm text-[color:var(--oda-ink-soft)]">
            <a
              href={
                safePage > 1
                  ? updateParam(params, "page", String(safePage - 1), { resetPage: false })
                  : "#"
              }
              className={`text-xs uppercase tracking-[0.2em] ${
                safePage > 1 ? "text-[color:var(--oda-ink)]" : "text-[color:var(--oda-taupe)]"
              }`}
            >
              Anterior
            </a>
            <span>
              Pagina {safePage} de {totalPages}
            </span>
            <a
              href={
                safePage < totalPages
                  ? updateParam(params, "page", String(safePage + 1), { resetPage: false })
                  : "#"
              }
              className={`text-xs uppercase tracking-[0.2em] ${
                safePage < totalPages ? "text-[color:var(--oda-ink)]" : "text-[color:var(--oda-taupe)]"
              }`}
            >
              Siguiente
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
