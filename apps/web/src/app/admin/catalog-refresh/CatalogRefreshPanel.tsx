"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RefreshSummary = {
  totalBrands: number;
  freshBrands: number;
  staleBrands: number;
  newProducts: number;
  priceChanges: number;
  stockChanges: number;
  stockStatusChanges: number;
};

type RefreshBrand = {
  id: string;
  name: string;
  siteUrl: string | null;
  ecommercePlatform: string | null;
  manualReview: boolean;
  productCount: number;
  refresh: Record<string, any>;
  due: boolean;
};

type RefreshState = {
  summary: RefreshSummary;
  brands: RefreshBrand[];
  windowStart: string;
};

const POLL_MS = 15000;

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
};

const percent = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";

export default function CatalogRefreshPanel() {
  const [state, setState] = useState<RefreshState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/catalog-refresh/state", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el estado de refresh.");
      const payload = (await res.json()) as RefreshState;
      setState(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerBatch = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/admin/catalog-refresh/cron${force ? "?force=true" : ""}`);
      if (!res.ok) throw new Error("No se pudo iniciar el refresh.");
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }, [fetchState]);

  const triggerBrand = useCallback(async (brandId: string) => {
    try {
      const res = await fetch(`/api/admin/catalog-refresh/cron?brandId=${brandId}&force=true`);
      if (!res.ok) throw new Error("No se pudo iniciar el refresh de la marca.");
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }, [fetchState]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(fetchState, POLL_MS);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchState, state]);

  const summary = state?.summary;
  const brands = state?.brands ?? [];
  const windowStart = state?.windowStart;

  const freshness = useMemo(() => {
    if (!summary) return { fresh: 0, total: 0, percent: 0 };
    const total = summary.totalBrands;
    const fresh = summary.freshBrands;
    const value = total > 0 ? Math.round((fresh / total) * 100) : 0;
    return { fresh, total, percent: value };
  }, [summary]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Refresh semanal de catálogo</h2>
          <p className="text-sm text-slate-600">
            Ventana analizada desde {windowStart ? formatDate(windowStart) : "—"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={() => triggerBatch(false)}
            disabled={loading}
          >
            Ejecutar batch
          </button>
          <button
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => triggerBatch(true)}
            disabled={loading}
          >
            Forzar refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Frescura global</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {percent(freshness.fresh, freshness.total)}
          </p>
          <p className="text-sm text-slate-600">
            {freshness.fresh} de {freshness.total} marcas
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-slate-900 transition-all"
              style={{ width: `${freshness.percent}%` }}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Nuevos productos</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {summary?.newProducts ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Cambios de precio</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {summary?.priceChanges ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Cambios de stock</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {summary?.stockChanges ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Estado stock</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {summary?.stockStatusChanges ?? 0}
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="px-3">Marca</th>
              <th className="px-3">Plataforma</th>
              <th className="px-3">Productos</th>
              <th className="px-3">Último refresh</th>
              <th className="px-3">Estado</th>
              <th className="px-3">Nuevos</th>
              <th className="px-3">Precio</th>
              <th className="px-3">Stock</th>
              <th className="px-3">Estado</th>
              <th className="px-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => {
              const refresh = brand.refresh ?? {};
              return (
                <tr key={brand.id} className="rounded-xl bg-white shadow-sm">
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {brand.name}
                    {brand.manualReview ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        manual
                      </span>
                    ) : null}
                    {brand.due ? (
                      <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        overdue
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{brand.ecommercePlatform ?? "—"}</td>
                  <td className="px-3 py-3 text-slate-600">{brand.productCount}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {formatDate(refresh.lastCompletedAt)}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {refresh.lastStatus ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {refresh.lastNewProducts ?? 0}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {refresh.lastPriceChanges ?? 0}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {refresh.lastStockChanges ?? 0}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {refresh.lastStockStatusChanges ?? 0}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => triggerBrand(brand.id)}
                      disabled={loading}
                    >
                      Forzar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
