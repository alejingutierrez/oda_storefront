"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CatalogoFiltersPanel from "@/components/CatalogoFiltersPanel";
import type { CatalogPriceBounds } from "@/lib/catalog-data";
import { SORT_OPTIONS } from "@/components/CatalogToolbar";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
  group?: string | null;
};

type Facets = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  colors: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
};

function countActiveFilters(params: URLSearchParams) {
  let count = 0;
  let hasPrice = false;
  for (const [key, value] of params.entries()) {
    if (key === "sort" || key === "page") continue;
    if (value.trim().length === 0) continue;
    if (key === "price_min" || key === "price_max" || key === "price_range") {
      hasPrice = true;
      continue;
    }
    count += 1;
  }
  if (hasPrice) count += 1;
  return count;
}

export default function CatalogMobileDock({
  totalCount,
  activeBrandCount,
  facets,
  subcategories,
  priceBounds,
  facetsLoading = false,
}: {
  totalCount: number;
  activeBrandCount?: number | null;
  facets: Facets | null;
  subcategories: FacetItem[];
  priceBounds: CatalogPriceBounds;
  facetsLoading?: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = dockRef.current;
    if (!node) return;

    const root = document.documentElement;
    const commit = () => {
      const height = Math.ceil(node.getBoundingClientRect().height || 0);
      if (!height) return;
      root.style.setProperty("--oda-mobile-dock-h", `${height}px`);
    };

    commit();

    const onResize = () => commit();
    window.addEventListener("resize", onResize);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onResize);
    }

    const ro = new ResizeObserver(() => commit());
    ro.observe(node);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const sort = params.get("sort") ?? "new";
  const hasFilters = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("sort");
    next.delete("page");
    return next.toString().length > 0;
  }, [params]);
  const filterCount = useMemo(() => countActiveFilters(new URLSearchParams(params.toString())), [params]);

  const [open, setOpen] = useState(false);
  const [draftParamsString, setDraftParamsString] = useState("");

  const openSheet = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    setDraftParamsString(next.toString());
    setOpen(true);
  };

  const applyDraft = () => {
    const next = new URLSearchParams(draftParamsString);
    next.delete("page");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
    setOpen(false);

    // En mobile, al aplicar filtros queremos llevar al usuario directo a resultados.
    window.setTimeout(() => {
      const target = document.getElementById("catalog-results");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);
  };

  const clearAll = () => {
    setDraftParamsString("");
  };

  const handleSortChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "new") next.delete("sort");
    else next.set("sort", value);
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const handleClearCommitted = () => {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  const selectedOption =
    SORT_OPTIONS.find((option) => option.value === sort) ??
    SORT_OPTIONS.find((option) => option.value === "new")!;

  return (
    <>
      <div
        ref={dockRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--oda-border)] bg-white/92 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur lg:hidden"
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={openSheet}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3 text-xs font-semibold text-[color:var(--oda-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Filtrar
            {facetsLoading && !facets ? (
              <span className="rounded-full bg-[color:var(--oda-stone)] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Cargando
              </span>
            ) : null}
            {filterCount > 0 ? (
              <span className="rounded-full bg-[color:var(--oda-ink)] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)]">
                {filterCount}
              </span>
            ) : null}
          </button>

          <label className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            <span className="sr-only">Ordenar</span>
            <span className="relative inline-flex">
              <select
                value={selectedOption.value}
                onChange={(event) => handleSortChange(event.target.value)}
                aria-label="Ordenar"
                className="h-11 min-w-[8.25rem] appearance-none rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 pr-9 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--oda-taupe)]"
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={handleClearCommitted}
            disabled={!hasFilters || isPending}
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition",
              hasFilters && !isPending
                ? "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)]"
                : "cursor-not-allowed border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)] opacity-70",
            ].join(" ")}
            aria-label="Limpiar filtros"
            title="Limpiar"
          >
            ×
          </button>
        </div>

        <div className="mt-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          <span>
            {totalCount.toLocaleString("es-CO")} productos
          </span>
          {typeof activeBrandCount === "number" ? (
            <span>{activeBrandCount.toLocaleString("es-CO")} marcas</span>
          ) : (
            <span className="inline-flex h-3 w-16 rounded-full bg-[color:var(--oda-stone)]" />
          )}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar filtros"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-3xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] shadow-[0_-30px_80px_rgba(23,21,19,0.30)]">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--oda-border)] bg-white px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Filtros
                </p>
                <p className="mt-1 text-sm font-semibold text-[color:var(--oda-ink)]">
                  Ajusta tu búsqueda
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[calc(85vh-10.5rem)] overflow-auto px-4 pb-6 pt-5">
              {facets ? (
                <CatalogoFiltersPanel
                  facets={facets}
                  subcategories={subcategories}
                  priceBounds={priceBounds}
                  mode="draft"
                  draftParamsString={draftParamsString}
                  onDraftParamsStringChange={setDraftParamsString}
                />
              ) : (
                <div className="grid gap-3">
                  <p className="text-xs text-[color:var(--oda-taupe)]">
                    Cargando filtros…
                  </p>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-14 w-full rounded-2xl border border-[color:var(--oda-border)] bg-white"
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[color:var(--oda-border)] bg-white px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={!facets}
                  className="rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={applyDraft}
                  disabled={isPending || !facets}
                  className="rounded-full bg-[color:var(--oda-ink)] px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:opacity-70"
                >
                  {isPending ? "Aplicando…" : "Aplicar"}
                </button>
              </div>
              <p className="mt-3 text-[8px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Tip: puedes seleccionar varios filtros antes de aplicar.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
