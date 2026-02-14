"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import CatalogoFiltersPanel from "@/components/CatalogoFiltersPanel";
import CatalogMobileDock from "@/components/CatalogMobileDock";
import CatalogProductsInfinite from "@/components/CatalogProductsInfinite";
import CatalogToolbar from "@/components/CatalogToolbar";
import type { CatalogPriceBounds, CatalogProduct } from "@/lib/catalog-data";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
  group?: string | null;
};

type FacetsLite = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  colors: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
};

function isAbortError(err: unknown) {
  if (!err) return false;
  if (err instanceof DOMException) return err.name === "AbortError";
  if (err instanceof Error) return err.name === "AbortError";
  return false;
}

function normalizeSearchKey(raw: string) {
  const input = (raw ?? "").trim();
  if (!input) return "";

  const params = new URLSearchParams(input);
  const map = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const list = map.get(key) ?? [];
    list.push(cleaned);
    map.set(key, list);
  }

  const keys = Array.from(map.keys()).sort();
  const out = new URLSearchParams();
  for (const key of keys) {
    const values = map.get(key) ?? [];
    if (values.length > 1) values.sort();
    for (const value of values) out.append(key, value);
  }
  return out.toString();
}

function FiltersSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-3 w-24 rounded-full bg-[color:var(--oda-stone)]" />
            <div className="h-3 w-16 rounded-full bg-[color:var(--oda-stone)]" />
          </div>
          <div className="mt-4 grid gap-2">
            {Array.from({ length: 5 }).map((__, row) => (
              <div
                key={row}
                className="h-6 w-full rounded-lg bg-[color:var(--oda-stone)]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CatalogoClient({
  initialItems,
  totalCount,
  initialSearchParams,
}: {
  initialItems: CatalogProduct[];
  totalCount: number;
  initialSearchParams: string;
}) {
  const params = useSearchParams();
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("oda_catalog_filters_collapsed_v1");
      if (raw === "1") setFiltersCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const toggleFiltersCollapsed = () => {
    setFiltersCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("oda_catalog_filters_collapsed_v1", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const facetsFetchKey = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.delete("sort");
    return normalizeSearchKey(next.toString());
  }, [params]);

  const uiSearchKeyRaw = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    return next.toString();
  }, [params]);

  const uiSearchKey = useMemo(() => normalizeSearchKey(uiSearchKeyRaw), [uiSearchKeyRaw]);
  const initialSearchKey = useMemo(
    () => normalizeSearchKey(initialSearchParams),
    [initialSearchParams],
  );

  // Cuando el usuario cambia filtros (router.replace), `useSearchParams()` se actualiza antes
  // de que lleguen los nuevos props SSR. En ese lapso, evitamos "re-key" del grid para no
  // mostrar productos antiguos bajo filtros nuevos.
  const navigationPending = uiSearchKey !== initialSearchKey;

  const [facets, setFacets] = useState<FacetsLite | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const facetsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    facetsAbortRef.current?.abort();
    const controller = new AbortController();
    facetsAbortRef.current = controller;
    setFacetsLoading(true);

    const next = new URLSearchParams(facetsFetchKey);
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/facets-lite?${next.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { facets?: FacetsLite };
        const nextFacets = payload?.facets;
        setFacets(nextFacets ?? null);
      } catch (err) {
        if (isAbortError(err)) return;
        setFacets(null);
      } finally {
        setFacetsLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [facetsFetchKey]);

  const activeBrandCount = useMemo(() => {
    if (!facets) return null;
    return facets.brands.filter((brand) => brand.count > 0).length;
  }, [facets]);

  const priceBounds: CatalogPriceBounds = { min: null, max: null };

  return (
    <section className="oda-container pb-[calc(var(--oda-mobile-dock-h)+1.25rem)] pt-10 lg:pb-16">
      <div className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-4xl text-[color:var(--oda-ink)]">Catálogo</h1>
            <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
              Descubre marcas locales con inventario disponible.
            </p>
          </div>
        </div>

        <div
          className={[
            "grid gap-8",
            filtersCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[340px_minmax(0,1fr)]",
          ].join(" ")}
        >
          {!filtersCollapsed ? (
            <div className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto lg:pr-1 lg:pb-8">
              <div className="sticky top-0 z-20 bg-[color:var(--oda-cream)] pb-4">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-3 shadow-[0_18px_50px_rgba(23,21,19,0.08)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    Filtros
                  </p>
                  <button
                    type="button"
                    onClick={toggleFiltersCollapsed}
                    className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                  >
                    Ocultar
                  </button>
                </div>
              </div>
              {facets ? (
                <CatalogoFiltersPanel facets={facets} subcategories={[]} priceBounds={priceBounds} />
              ) : (
                <FiltersSkeleton />
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-6">
            <div className="hidden lg:block">
              <CatalogToolbar
                totalCount={totalCount}
                activeBrandCount={activeBrandCount}
                searchKey={uiSearchKey || initialSearchKey}
                filtersCollapsed={filtersCollapsed}
                onToggleFiltersCollapsed={toggleFiltersCollapsed}
              />
            </div>

              <CatalogProductsInfinite
                key={initialSearchParams}
                initialItems={initialItems}
                totalCount={totalCount}
                initialSearchParams={initialSearchParams}
                navigationPending={navigationPending}
                optimisticSearchParams={uiSearchKey}
                filtersCollapsed={filtersCollapsed}
              />
          </div>
        </div>
      </div>

      <CatalogMobileDock
        totalCount={totalCount}
        activeBrandCount={activeBrandCount}
        facets={facets}
        subcategories={[]}
        priceBounds={priceBounds}
        facetsLoading={facetsLoading}
      />
    </section>
  );
}
