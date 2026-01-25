"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
const BATCH_OPTIONS = [10, 25, 50, 100, 250, 500, 1000];

type BrandOption = {
  id: string;
  name: string;
  productCount: number;
};

type RunSummary = {
  runId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  lastError?: string | null;
  blockReason?: string | null;
  lastProductId?: string | null;
  lastStage?: string | null;
  consecutiveErrors?: number;
};

type CoverageCounts = {
  total: number;
  enriched: number;
  remaining: number;
};

const buildProgress = (summary: RunSummary | null) => {
  if (!summary) return { total: 0, completed: 0, failed: 0, pending: 0, percent: 0 };
  const total = summary.total ?? 0;
  const completed = summary.completed ?? 0;
  const failed = summary.failed ?? 0;
  const pending = summary.pending ?? Math.max(0, total - completed - failed);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, failed, pending, percent };
};

export default function ProductEnrichmentPanel() {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [scope, setScope] = useState<"brand" | "all">("brand");
  const [batchSize, setBatchSize] = useState<number>(BATCH_OPTIONS[0] ?? 10);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [counts, setCounts] = useState<CoverageCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeEnriched, setIncludeEnriched] = useState(false);

  const fetchBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/products/brands", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudieron cargar marcas");
      const payload = await res.json();
      setBrands(payload.brands ?? []);
      if (!selectedBrand && payload.brands?.length) {
        setSelectedBrand(payload.brands[0].id);
      }
    } catch (err) {
      console.warn(err);
      setBrands([]);
    }
  }, [selectedBrand]);

  const fetchSummary = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("scope", scope);
    if (scope === "brand" && selectedBrand) params.set("brandId", selectedBrand);
    try {
      const res = await fetch(`/api/admin/product-enrichment/state?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const payload = await res.json();
      setSummary(payload.summary ?? null);
      setCounts(payload.counts ?? null);
    } catch (err) {
      console.warn(err);
    }
  }, [scope, selectedBrand]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  useEffect(() => {
    if (scope === "brand" && !selectedBrand && brands.length) {
      setSelectedBrand(brands[0]?.id ?? "");
    }
  }, [scope, selectedBrand, brands]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (summary?.status !== "processing") return;
    const interval = setInterval(() => {
      fetchSummary();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchSummary, summary?.status]);

  const progress = useMemo(() => buildProgress(summary), [summary]);

  const shouldResume = useMemo(() => {
    if (!summary) return false;
    return summary.status === "paused" || summary.status === "stopped";
  }, [summary]);

  const handleRun = async (mode: "batch" | "all") => {
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        scope,
        mode,
        limit: mode === "batch" ? batchSize : null,
        resume: shouldResume,
        includeEnriched,
        drainOnRun: false,
      };
      if (scope === "brand") payload.brandId = selectedBrand;
      const res = await fetch("/api/admin/product-enrichment/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.error || "No se pudo iniciar el enriquecimiento");
      }
      const responsePayload = await res.json();
      setSummary(responsePayload.summary ?? null);
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    if (!summary) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/product-enrichment/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: summary.runId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "No se pudo pausar");
      setSummary(payload.summary ?? null);
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!summary) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/product-enrichment/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: summary.runId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "No se pudo detener");
      setSummary(payload.summary ?? null);
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Enriquecimiento de características</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Ejecuta GPT-5 mini sobre productos y variantes para reemplazar categoría, tags, género,
            temporada y colores (HEX + Pantone). Se puede correr por marca, por batch o global.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchSummary}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Refrescar estado
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Alcance</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScope("brand")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                scope === "brand"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Por marca
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                scope === "all"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Todas las marcas
            </button>
          </div>
          <div className="mt-4">
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Marca</label>
            <select
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={selectedBrand}
              onChange={(event) => setSelectedBrand(event.target.value)}
              disabled={scope !== "brand"}
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name} ({brand.productCount})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Progreso</p>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            <p>
              Cobertura:{" "}
              <span className="font-semibold text-slate-900">
                {counts?.enriched ?? 0}
              </span>{" "}
              enriquecidos ·{" "}
              <span className="font-semibold text-slate-900">
                {counts?.remaining ?? 0}
              </span>{" "}
              pendientes ·{" "}
              <span className="font-semibold text-slate-900">
                {counts?.total ?? 0}
              </span>{" "}
              total
            </p>
            <p>
              Estado: <span className="font-semibold text-slate-900">{summary?.status ?? "—"}</span>
            </p>
            <p>
              Total: <span className="font-semibold text-slate-900">{progress.total}</span> ·
              Completados: <span className="font-semibold text-slate-900">{progress.completed}</span> ·
              Fallidos: <span className="font-semibold text-slate-900">{progress.failed}</span>
            </p>
            <p>
              Pendientes: <span className="font-semibold text-slate-900">{progress.pending}</span>
            </p>
            {summary?.lastError && (
              <p className="text-xs text-rose-600">Último error: {summary.lastError}</p>
            )}
            {summary?.blockReason && (
              <p className="text-xs text-amber-600">Bloqueado: {summary.blockReason}</p>
            )}
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Batch</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={batchSize}
              onChange={(event) => setBatchSize(Number(event.target.value))}
            >
              {BATCH_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} productos
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleRun("batch")}
              disabled={loading || (scope === "brand" && !selectedBrand)}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {shouldResume ? "Resume batch" : "Ejecutar batch"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Selecciona {batchSize} productos al azar dentro del alcance; por defecto excluye los ya
            enriquecidos.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Todos</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleRun("all")}
              disabled={loading || (scope === "brand" && !selectedBrand)}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {scope === "brand" ? "Todos los productos de la marca" : "Todos los productos"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Procesa todo el catálogo del alcance seleccionado.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <input
          id="includeEnriched"
          type="checkbox"
          checked={includeEnriched}
          onChange={(event) => setIncludeEnriched(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <label htmlFor="includeEnriched">Incluir productos ya enriquecidos</label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handlePause}
          disabled={loading || !summary}
          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 disabled:opacity-60"
        >
          Pausar
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={loading || !summary}
          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 disabled:opacity-60"
        >
          Detener
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </section>
  );
}
