"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ── */

type SubcategoryStats = {
  subcategory: string;
  category: string;
  total: number;
  confirmed: number;
};

type ApiStatsItem = {
  subcategory: string;
  category: string;
  totalProducts: number;
  confirmedCount: number;
  isReady: boolean;
};

type ProductItem = {
  id: string;
  name: string;
  brandName: string | null;
  imageCoverUrl: string | null;
  subcategory: string | null;
  category: string | null;
  groundTruthId: string | null;
};

const PAGE_LIMIT = 60;

/* ── Helpers ── */

function groupByCategory(subcats: SubcategoryStats[]): Record<string, SubcategoryStats[]> {
  const grouped: Record<string, SubcategoryStats[]> = {};
  for (const s of subcats) {
    const cat = s.category || "sin_categoria";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  }
  const sorted: Record<string, SubcategoryStats[]> = {};
  for (const key of Object.keys(grouped).sort()) {
    sorted[key] = grouped[key].sort((a, b) => a.subcategory.localeCompare(b.subcategory));
  }
  return sorted;
}

/* ── Component ── */

export default function GroundTruthTab() {
  const [stats, setStats] = useState<SubcategoryStats[] | null>(null);
  const [grouped, setGrouped] = useState<Record<string, SubcategoryStats[]>>({});
  const [selectedSubcategory, setSelectedSubcategory] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  /* ── Fetch stats ── */
  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/admin/vector-classification/ground-truth/stats", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("No se pudieron cargar las estadisticas");
      const data = (await res.json()) as { stats: ApiStatsItem[] };
      const mapped: SubcategoryStats[] = data.stats.map((s) => ({
        subcategory: s.subcategory,
        category: s.category,
        total: s.totalProducts,
        confirmed: s.confirmedCount,
      }));
      setStats(mapped);
      setGrouped(groupByCategory(mapped));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar estadisticas");
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  /* ── Fetch products (page 1 = reset, page > 1 = append) ── */
  const fetchProducts = useCallback(
    async (pageNum: number, append: boolean) => {
      if (!selectedSubcategory) {
        setProducts([]);
        return;
      }
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setSelected(new Set());
      }
      setError(null);
      try {
        const params = new URLSearchParams({
          subcategory: selectedSubcategory,
          page: String(pageNum),
          limit: String(PAGE_LIMIT),
        });
        const res = await fetch(
          `/api/admin/vector-classification/products?${params.toString()}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) throw new Error("No se pudieron cargar los productos");
        const data = (await res.json()) as {
          products: ProductItem[];
          total: number;
          page: number;
          hasMore: boolean;
        };
        if (append) {
          setProducts((prev) => [...prev, ...data.products]);
        } else {
          setProducts(data.products);
        }
        setTotalProducts(data.total);
        setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar productos");
        if (!append) setProducts([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [selectedSubcategory],
  );

  /* ── Reset when subcategory changes ── */
  useEffect(() => {
    setPage(1);
    fetchProducts(1, false);
  }, [selectedSubcategory, fetchProducts]);

  /* ── Load more when page increments ── */
  useEffect(() => {
    if (page > 1) {
      fetchProducts(page, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  /* ── Infinite scroll observer ── */
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "400px" },
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, loadingMore]);

  /* ── Current stats ── */
  const currentStats = stats?.find((s) => s.subcategory === selectedSubcategory);

  /* ── Toggle selection ── */
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ── Select all unconfirmed ── */
  const selectAllUnconfirmed = () => {
    const ids = products.filter((p) => !p.groundTruthId).map((p) => p.id);
    setSelected(new Set(ids));
  };

  /* ── Clear selection ── */
  const clearSelection = () => setSelected(new Set());

  /* ── Confirm selected ── */
  const handleConfirmSelected = useCallback(async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cat = currentStats?.category ?? products[0]?.category ?? "";
      const res = await fetch("/api/admin/vector-classification/ground-truth/bulk-confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcategory: selectedSubcategory,
          category: cat,
          productIds: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo confirmar");
      }
      // Refresh: reload all loaded products and stats
      setPage(1);
      await Promise.all([fetchProducts(1, false), fetchStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar");
    } finally {
      setBusy(false);
    }
  }, [selected, busy, selectedSubcategory, products, currentStats, fetchProducts, fetchStats]);

  /* ── Unconfirm single product ── */
  const handleUnconfirm = useCallback(
    async (product: ProductItem) => {
      if (!product.groundTruthId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/vector-classification/ground-truth/${product.groundTruthId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!res.ok) throw new Error("No se pudo desconfirmar");
        // Update in place for responsiveness
        setProducts((prev) =>
          prev.map((p) =>
            p.id === product.id ? { ...p, groundTruthId: null } : p,
          ),
        );
        await fetchStats();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al desconfirmar");
      } finally {
        setBusy(false);
      }
    },
    [busy, fetchStats],
  );

  const unconfirmedCount = products.filter((p) => !p.groundTruthId).length;

  return (
    <div className="space-y-4">
      {/* Subcategory selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex-1">
            {loadingStats ? (
              <p className="text-sm text-slate-500">Cargando subcategorias...</p>
            ) : (
              <select
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                value={selectedSubcategory}
                onChange={(e) => setSelectedSubcategory(e.target.value)}
              >
                <option value="">-- Seleccionar subcategoria --</option>
                {Object.entries(grouped).map(([category, subcats]) => (
                  <optgroup key={category} label={category}>
                    {subcats.map((s) => (
                      <option key={s.subcategory} value={s.subcategory}>
                        {s.subcategory} ({s.confirmed}/{s.total})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          {/* Stats bar inline */}
          {currentStats && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="font-semibold">
                {currentStats.confirmed}/{currentStats.total}
              </span>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{
                    width: `${currentStats.total > 0 ? (currentStats.confirmed / currentStats.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-xs text-slate-400">
                {currentStats.total > 0
                  ? Math.round((currentStats.confirmed / currentStats.total) * 100)
                  : 0}
                %
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-slate-500">Cargando productos...</p>}

      {/* Empty states */}
      {!selectedSubcategory && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">Selecciona una subcategoria para ver los productos.</p>
        </div>
      )}
      {selectedSubcategory && !loading && products.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No hay productos en esta subcategoria.</p>
        </div>
      )}

      {/* Photo grid */}
      {products.length > 0 && (
        <>
          {/* Quick actions bar */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {unconfirmedCount > 0 && (
                <button
                  type="button"
                  onClick={selectAllUnconfirmed}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Seleccionar no confirmados ({unconfirmedCount})
                </button>
              )}
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  Limpiar seleccion
                </button>
              )}
            </div>
            <span className="text-xs text-slate-400">
              {products.length} de {totalProducts} productos
            </span>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {products.map((product) => {
              const isConfirmed = !!product.groundTruthId;
              const isSelected = selected.has(product.id);

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    if (isConfirmed) {
                      handleUnconfirm(product);
                    } else {
                      toggleSelect(product.id);
                    }
                  }}
                  disabled={busy}
                  title={`${product.name}\n${product.brandName || "Sin marca"}`}
                  className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition-all disabled:opacity-60 ${
                    isConfirmed
                      ? "border-emerald-400 ring-2 ring-emerald-200"
                      : isSelected
                        ? "border-indigo-500 ring-2 ring-indigo-200"
                        : "border-transparent hover:border-slate-300"
                  }`}
                >
                  {product.imageCoverUrl ? (
                    <img
                      src={product.imageCoverUrl}
                      alt={product.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[9px] text-slate-400">
                      Sin img
                    </div>
                  )}

                  {/* Confirmed badge */}
                  {isConfirmed && (
                    <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/30">
                      <svg className="h-6 w-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  {/* Selected indicator */}
                  {isSelected && !isConfirmed && (
                    <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  {/* Hover tooltip with name */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="truncate text-[10px] leading-tight text-white">{product.name}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <p className="text-center text-sm text-slate-500">Cargando mas productos...</p>
          )}
          {!hasMore && products.length > 0 && (
            <p className="text-center text-xs text-slate-400">
              Todos los productos cargados ({products.length})
            </p>
          )}
        </>
      )}

      {/* Sticky confirm bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-semibold text-indigo-700">
            {selected.size} producto{selected.size > 1 ? "s" : ""} seleccionado{selected.size > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={handleConfirmSelected}
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Confirmando..." : `Confirmar ${selected.size}`}
          </button>
        </div>
      )}
    </div>
  );
}
