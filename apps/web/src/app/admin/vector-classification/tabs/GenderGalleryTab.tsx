"use client";

import { useCallback, useEffect, useState } from "react";
import FilterPills from "./FilterPills";
import GalleryGrid, { type GalleryProduct } from "./GalleryGrid";
import StickyActionBar from "./StickyActionBar";
import { useGalleryScroll } from "./useGalleryScroll";

/* ── Types ── */

type GenderProduct = GalleryProduct & {
  gender: string | null;
};

type GenderStats = Record<string, number>;

const GENDER_OPTIONS = [
  { key: "sin_asignar", label: "Sin asignar" },
  { key: "Mujer", label: "Mujer" },
  { key: "Hombre", label: "Hombre" },
  { key: "Unisex", label: "Unisex" },
  { key: "Infantil", label: "Infantil" },
] as const;

const GENDER_COLORS: Record<string, { bg: string; text: string }> = {
  Mujer: { bg: "bg-pink-500/30", text: "text-pink-100" },
  Hombre: { bg: "bg-sky-500/30", text: "text-sky-100" },
  Unisex: { bg: "bg-slate-500/30", text: "text-slate-100" },
  Infantil: { bg: "bg-amber-500/30", text: "text-amber-100" },
};

const ASSIGN_BUTTONS = [
  { gender: "Mujer", label: "Mujer", cls: "bg-pink-600 hover:bg-pink-500" },
  { gender: "Hombre", label: "Hombre", cls: "bg-sky-600 hover:bg-sky-500" },
  { gender: "Unisex", label: "Unisex", cls: "bg-slate-600 hover:bg-slate-500" },
  { gender: "Infantil", label: "Infantil", cls: "bg-amber-600 hover:bg-amber-500" },
] as const;

const PAGE_LIMIT = 60;

/* ── Component ── */

export default function GenderGalleryTab() {
  const [filter, setFilter] = useState("sin_asignar");
  const [stats, setStats] = useState<GenderStats>({});
  const [products, setProducts] = useState<GenderProduct[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const scroll = useGalleryScroll();

  /* ── Fetch stats ── */
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/gender/stats", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Error al cargar estadisticas");
      const data = (await res.json()) as { stats: GenderStats };
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar estadisticas");
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  /* ── Fetch products ── */
  const fetchProducts = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) {
        scroll.setLoadingMore(true);
      } else {
        setLoading(true);
        setSelected(new Set());
      }
      setError(null);
      try {
        const params = new URLSearchParams({
          filter,
          page: String(pageNum),
          limit: String(PAGE_LIMIT),
        });
        const res = await fetch(
          `/api/admin/vector-classification/gender/products?${params.toString()}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) throw new Error("Error al cargar productos");
        const data = (await res.json()) as {
          products: GenderProduct[];
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
        scroll.setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar productos");
        if (!append) setProducts([]);
      } finally {
        setLoading(false);
        scroll.setLoadingMore(false);
      }
    },
    [filter, scroll],
  );

  /* Reset when filter changes */
  useEffect(() => {
    scroll.resetScroll();
    fetchProducts(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  /* Load more */
  useEffect(() => {
    if (scroll.page > 1) {
      fetchProducts(scroll.page, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll.page]);

  /* ── Selection ── */
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(products.map((p) => p.id)));
  };

  const clearSelection = () => setSelected(new Set());

  /* ── Assign gender ── */
  const handleAssign = useCallback(
    async (gender: string) => {
      if (selected.size === 0 || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/vector-classification/gender/bulk-assign", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds: Array.from(selected),
            gender,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "No se pudo asignar");
        }
        // Remove assigned products from the list & refresh stats
        setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
        setSelected(new Set());
        setTotalProducts((prev) => prev - selected.size);
        await fetchStats();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al asignar");
      } finally {
        setBusy(false);
      }
    },
    [selected, busy, fetchStats],
  );

  /* ── Filter pills with counts ── */
  const pillOptions = GENDER_OPTIONS.map((opt) => ({
    key: opt.key,
    label: opt.label,
    count: stats[opt.key] ?? 0,
  }));

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <FilterPills options={pillOptions} activeKey={filter} onChange={setFilter} />
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-slate-500">Cargando productos...</p>}

      {/* Empty state */}
      {!loading && products.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No hay productos para este filtro.</p>
        </div>
      )}

      {/* Gallery */}
      {products.length > 0 && (
        <>
          {/* Quick actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Seleccionar todos ({products.length})
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  Limpiar
                </button>
              )}
            </div>
            <span className="text-xs text-slate-400">
              {products.length} de {totalProducts.toLocaleString("es-CO")}
            </span>
          </div>

          {/* Grid */}
          <GalleryGrid<GenderProduct>
            products={products}
            selected={selected}
            busy={busy}
            onToggleSelect={toggleSelect}
            renderOverlay={(product) => {
              if (!product.gender) return null;
              const colors = GENDER_COLORS[product.gender];
              if (!colors) return null;
              return (
                <div className={`absolute inset-x-0 bottom-0 ${colors.bg} px-1 py-0.5`}>
                  <p className={`text-center text-[9px] font-bold ${colors.text}`}>
                    {product.gender}
                  </p>
                </div>
              );
            }}
          />

          {/* Infinite scroll sentinel */}
          <div ref={scroll.sentinelRef} className="h-4" />
          {scroll.loadingMore && (
            <p className="text-center text-sm text-slate-500">Cargando mas productos...</p>
          )}
          {!scroll.hasMore && products.length > 0 && (
            <p className="text-center text-xs text-slate-400">
              Todos los productos cargados ({products.length})
            </p>
          )}
        </>
      )}

      {/* Sticky action bar */}
      <StickyActionBar selectedCount={selected.size} busy={busy}>
        {ASSIGN_BUTTONS.map((btn) => (
          <button
            key={btn.gender}
            type="button"
            onClick={() => handleAssign(btn.gender)}
            disabled={busy}
            className={`rounded-xl px-4 py-2 text-xs font-bold text-white shadow transition disabled:opacity-50 ${btn.cls}`}
          >
            {btn.label}
          </button>
        ))}
      </StickyActionBar>
    </div>
  );
}
