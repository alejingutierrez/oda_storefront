"use client";

import { useCallback, useEffect, useState } from "react";
import { REAL_STYLE_OPTIONS, type RealStyleKey } from "@/lib/real-style/constants";
import FilterPills from "./FilterPills";
import GalleryGrid, { type GalleryProduct } from "./GalleryGrid";
import StickyActionBar from "./StickyActionBar";
import { useGalleryScroll } from "./useGalleryScroll";

/* ── Types ── */

type StyleProduct = GalleryProduct & {
  realStyle: string | null;
  suggestedStyle: string | null;
  suggestionScore: number;
};

type StyleSummary = {
  eligibleTotal: number;
  pendingCount: number;
  assignedCount: number;
  byRealStyle: Array<{ key: string; label: string; count: number }>;
};

/* ── Style color map for overlays and badges ── */

const STYLE_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  "01_minimalismo_neutro_pulido": { bg: "bg-stone-500/30", text: "text-stone-100", badge: "bg-stone-600" },
  "17_street_clean": { bg: "bg-zinc-500/30", text: "text-zinc-100", badge: "bg-zinc-600" },
  "30_tropi_boho_playa": { bg: "bg-orange-500/30", text: "text-orange-100", badge: "bg-orange-600" },
  "21_gym_funcional": { bg: "bg-lime-500/30", text: "text-lime-100", badge: "bg-lime-600" },
  "15_invitado_evento": { bg: "bg-violet-500/30", text: "text-violet-100", badge: "bg-violet-600" },
  "28_artesanal_contemporaneo": { bg: "bg-amber-500/30", text: "text-amber-100", badge: "bg-amber-700" },
  "09_coastal_preppy": { bg: "bg-cyan-500/30", text: "text-cyan-100", badge: "bg-cyan-600" },
  "50_cozy_homewear": { bg: "bg-rose-500/30", text: "text-rose-100", badge: "bg-rose-600" },
};

const STYLE_SHORT_LABELS: Record<string, string> = {
  "01_minimalismo_neutro_pulido": "Min",
  "17_street_clean": "Str",
  "30_tropi_boho_playa": "Boh",
  "21_gym_funcional": "Gym",
  "15_invitado_evento": "Evt",
  "28_artesanal_contemporaneo": "Art",
  "09_coastal_preppy": "Cst",
  "50_cozy_homewear": "Czy",
};

const PAGE_LIMIT = 60;

/* ── Component ── */

export default function StyleGalleryTab() {
  const [filter, setFilter] = useState("sin_asignar");
  const [summary, setSummary] = useState<StyleSummary | null>(null);
  const [products, setProducts] = useState<StyleProduct[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const scroll = useGalleryScroll();

  /* ── Fetch summary (reuse existing real-style endpoint) ── */
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/real-style/summary", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Error al cargar resumen");
      const data = (await res.json()) as { summary: StyleSummary };
      setSummary(data.summary);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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
          `/api/admin/vector-classification/style/products?${params.toString()}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) throw new Error("Error al cargar productos");
        const data = (await res.json()) as {
          products: StyleProduct[];
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
    setSelected(new Set(products.filter((p) => !p.realStyle).map((p) => p.id)));
  };

  const clearSelection = () => setSelected(new Set());

  /* ── Assign style ── */
  const handleAssign = useCallback(
    async (realStyle: RealStyleKey) => {
      if (selected.size === 0 || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/real-style/bulk-assign", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds: Array.from(selected),
            realStyle,
            includeSummary: true,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "No se pudo asignar");
        }
        const data = await res.json().catch(() => ({}));
        // Remove assigned products from the list
        setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
        setSelected(new Set());
        setTotalProducts((prev) => prev - (data.assignedCount ?? selected.size));
        if (data.summary) setSummary(data.summary);
        else await fetchSummary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al asignar");
      } finally {
        setBusy(false);
      }
    },
    [selected, busy, fetchSummary],
  );

  /* ── Filter pills ── */
  const pillOptions = [
    {
      key: "sin_asignar",
      label: "Sin asignar",
      count: summary?.pendingCount ?? 0,
    },
    ...REAL_STYLE_OPTIONS.map((opt) => ({
      key: opt.key,
      label: opt.label,
      count: summary?.byRealStyle.find((s) => s.key === opt.key)?.count ?? 0,
    })),
  ];

  const unassignedCount = products.filter((p) => !p.realStyle).length;

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-2">
          <FilterPills options={pillOptions} activeKey={filter} onChange={setFilter} />
          {summary && (
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                Elegibles: <strong>{summary.eligibleTotal.toLocaleString("es-CO")}</strong>
              </span>
              <span>
                Asignados: <strong>{summary.assignedCount.toLocaleString("es-CO")}</strong>
              </span>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{
                    width: `${summary.eligibleTotal > 0 ? (summary.assignedCount / summary.eligibleTotal) * 100 : 0}%`,
                  }}
                />
              </div>
              <span>
                {summary.eligibleTotal > 0
                  ? Math.round((summary.assignedCount / summary.eligibleTotal) * 100)
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
              {unassignedCount > 0 && (
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Seleccionar sin asignar ({unassignedCount})
                </button>
              )}
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
          <GalleryGrid<StyleProduct>
            products={products}
            selected={selected}
            busy={busy}
            onToggleSelect={toggleSelect}
            renderOverlay={(product) => {
              if (!product.realStyle) return null;
              const colors = STYLE_COLORS[product.realStyle];
              const label = REAL_STYLE_OPTIONS.find((o) => o.key === product.realStyle)?.label ?? product.realStyle;
              return (
                <div className={`absolute inset-x-0 bottom-0 ${colors?.bg ?? "bg-slate-500/30"} px-1 py-0.5`}>
                  <p className={`text-center text-[8px] font-bold ${colors?.text ?? "text-slate-100"}`}>
                    {label}
                  </p>
                </div>
              );
            }}
            renderBadge={(product) => {
              if (product.realStyle || !product.suggestedStyle || product.suggestionScore < 0.1) return null;
              const colors = STYLE_COLORS[product.suggestedStyle];
              const shortLabel = STYLE_SHORT_LABELS[product.suggestedStyle] ?? "?";
              return (
                <div
                  className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold text-white shadow ${colors?.badge ?? "bg-slate-600"}`}
                  style={{ opacity: product.suggestionScore >= 0.5 ? 1 : 0.65 }}
                  title={`Sugerido: ${REAL_STYLE_OPTIONS.find((o) => o.key === product.suggestedStyle)?.label ?? product.suggestedStyle} (${Math.round(product.suggestionScore * 100)}%)`}
                >
                  {shortLabel}
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
        {REAL_STYLE_OPTIONS.map((opt) => {
          const colors = STYLE_COLORS[opt.key];
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleAssign(opt.key)}
              disabled={busy}
              className={`rounded-xl px-3 py-1.5 text-[10px] font-bold text-white shadow transition disabled:opacity-50 ${colors?.badge ?? "bg-slate-600"} hover:opacity-80`}
            >
              {opt.label}
            </button>
          );
        })}
      </StickyActionBar>
    </div>
  );
}
