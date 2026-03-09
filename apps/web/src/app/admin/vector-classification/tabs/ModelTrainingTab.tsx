"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types (matching actual API responses) ── */

type EmbeddingStats = {
  total: number;
  embedded: number;
  missing: number;
  stale: number;
  jobStatus: "idle" | "running" | "stopping" | "error";
  jobError: string | null;
};

type SubcategoryReadiness = {
  subcategory: string;
  category: string;
  totalProducts: number;
  confirmedCount: number;
  isReady: boolean;
};

type ModelInfo = {
  lastRun: {
    id: string;
    modelType: string;
    status: string;
    totalSamples: number | null;
    totalCentroids: number | null;
    metrics: Record<string, unknown> | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
  centroidCount: number;
  totalSamples: number;
};

type RunRecord = {
  id: string;
  modelType: string;
  status: string;
  totalSamples: number | null;
  totalCentroids: number | null;
  metrics: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

/* ── Helpers ── */

const fmt = (n: number) => n.toLocaleString("es-CO");
const fmtFloat = (n: number | null | undefined, digits = 4) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
};
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "--";
  return new Date(d).toLocaleString("es-CO");
};

const CheckIcon = () => (
  <svg className="mx-auto h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const XIcon = () => (
  <svg className="mx-auto h-4 w-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const Spinner = () => (
  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/* ── Component ── */

export default function ModelTrainingTab() {
  const [embStats, setEmbStats] = useState<EmbeddingStats | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [subcatReadiness, setSubcatReadiness] = useState<SubcategoryReadiness[]>([]);
  const [subcatModel, setSubcatModel] = useState<ModelInfo | null>(null);
  const [genderModel, setGenderModel] = useState<ModelInfo | null>(null);

  const [trainingSubcat, setTrainingSubcat] = useState(false);
  const [trainingGender, setTrainingGender] = useState(false);
  const [reclassifyingSubcat, setReclassifyingSubcat] = useState(false);
  const [reclassifyingGender, setReclassifyingGender] = useState(false);

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);

  /* ── Fetch embedding stats (includes jobStatus from Redis) ── */
  const fetchEmbeddingStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/embeddings", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as EmbeddingStats;
      setEmbStats(data);

      // Stop polling when job is no longer running
      if (data.jobStatus !== "running" && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch ground truth stats / readiness ── */
  const fetchReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/ground-truth/stats", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.stats)) {
        setSubcatReadiness(data.stats);
      }
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch model status ── */
  const fetchModelStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/model/status", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.subcategoryModel) setSubcatModel(data.subcategoryModel);
      if (data.genderModel) setGenderModel(data.genderModel);
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch recent runs ── */
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/model/runs", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.runs)) setRuns(data.runs);
    } catch {
      // silent
    }
  }, []);

  /* ── Initial load ── */
  useEffect(() => {
    Promise.all([
      fetchEmbeddingStats(),
      fetchReadiness(),
      fetchModelStatus(),
      fetchRuns(),
    ]).finally(() => setLoadingInit(false));
  }, [fetchEmbeddingStats, fetchReadiness, fetchModelStatus, fetchRuns]);

  /* ── Clean up polling on unmount ── */
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ── Start polling if job already running on mount ── */
  useEffect(() => {
    if (embStats?.jobStatus === "running" && !pollRef.current) {
      pollRef.current = setInterval(fetchEmbeddingStats, 20_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embStats?.jobStatus]);

  /* ── Start embedding job (backend self-chains) ── */
  const handleGenerateEmbeddings = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/vector-classification/embeddings/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 10 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Error al generar embeddings");
      }
      // Refresh stats immediately, then start polling every 20s
      await fetchEmbeddingStats();
      if (!pollRef.current) {
        pollRef.current = setInterval(fetchEmbeddingStats, 20_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar embeddings");
    }
  }, [fetchEmbeddingStats]);

  /* ── Stop embedding job (server-side) ── */
  const handleStopEmbeddings = useCallback(async () => {
    try {
      await fetch("/api/admin/vector-classification/embeddings/generate/stop", {
        method: "POST",
        credentials: "include",
      });
      // Refresh stats to show stopped state
      await fetchEmbeddingStats();
    } catch {
      // silent
    }
  }, [fetchEmbeddingStats]);

  /* ── Train model ── */
  const handleTrain = useCallback(
    async (modelType: "subcategory" | "gender") => {
      const setTraining = modelType === "subcategory" ? setTrainingSubcat : setTrainingGender;
      setTraining(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/vector-classification/model/train", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelType }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "Error al entrenar modelo");
        }
        await fetchModelStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al entrenar modelo");
      } finally {
        setTraining(false);
      }
    },
    [fetchModelStatus],
  );

  /* ── Run reclassification ── */
  const handleReclassify = useCallback(
    async (modelType: "subcategory" | "gender") => {
      const setRunning = modelType === "subcategory" ? setReclassifyingSubcat : setReclassifyingGender;
      setRunning(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/vector-classification/reclassification/run", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelType }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "Error al ejecutar reclasificacion");
        }
        await fetchRuns();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al ejecutar reclasificacion");
      } finally {
        setRunning(false);
      }
    },
    [fetchRuns],
  );

  /* ── Derived ── */
  const readyCount = subcatReadiness.filter((s) => s.isReady).length;
  const embPct = embStats && embStats.total > 0 ? Math.round((embStats.embedded / embStats.total) * 100) : 0;
  const embJobRunning = embStats?.jobStatus === "running";
  const subcatTrained = (subcatModel?.centroidCount ?? 0) > 0;
  const genderTrained = (genderModel?.centroidCount ?? 0) > 0;

  if (loadingInit) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Cargando datos del modelo...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {/* ── Section A: Embeddings ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-base font-semibold text-slate-900">Embeddings</h3>
        <p className="mt-1 text-sm text-slate-500">
          Vectores de representacion para los productos del catalogo.
        </p>

        {embStats && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-slate-700">
                Embeddings: {fmt(embStats.embedded)} / {fmt(embStats.total)} productos
              </span>
              <span className="text-sm text-slate-500">({embPct}%)</span>
              {embStats.stale > 0 && (
                <span className="text-sm text-amber-600">
                  {fmt(embStats.stale)} desactualizados
                </span>
              )}
            </div>

            <div className="h-2.5 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${embPct}%` }}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleGenerateEmbeddings}
                disabled={embJobRunning}
              >
                {embJobRunning ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Generando... ({fmt(embStats?.missing ?? 0)} restantes)
                  </span>
                ) : embStats && embStats.missing > 0 ? (
                  `Generar embeddings (${fmt(embStats.missing)} pendientes)`
                ) : (
                  "Generar embeddings"
                )}
              </button>
              {embJobRunning && (
                <button
                  type="button"
                  className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                  onClick={handleStopEmbeddings}
                >
                  Detener
                </button>
              )}
            </div>
            {embStats?.jobStatus === "error" && embStats.jobError && (
              <p className="mt-2 text-xs text-rose-600">
                Error del job: {embStats.jobError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Section B: Subcategory Model ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-base font-semibold text-slate-900">
          Modelo Categoria / Subcategoria
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          {readyCount} de {subcatReadiness.length} subcategorias listas para entrenamiento.
        </p>

        <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Subcategoria</th>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Confirmados</th>
                <th className="px-3 py-2 text-center">Listo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subcatReadiness.map((row) => (
                <tr key={row.subcategory} className={row.isReady ? "bg-emerald-50/60" : ""}>
                  <td className="px-3 py-1.5 font-medium text-slate-800">{row.subcategory}</td>
                  <td className="px-3 py-1.5 text-slate-600">{row.category}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{row.totalProducts}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{row.confirmedCount}</td>
                  <td className="px-3 py-1.5 text-center">{row.isReady ? <CheckIcon /> : <XIcon />}</td>
                </tr>
              ))}
              {subcatReadiness.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-400">
                    Sin datos de subcategorias.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {subcatTrained && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Centroides entrenados
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {subcatModel?.centroidCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Muestras usadas
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt(subcatModel?.totalSamples ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Estado ultimo run
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {subcatModel?.lastRun?.status ?? "--"}
              </p>
            </div>
          </div>
        )}

        {subcatModel?.lastRun?.completedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Ultimo entrenamiento: {fmtDate(subcatModel.lastRun.completedAt)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => handleTrain("subcategory")}
            disabled={trainingSubcat}
          >
            {trainingSubcat ? "Entrenando..." : "Entrenar modelo"}
          </button>
          {subcatTrained && (
            <button
              type="button"
              className="rounded-xl border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handleReclassify("subcategory")}
              disabled={reclassifyingSubcat}
            >
              {reclassifyingSubcat ? "Ejecutando reclasificacion..." : "Correr reclasificacion"}
            </button>
          )}
        </div>
      </div>

      {/* ── Section C: Gender Model ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-base font-semibold text-slate-900">Modelo Genero</h3>
        <p className="mt-1 text-sm text-slate-500">
          Entrenamiento y clasificacion por genero (masculino, femenino, no_binario_unisex, infantil).
        </p>

        {genderTrained && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Centroides entrenados
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {genderModel?.centroidCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Muestras usadas
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt(genderModel?.totalSamples ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Estado ultimo run
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {genderModel?.lastRun?.status ?? "--"}
              </p>
            </div>
          </div>
        )}

        {genderModel?.lastRun?.completedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Ultimo entrenamiento: {fmtDate(genderModel.lastRun.completedAt)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => handleTrain("gender")}
            disabled={trainingGender}
          >
            {trainingGender ? "Entrenando..." : "Entrenar modelo"}
          </button>
          {genderTrained && (
            <button
              type="button"
              className="rounded-xl border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handleReclassify("gender")}
              disabled={reclassifyingGender}
            >
              {reclassifyingGender ? "Ejecutando reclasificacion..." : "Correr reclasificacion"}
            </button>
          )}
        </div>
      </div>

      {/* ── Recent runs ── */}
      {runs.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <h3 className="text-base font-semibold text-slate-900">Ejecuciones recientes</h3>
          <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-right">Muestras</th>
                  <th className="px-3 py-2 text-right">Centroides</th>
                  <th className="px-3 py-2 text-left">Inicio</th>
                  <th className="px-3 py-2 text-left">Fin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">
                      {run.modelType === "subcategory" ? "Subcategoria" : "Genero"}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          run.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : run.status === "running"
                              ? "bg-amber-100 text-amber-700"
                              : run.status === "failed"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600">
                      {run.totalSamples != null ? fmt(run.totalSamples) : "--"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600">
                      {run.totalCentroids != null ? fmt(run.totalCentroids) : "--"}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(run.startedAt)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(run.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
