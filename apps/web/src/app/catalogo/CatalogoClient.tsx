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

function readSessionJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function isValidFacetsLite(input: unknown): input is FacetsLite {
  if (!input || typeof input !== "object") return false;
  const obj = input as Partial<FacetsLite>;
  const arrays = [
    obj.categories,
    obj.genders,
    obj.brands,
    obj.colors,
    obj.materials,
    obj.patterns,
  ];
  return arrays.every((value) => Array.isArray(value));
}

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
  const [resumeTick, setResumeTick] = useState(0);

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

  // Desktop: el scroll con rueda/trackpad sobre la columna izquierda debe desplazar SOLO filtros,
  // nunca el listado de productos (incluso en Safari, donde `overscroll-behavior` puede ser inconsistente).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (filtersCollapsed) return;

    const el = document.getElementById("catalog-filters-scroll");
    if (!el) return;

    const media = window.matchMedia("(min-width: 1024px)");
    const toPixels = (event: WheelEvent) => {
      if (event.deltaMode === 1) return event.deltaY * 16; // lines → px (aprox)
      if (event.deltaMode === 2) return event.deltaY * window.innerHeight; // pages → px
      return event.deltaY; // px
    };
    const canScroll = (node: HTMLElement, deltaY: number) => {
      const max = node.scrollHeight - node.clientHeight;
      if (!Number.isFinite(max) || max <= 0) return false;
      if (deltaY > 0) return node.scrollTop < max;
      if (deltaY < 0) return node.scrollTop > 0;
      return false;
    };

    const pickScrollTarget = (target: HTMLElement, deltaY: number) => {
      const candidates: HTMLElement[] = [];
      let node: HTMLElement | null = target;
      while (node && node !== el) {
        if (node.getAttribute("data-oda-scroll-allow") === "true") {
          candidates.push(node);
        }
        node = node.parentElement;
      }
      candidates.push(el);

      for (const candidate of candidates) {
        if (canScroll(candidate, deltaY)) return candidate;
      }
      // Si nada puede scrollear en esa dirección, nos quedamos con el contenedor
      // para "tragar" el wheel y no encadenar al window/products.
      return el;
    };

    const onWheel = (event: WheelEvent) => {
      if (!media.matches) return;
      if (event.ctrlKey) return; // zoom trackpad
      const deltaY = toPixels(event);
      if (!deltaY) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;

      event.preventDefault();
      const node = pickScrollTarget(target, deltaY);
      node.scrollTop += deltaY;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [filtersCollapsed]);

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

  const facetsSessionKey = useMemo(
    () => `oda_catalog_facets_lite_v1:${facetsFetchKey || "base"}`,
    [facetsFetchKey],
  );
  const [facets, setFacets] = useState<FacetsLite | null>(() => {
    const cached = readSessionJson<unknown>(facetsSessionKey);
    return isValidFacetsLite(cached) ? cached : null;
  });
  const [facetsLoading, setFacetsLoading] = useState(false);
  const facetsAbortRef = useRef<AbortController | null>(null);
  const facetsLastAttemptAtRef = useRef<number>(0);
  const facetsLastOkAtRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => setResumeTick((prev) => prev + 1);
    const onFocus = () => bump();
    const onVis = () => {
      if (!document.hidden) bump();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // bfcache: al volver atrás/adelante, refresh de facets/subcats/precio.
      if (event.persisted) bump();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    // Evita loops si focus/visibility se disparan en ráfaga.
    if (now - facetsLastAttemptAtRef.current < 800) return;
    facetsLastAttemptAtRef.current = now;

    facetsAbortRef.current?.abort();
    const controller = new AbortController();
    facetsAbortRef.current = controller;
    setFacetsLoading(true);

    const next = new URLSearchParams(facetsFetchKey);
    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/catalog/facets-lite?${next.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { facets?: FacetsLite };
        const nextFacets = payload?.facets;
        if (isValidFacetsLite(nextFacets)) {
          setFacets(nextFacets);
          writeSessionJson(facetsSessionKey, nextFacets);
          facetsLastOkAtRef.current = Date.now();
        } else {
          // Mantén el último estado válido.
          setFacets((prev) => prev);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        // Mantén el último estado válido: es preferible a “romper” la UI al volver a una pestaña inactiva.
        setFacets((prev) => {
          if (prev) return prev;
          const cached = readSessionJson<unknown>(facetsSessionKey);
          return isValidFacetsLite(cached) ? cached : null;
        });
      } finally {
        window.clearTimeout(watchdog);
        setFacetsLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [facetsFetchKey, facetsSessionKey, resumeTick]);

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
            filtersCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[240px_minmax(0,1fr)]",
          ].join(" ")}
        >
          {!filtersCollapsed ? (
            <div
              id="catalog-filters-scroll"
              className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto lg:overscroll-contain lg:pr-1 lg:pb-8"
            >
              <div className="sticky top-0 z-20 bg-[color:var(--oda-cream)] pb-4">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-3">
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
