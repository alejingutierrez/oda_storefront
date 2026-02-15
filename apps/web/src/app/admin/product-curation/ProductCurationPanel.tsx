"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import CatalogFiltersPanel from "@/components/CatalogFiltersPanel";
import {
  GENDER_LABELS,
  SEASON_LABELS,
} from "@/lib/product-enrichment/constants";
import type { TaxonomyOptions } from "@/lib/taxonomy/types";
import BulkEditModal, { type BulkChange, type BulkResult } from "./BulkEditModal";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
};

type Facets = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  seoTags: FacetItem[];
  colors: FacetItem[];
  sizes: FacetItem[];
  fits: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
  occasions: FacetItem[];
  seasons: FacetItem[];
  styles: FacetItem[];
};

type CurationProduct = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brandName: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  season: string | null;
  stylePrimary: string | null;
  styleSecondary: string | null;
  status: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  variantCount: number;
  inStockCount: number;
  hasEnrichment: boolean;
};

type ProductsResponse = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  items: CurationProduct[];
};

type SelectionBanner = { kind: "info" | "warning"; text: string };

const PAGE_SIZE = 36;
const SELECT_ALL_LIMIT = 1200;

type CssVarStyle = CSSProperties & Record<`--${string}`, string>;

function buildSearchKey(params: URLSearchParams) {
  const next = new URLSearchParams(params.toString());
  // Infinite scroll maneja page internamente.
  next.delete("page");
  next.delete("pageSize");
  return next.toString();
}

function isAbortError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  if (!("name" in err)) return false;
  return (err as { name?: unknown }).name === "AbortError";
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) return "Consultar";
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? "COP"} ${value.toFixed(0)}`;
  }
}

function formatPriceRange(minPrice: string | null, maxPrice: string | null, currency: string | null) {
  if (!minPrice && !maxPrice) return "Consultar";
  if (!maxPrice || minPrice === maxPrice) return formatPrice(minPrice ?? maxPrice, currency);
  return `${formatPrice(minPrice, currency)} · ${formatPrice(maxPrice, currency)}`;
}

function formatStyleProfile(key: string | null, labels?: Record<string, string> | null) {
  if (!key) return "—";
  return labels?.[key] ?? key;
}

function formatLabel(value: string | null, map: Record<string, string>) {
  if (!value) return "—";
  return map[value] ?? value;
}

export default function ProductCurationPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [facets, setFacets] = useState<Facets | null>(null);
  const [subcategories, setSubcategories] = useState<FacetItem[]>([]);
  const [products, setProducts] = useState<CurationProduct[]>([]);
  const [taxonomyOptions, setTaxonomyOptions] = useState<TaxonomyOptions | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [lastBulkMessage, setLastBulkMessage] = useState<string | null>(null);
  const [selectionBanner, setSelectionBanner] = useState<SelectionBanner | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem("oda_admin_product_curation_selected");
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((item) => typeof item === "string"));
    } catch {
      return new Set();
    }
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const searchKey = useMemo(() => buildSearchKey(searchParams), [searchParams]);
  const filterCategoryKeys = useMemo(() => {
    const params = new URLSearchParams(searchKey);
    const raw = params
      .getAll("category")
      .map((value) => value.trim())
      .filter(Boolean);
    return Array.from(new Set(raw));
  }, [searchKey]);
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const fetchTaxonomyOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/taxonomy/options", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "No se pudo cargar taxonomía");
      }
      const payload = await res.json().catch(() => ({}));
      setTaxonomyOptions(payload?.options ?? null);
    } catch (err) {
      console.warn(err);
      setTaxonomyOptions(null);
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        "oda_admin_product_curation_selected",
        JSON.stringify(Array.from(selectedIds).slice(0, 5000)),
      );
    } catch {
      // ignore
    }
  }, [selectedIds]);

  useEffect(() => {
    fetchTaxonomyOptions();
  }, [fetchTaxonomyOptions]);

  const fetchFacets = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/product-curation/facets?${searchKey}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "No se pudieron cargar filtros");
      }
      const payload = await res.json();
      setFacets(payload.facets ?? null);
      setSubcategories(payload.subcategories ?? []);
    } catch (err) {
      console.warn(err);
      setFacets(null);
      setSubcategories([]);
      setError(err instanceof Error ? err.message : "Error cargando filtros");
    }
  }, [searchKey]);

  const fetchPage = useCallback(
    async (nextPage: number, mode: "reset" | "append") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === "reset") setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams(searchKey);
        params.set("page", String(nextPage));
        params.set("pageSize", String(PAGE_SIZE));
        const res = await fetch(`/api/admin/product-curation/products?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error ?? "No se pudieron cargar productos");
        }
        const payload: ProductsResponse = await res.json();
        const items = Array.isArray(payload.items) ? payload.items : [];

        setTotalCount(typeof payload.totalCount === "number" ? payload.totalCount : null);
        setHasMore(Boolean(payload.hasMore));
        setPage(payload.page ?? nextPage);

        setProducts((prev) => {
          if (mode === "reset") return items;
          const existing = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of items) {
            if (existing.has(item.id)) continue;
            merged.push(item);
          }
          return merged;
        });
      } catch (err) {
        if (isAbortError(err)) return;
        console.warn(err);
        setError(err instanceof Error ? err.message : "Error cargando productos");
        setHasMore(false);
      } finally {
        if (mode === "reset") setLoading(false);
        else setLoadingMore(false);
      }
    },
    [searchKey],
  );

  useEffect(() => {
    setLastBulkMessage(null);
    setSelectionBanner(null);
    setPage(1);
    setHasMore(true);
    setTotalCount(null);
    setProducts([]);
    fetchFacets();
    fetchPage(1, "reset");
  }, [fetchFacets, fetchPage, searchKey]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, "append");
  }, [fetchPage, hasMore, loading, loadingMore, page]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMore();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedCount = selectedIds.size;

  const handleSelectAll = useCallback(async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    setSelectionBanner(null);
    try {
      const params = new URLSearchParams(searchKey);
      params.set("limit", String(SELECT_ALL_LIMIT));
      const res = await fetch(`/api/admin/product-curation/ids?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "No se pudieron seleccionar los productos");
      }
      const payload = await res.json().catch(() => ({}));
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id: unknown) => typeof id === "string") : [];
      const hasMore = Boolean(payload?.hasMore);
      const limit = typeof payload?.limit === "number" ? payload.limit : SELECT_ALL_LIMIT;
      setSelectedIds(new Set(ids));
      if (hasMore) {
        setSelectionBanner({
          kind: "warning",
          text: `Seleccionados ${ids.length.toLocaleString("es-CO")}. Hay más resultados; ajusta filtros para no exceder el límite (${limit.toLocaleString("es-CO")}).`,
        });
      } else {
        setSelectionBanner({
          kind: "info",
          text: `Seleccionados ${ids.length.toLocaleString("es-CO")} producto(s).`,
        });
      }
    } catch (err) {
      console.warn(err);
      setSelectionBanner({
        kind: "warning",
        text: err instanceof Error ? err.message : "No se pudieron seleccionar los productos",
      });
    } finally {
      setSelectingAll(false);
    }
  }, [searchKey, selectingAll]);

  const handleBulkApply = useCallback(
    async (payload: { productIds: string[]; changes: BulkChange[] }) => {
      const res = await fetch("/api/admin/product-curation/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: payload.productIds,
          changes: payload.changes,
        }),
      });
      const responsePayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(responsePayload?.error ?? "No se pudo aplicar el bulk edit");
      }
      const updatedCount = responsePayload.updatedCount ?? 0;
      const unchangedCount = responsePayload.unchangedCount ?? 0;
      setLastBulkMessage(`Actualizados: ${updatedCount}. Sin cambios: ${unchangedCount}.`);
      clearSelection();
      // Refresca lista/facets. Es esperado que algunos productos dejen de coincidir con filtros.
      fetchFacets();
      fetchPage(1, "reset");
      return { ok: true, ...responsePayload } as BulkResult;
    },
    [clearSelection, fetchFacets, fetchPage],
  );

  const catalogThemeVars = useMemo(() => {
    const vars: CssVarStyle = {
      "--oda-ink": "#0f172a",
      "--oda-ink-soft": "#334155",
      "--oda-cream": "#f8fafc",
      "--oda-stone": "#f1f5f9",
      "--oda-taupe": "#64748b",
      "--oda-gold": "#e2e8f0",
      "--oda-border": "#e2e8f0",
    };
    return vars;
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div style={catalogThemeVars}>
        {facets ? (
          <CatalogFiltersPanel facets={facets} subcategories={subcategories} />
        ) : (
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            Cargando filtros…
          </aside>
        )}
      </div>

      <section className="space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Módulo de curación humana</p>
              <p className="mt-2 text-sm text-slate-600">
                {totalCount === null ? "—" : totalCount.toLocaleString("es-CO")} productos ·{" "}
                {loading ? "cargando…" : products.length.toLocaleString("es-CO")} en vista
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                disabled={loading || selectingAll || totalCount === 0}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                title="Abre el modal. Puedes aplicar a la selección o al filtro actual."
              >
                Editar en bloque
              </button>
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={loading || selectingAll}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {selectingAll ? "Seleccionando…" : "Seleccionar todos"}
              </button>
              <button
                type="button"
                onClick={() => fetchPage(1, "reset")}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Recargar
              </button>
              <button
                type="button"
                onClick={() => router.replace("/admin/product-curation", { scroll: false })}
                className="rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Limpiar filtros
              </button>
            </div>
          </div>
          {error ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {lastBulkMessage ? (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {lastBulkMessage}
            </p>
          ) : null}
          {selectionBanner ? (
            <p
              className={classNames(
                "mt-4 rounded-xl border px-4 py-3 text-sm",
                selectionBanner.kind === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-700",
              )}
            >
              {selectionBanner.text}
            </p>
          ) : null}
        </header>

        {loading && products.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
            Cargando productos…
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-lg font-semibold text-slate-900">No encontramos productos con esos filtros.</p>
            <p className="mt-2 text-sm text-slate-600">Ajusta filtros o limpia para ampliar resultados.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const selected = selectedIds.has(product.id);
              return (
                <article
                  key={product.id}
                  className={classNames(
                    "relative overflow-hidden rounded-2xl border bg-white shadow-sm transition",
                    selected ? "border-slate-900 ring-2 ring-slate-900/10" : "border-slate-200",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelection(product.id)}
                    className="absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm"
                  >
                    <span
                      className={classNames(
                        "h-3 w-3 rounded-[6px] border",
                        selected ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white",
                      )}
                      aria-hidden
                    />
                    {selected ? "Seleccionado" : "Seleccionar"}
                  </button>

                  {product.hasEnrichment ? (
                    <span className="absolute right-3 top-3 z-10 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
                      Enriquecido
                    </span>
                  ) : null}

                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
                    {product.imageCoverUrl ? (
                      <Image
                        src={product.imageCoverUrl}
                        alt={product.name}
                        fill
                        className="object-cover object-center"
                        sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 90vw"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-400">
                        Sin imagen
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 p-5">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{product.brandName}</p>
                      <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">{product.name}</h3>
                      <p className="text-xs text-slate-600">
                        {formatPriceRange(product.minPrice, product.maxPrice, product.currency)} ·{" "}
                        {product.inStockCount}/{product.variantCount} en stock
                      </p>
                    </div>

                    <div className="grid gap-2 text-xs text-slate-700">
                      <p>
                        <span className="font-semibold text-slate-800">Categoría:</span>{" "}
                        {formatLabel(product.category, taxonomyOptions?.categoryLabels ?? {})}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Subcategoría:</span>{" "}
                        {formatLabel(product.subcategory, taxonomyOptions?.subcategoryLabels ?? {})}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Género:</span>{" "}
                        {formatLabel(product.gender, GENDER_LABELS)}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Temporada:</span>{" "}
                        {formatLabel(product.season, SEASON_LABELS)}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Estilo:</span>{" "}
                        {formatStyleProfile(product.stylePrimary, taxonomyOptions?.styleProfileLabels)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {product.sourceUrl ? (
                        <a
                          href={product.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700"
                        >
                          Ver fuente
                        </a>
                      ) : (
                        <span className="text-slate-400">Sin fuente</span>
                      )}
                      <span className="text-slate-400">
                        Actualizado: {new Date(product.updatedAt).toLocaleDateString("es-CO")}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div ref={sentinelRef} className="h-10" aria-hidden />

        {loadingMore ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600">
            Cargando más…
          </div>
        ) : !hasMore && products.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-500">
            No hay más resultados.
          </div>
        ) : null}
      </section>

      {selectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{selectedCount}</span> seleccionado(s)
              <span className="ml-2 text-xs text-slate-400">(pueden no estar en la vista actual)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={selectingAll}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {selectingAll ? "Seleccionando…" : "Seleccionar todos"}
              </button>
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                disabled={selectingAll}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Editar en bloque
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectingAll}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Limpiar selección
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <BulkEditModal
        open={bulkOpen}
        selectedCount={selectedCount}
        selectedIds={selectedIdList}
        categoriesFromFilters={filterCategoryKeys}
        searchKey={searchKey}
        taxonomyOptions={taxonomyOptions}
        onClose={() => setBulkOpen(false)}
        onApply={handleBulkApply}
      />
    </div>
  );
}
