"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BrandOption = {
  id: string;
  name: string;
  slug: string;
  siteUrl: string | null;
  ecommercePlatform: string | null;
  _count: { products: number };
};

type ExtractSummary = {
  brandId: string;
  platform: string;
  discovered: number;
  processed: number;
  created: number;
  updated: number;
  errors: Array<{ url: string; error: string }>;
  status?: string;
  runId?: string;
  pending?: number;
  failed?: number;
  total?: number;
};

export default function CatalogExtractorPanel() {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<ExtractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = useMemo(() => {
    if (!summary) {
      return {
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        percent: 0,
      };
    }
    const total = summary.total ?? summary.discovered ?? 0;
    const failed = summary.failed ?? 0;
    const pending = summary.pending ?? Math.max(0, total - (summary.processed ?? 0));
    const completed = Math.max(0, total - pending - failed);
    const percent = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, failed, pending, percent };
  }, [summary]);

  const fetchBrands = useCallback(async () => {
    setLoadingBrands(true);
    try {
      const res = await fetch("/api/admin/catalog-extractor/brands?limit=200", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudieron cargar las marcas");
      const payload = await res.json();
      setBrands(payload.brands ?? []);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoadingBrands(false);
    }
  }, []);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  const selected = useMemo(() => brands.find((brand) => brand.id === selectedBrand) ?? null, [brands, selectedBrand]);

  const runExtraction = async () => {
    if (!selectedBrand) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/catalog-extractor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: selectedBrand, limit }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Fallo ejecutando extractor");
      }
      const payload = await res.json();
      setSummary(payload.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Catalog extractor</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Ejecuta scrapping por tecnologia para extraer catalogo completo y normalizar con OpenAI. Las imagenes se suben a Blob y los productos se guardan en Neon.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1.3fr,0.7fr,0.5fr]">
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-500">Marca (con tecnologia detectada)</label>
          <select
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={selectedBrand}
            onChange={(event) => setSelectedBrand(event.target.value)}
          >
            <option value="">Selecciona una marca</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name} · {brand.ecommercePlatform} · {brand._count.products} productos
              </option>
            ))}
          </select>
          {loadingBrands && <p className="mt-2 text-xs text-slate-500">Cargando marcas...</p>}
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-500">Limite de productos</label>
          <input
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) || 0)}
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={runExtraction}
            disabled={running || !selectedBrand}
            className="w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {running ? "Ejecutando..." : "Ejecutar"}
          </button>
        </div>
      </div>

      {selected && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">Sitio:</span> {selected.siteUrl ?? "—"}
          </p>
          <p>
            <span className="font-semibold text-slate-800">Plataforma:</span> {selected.ecommercePlatform ?? "—"}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="md:col-span-3 rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <p className="uppercase tracking-[0.2em]">Progreso</p>
              <p>
                {progress.completed}/{progress.total} completados · {progress.failed} fallidos ·{" "}
                {progress.pending} pendientes
              </p>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="flex h-full w-full">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
                />
                <div
                  className="h-full bg-rose-500"
                  style={{ width: `${progress.total ? (progress.failed / progress.total) * 100 : 0}%` }}
                />
                <div
                  className="h-full bg-slate-300"
                  style={{ width: `${progress.total ? (progress.pending / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{progress.percent}% completado</p>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Estado: {summary.status ?? "—"}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Descubiertos</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{summary.discovered}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Procesados</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{summary.processed}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Creados / Actualizados</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {summary.created} / {summary.updated}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Pendientes / Fallidos</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {summary.pending ?? "—"} / {summary.failed ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Estado</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{summary.status ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Run ID</p>
            <p className="mt-2 text-xs font-mono text-slate-700">{summary.runId ?? "—"}</p>
          </div>
          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Errores</p>
            {summary.errors.length ? (
              <div className="mt-2 space-y-2 text-xs text-slate-600">
                {summary.errors.map((item) => (
                  <p key={item.url}>
                    {item.url} — {item.error}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Sin errores registrados.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
