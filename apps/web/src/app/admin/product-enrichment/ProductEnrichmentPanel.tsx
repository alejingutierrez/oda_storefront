"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

type RunMeta = {
  id: string;
  status: string;
  scope: string;
  brandId?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
};

type ItemCounts = {
  total?: number;
  pending?: number;
  queued?: number;
  in_progress?: number;
  completed?: number;
  failed?: number;
};

type CoverageCounts = {
  total: number;
  enriched: number;
  remaining: number;
  lowConfidence?: number;
  reviewRequired?: number;
};

type ReviewItem = {
  id: string;
  name: string;
  brandId: string;
  brandName?: string | null;
  category?: string | null;
  subcategory?: string | null;
  imageCoverUrl?: string | null;
  sourceUrl?: string | null;
  updatedAt?: string | null;
  confidenceOverall?: number | null;
  reviewRequired: boolean;
  reviewReasons: string[];
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

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const normalizeBatchSize = (value: number) => {
  if (BATCH_OPTIONS.includes(value)) return value;
  return BATCH_OPTIONS[0] ?? 10;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO");
};

export default function ProductEnrichmentPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialScope = searchParams.get("scope") === "all" ? "all" : "brand";
  const initialBrand = searchParams.get("brandId") ?? "";
  const initialBatch = normalizeBatchSize(
    parsePositiveInt(searchParams.get("batch"), BATCH_OPTIONS[0] ?? 10),
  );
  const initialInclude = false;
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>(initialBrand);
  const [scope, setScope] = useState<"brand" | "all">(initialScope);
  const [batchSize, setBatchSize] = useState<number>(initialBatch);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [counts, setCounts] = useState<CoverageCounts | null>(null);
  const [itemCounts, setItemCounts] = useState<ItemCounts | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [includeLowConfidenceReview, setIncludeLowConfidenceReview] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeEnriched, setIncludeEnriched] = useState(initialInclude);
  const suppressQueryRef = useRef(false);

  const fetchBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/products/brands", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudieron cargar marcas");
      const payload = await res.json();
      const nextBrands: BrandOption[] = payload.brands ?? [];
      setBrands(nextBrands);
      if (!nextBrands.length) return;
      const hasSelection = selectedBrand
        ? nextBrands.some((brand: BrandOption) => brand.id === selectedBrand)
        : false;
      if (!selectedBrand || !hasSelection) {
        setSelectedBrand(nextBrands[0].id);
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
      setRunMeta(payload.run ?? null);
      setCounts(payload.counts ?? null);
      setItemCounts(payload.itemCounts ?? null);
    } catch (err) {
      console.warn(err);
    }
  }, [scope, selectedBrand]);

  const fetchReviewItems = useCallback(async () => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("limit", "40");
      params.set("onlyReviewRequired", includeLowConfidenceReview ? "false" : "true");
      params.set("includeLowConfidence", includeLowConfidenceReview ? "true" : "false");
      if (scope === "brand" && selectedBrand) params.set("brandId", selectedBrand);
      const res = await fetch(`/api/admin/product-enrichment/review-items?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudieron cargar productos para revisión");
      }
      const payload = await res.json();
      setReviewItems(payload.items ?? []);
    } catch (err) {
      console.warn(err);
      setReviewItems([]);
      setReviewError(
        err instanceof Error ? err.message : "No se pudieron cargar productos para revisión",
      );
    } finally {
      setReviewLoading(false);
    }
  }, [scope, selectedBrand, includeLowConfidenceReview]);

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
    fetchReviewItems();
  }, [fetchReviewItems]);

  useEffect(() => {
    const queued = itemCounts?.queued ?? 0;
    const inProgress = itemCounts?.in_progress ?? 0;
    if (summary?.status !== "processing" && queued + inProgress === 0) return;
    const interval = setInterval(() => {
      fetchSummary();
      fetchReviewItems();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSummary, fetchReviewItems, summary?.status, itemCounts]);

  const progress = useMemo(() => buildProgress(summary), [summary]);
  const processedCount = progress.completed + progress.failed;
  const queuedCount = itemCounts?.queued ?? 0;
  const inProgressCount = itemCounts?.in_progress ?? 0;

  const shouldResume = useMemo(() => {
    if (!summary) return false;
    return summary.status === "paused" || summary.status === "stopped";
  }, [summary]);

  useEffect(() => {
    const nextScope = searchParams.get("scope") === "all" ? "all" : "brand";
    const nextBrand = searchParams.get("brandId") ?? "";
    const nextBatch = normalizeBatchSize(
      parsePositiveInt(searchParams.get("batch"), BATCH_OPTIONS[0] ?? 10),
    );
    const nextInclude = false;
    setScope((prev) => (prev === nextScope ? prev : nextScope));
    setSelectedBrand((prev) => (prev === nextBrand ? prev : nextBrand));
    setBatchSize((prev) => (prev === nextBatch ? prev : nextBatch));
    setIncludeEnriched((prev) => (prev === nextInclude ? prev : nextInclude));
  }, [searchParams]);

  const replaceUrl = useCallback(() => {
    if (suppressQueryRef.current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", scope);
    if (scope === "brand" && selectedBrand) params.set("brandId", selectedBrand);
    else params.delete("brandId");
    params.set("batch", String(batchSize));
    params.delete("includeEnriched");
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(`/admin/product-enrichment?${next}`, { scroll: false });
    }
  }, [batchSize, router, scope, searchParams, selectedBrand]);

  useEffect(() => {
    replaceUrl();
  }, [replaceUrl]);

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
        forceReenrich: false,
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

  const handleReset = async () => {
    if (loading) return;
    const message =
      scope === "brand"
        ? "Esto eliminará los batches activos de esta marca y limpiará la cola. ¿Continuar?"
        : "Esto eliminará los batches activos de todas las marcas y limpiará la cola. ¿Continuar?";
    if (!confirm(message)) return;
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { scope, mode: "delete" };
      if (scope === "brand") payload.brandId = selectedBrand;
      const res = await fetch("/api/admin/product-enrichment/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responsePayload = await res.json();
      if (!res.ok) {
        throw new Error(responsePayload.error || "No se pudo limpiar los batches");
      }
      await fetchSummary();
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
            temporada y colores (HEX + Pantone). Se puede correr por marca, por batch o global; el
            procesamiento continúa en background vía cron aunque no haya un navegador abierto.
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
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600"
          >
            Limpiar batches activos
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
              Calidad:{" "}
              <span className="font-semibold text-slate-900">
                {counts?.lowConfidence ?? 0}
              </span>{" "}
              baja confianza ·{" "}
              <span className="font-semibold text-slate-900">
                {counts?.reviewRequired ?? 0}
              </span>{" "}
              para revision manual
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
              Pendientes: <span className="font-semibold text-slate-900">{progress.pending}</span> ·
              Procesados: <span className="font-semibold text-slate-900">{processedCount}</span>
            </p>
            <p>
              En cola: <span className="font-semibold text-slate-900">{queuedCount}</span> ·
              En progreso: <span className="font-semibold text-slate-900">{inProgressCount}</span>
            </p>
            <p>
              Última actualización:{" "}
              <span className="font-semibold text-slate-900">{formatDateTime(runMeta?.updatedAt)}</span>
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
          disabled
          onChange={(event) => setIncludeEnriched(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <label htmlFor="includeEnriched">
          Re-enrichment IA de productos ya enriquecidos deshabilitado por politica
        </label>
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

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Revisión manual</p>
            <p className="mt-1 text-sm text-slate-600">
              Productos marcados para revisión y/o baja confianza. Úsalo para pasar al ajuste humano.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIncludeLowConfidenceReview(true)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                includeLowConfidenceReview
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Manual + baja confianza
            </button>
            <button
              type="button"
              onClick={() => setIncludeLowConfidenceReview(false)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                !includeLowConfidenceReview
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Solo manual
            </button>
            <button
              type="button"
              onClick={fetchReviewItems}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
              disabled={reviewLoading}
            >
              {reviewLoading ? "Actualizando..." : "Refrescar lista"}
            </button>
          </div>
        </div>

        {reviewError ? (
          <p className="mt-3 text-xs text-rose-600">{reviewError}</p>
        ) : null}

        {!reviewError && !reviewItems.length ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            No hay productos en revisión para este alcance con el filtro actual.
          </p>
        ) : null}

        {reviewItems.length ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-left">Calidad</th>
                    <th className="px-3 py-2 text-left">Razones</th>
                    <th className="px-3 py-2 text-left">Actualizado</th>
                    <th className="px-3 py-2 text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {reviewItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-3 align-top">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.brandName ?? "Sin marca"} · {item.category ?? "sin_categoria"} /{" "}
                          {item.subcategory ?? "sin_subcategoria"}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="text-xs text-slate-600">
                          {item.reviewRequired ? "Revisión manual: sí" : "Revisión manual: no"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Confidence overall:{" "}
                          <span className="font-semibold text-slate-900">
                            {typeof item.confidenceOverall === "number"
                              ? item.confidenceOverall.toFixed(2)
                              : "—"}
                          </span>
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {item.reviewReasons.length ? (
                          <p className="max-w-[420px] text-xs text-slate-700">
                            {item.reviewReasons.join(" · ")}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500">Sin razones explícitas.</p>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">
                        {formatDateTime(item.updatedAt)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`/admin/products?productId=${item.id}`}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            Abrir producto
                          </a>
                          {item.sourceUrl ? (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                            >
                              Fuente original
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
