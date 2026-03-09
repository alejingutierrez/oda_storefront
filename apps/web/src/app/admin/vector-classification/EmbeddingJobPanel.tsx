"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ── */

type JobLogEntry = { t: number; m: string };

type EmbeddingJobStats = {
  total: number;
  embedded: number;
  missing: number;
  stale: number;
  jobStatus: "idle" | "running" | "stopping" | "paused" | "error";
  jobError: string | null;
  lastBatchAt: string | null;
  isStale: boolean;
  startedAt: string | null;
  speed: number | null;
  chainCount: number | null;
  totalProcessed: number | null;
  log: JobLogEntry[];
  config: { skipImages: boolean };
};

/* ── Helpers ── */

const fmt = (n: number) => n.toLocaleString("es-CO");

function formatEta(missing: number, speed: number | null): string {
  if (!speed || speed <= 0 || missing <= 0) return "--";
  const minutes = missing / speed;
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `~${hours}h ${mins}m`;
}

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/* ── Component ── */

export default function EmbeddingJobPanel() {
  const [stats, setStats] = useState<EmbeddingJobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Fetch stats ── */
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/embeddings", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as EmbeddingJobStats;
      setStats(data);

      // Stop polling when job is no longer running
      if (data.jobStatus !== "running" && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      // silent
    }
  }, []);

  /* ── Initial load ── */
  useEffect(() => {
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  /* ── Clean up polling on unmount ── */
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ── Start polling if job running on mount ── */
  useEffect(() => {
    if (stats?.jobStatus === "running" && !pollRef.current) {
      pollRef.current = setInterval(fetchStats, 15_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.jobStatus]);

  /* ── Ensure polling when running ── */
  const ensurePolling = useCallback(() => {
    if (!pollRef.current) {
      pollRef.current = setInterval(fetchStats, 15_000);
    }
  }, [fetchStats]);

  /* ── Actions ── */
  const handleStart = useCallback(async () => {
    setError(null);
    setActionLoading("start");
    try {
      const res = await fetch("/api/admin/vector-classification/embeddings/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Error al iniciar");
      await fetchStats();
      ensurePolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar");
    } finally {
      setActionLoading(null);
    }
  }, [fetchStats, ensurePolling]);

  const handlePause = useCallback(async () => {
    setActionLoading("pause");
    try {
      await fetch("/api/admin/vector-classification/embeddings/generate/pause", {
        method: "POST",
        credentials: "include",
      });
      await fetchStats();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }, [fetchStats]);

  const handleResume = useCallback(async () => {
    setActionLoading("resume");
    try {
      await fetch("/api/admin/vector-classification/embeddings/generate/resume", {
        method: "POST",
        credentials: "include",
      });
      await fetchStats();
      ensurePolling();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }, [fetchStats, ensurePolling]);

  const handleStop = useCallback(async () => {
    setActionLoading("stop");
    try {
      await fetch("/api/admin/vector-classification/embeddings/generate/stop", {
        method: "POST",
        credentials: "include",
      });
      await fetchStats();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }, [fetchStats]);

  const handleClear = useCallback(async () => {
    setActionLoading("clear");
    setConfirmClear(false);
    try {
      const res = await fetch("/api/admin/vector-classification/embeddings/generate/clear", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Error al limpiar");
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al limpiar");
    } finally {
      setActionLoading(null);
    }
  }, [fetchStats]);

  const handleToggleSkipImages = useCallback(async (checked: boolean) => {
    try {
      await fetch("/api/admin/vector-classification/embeddings/generate/config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipImages: checked }),
      });
      await fetchStats();
    } catch {
      // silent
    }
  }, [fetchStats]);

  const handleResetStale = useCallback(async () => {
    setActionLoading("reset");
    try {
      await fetch("/api/admin/vector-classification/embeddings/generate/stop", {
        method: "POST",
        credentials: "include",
      });
      // Give it a moment then refresh
      await new Promise((r) => setTimeout(r, 500));
      await fetchStats();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }, [fetchStats]);

  /* ── Derived state ── */
  const jobStatus = stats?.jobStatus ?? "idle";
  const isRunning = jobStatus === "running";
  const isPaused = jobStatus === "paused";
  const isIdle = jobStatus === "idle";
  const isError = jobStatus === "error";
  const embPct =
    stats && stats.total > 0
      ? Math.round((stats.embedded / stats.total) * 100)
      : 0;

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Cargando datos de embeddings...</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
      <h3 className="text-base font-semibold text-slate-900">Embeddings</h3>
      <p className="mt-1 text-sm text-slate-500">
        Vectores de representacion para los productos del catalogo.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {/* ── Stale warning ── */}
      {stats?.isStale && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <span className="text-sm text-amber-700">
            ⚠ Job posiblemente estancado (sin actividad hace &gt;90s)
          </span>
          <button
            type="button"
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            onClick={handleResetStale}
            disabled={actionLoading === "reset"}
          >
            {actionLoading === "reset" ? "Reseteando..." : "Resetear"}
          </button>
        </div>
      )}

      {stats && (
        <div className="mt-4 space-y-4">
          {/* ── Stats grid ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Generados
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt(stats.embedded)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Pendientes
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt(stats.missing)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Velocidad
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {stats.speed != null && stats.speed > 0
                  ? `${fmt(stats.speed)}/min`
                  : "--"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                ETA
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {isRunning ? formatEta(stats.missing, stats.speed) : "--"}
              </p>
            </div>
          </div>

          {/* ── Progress bar ── */}
          <div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all ${
                    isRunning
                      ? "bg-indigo-500"
                      : isPaused
                        ? "bg-amber-400"
                        : isError
                          ? "bg-rose-400"
                          : "bg-emerald-500"
                  }`}
                  style={{ width: `${embPct}%` }}
                />
              </div>
              <span className="min-w-[3rem] text-right text-sm font-medium text-slate-600">
                {embPct}%
              </span>
            </div>
            {stats.stale > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                {fmt(stats.stale)} desactualizados
              </p>
            )}
            {/* Status badge */}
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isRunning
                    ? "bg-indigo-100 text-indigo-700"
                    : isPaused
                      ? "bg-amber-100 text-amber-700"
                      : isError
                        ? "bg-rose-100 text-rose-700"
                        : "bg-slate-100 text-slate-600"
                }`}
              >
                {jobStatus === "running" && <Spinner className="mr-1 inline h-3 w-3" />}
                {jobStatus === "running"
                  ? "Generando"
                  : jobStatus === "paused"
                    ? "Pausado"
                    : jobStatus === "error"
                      ? "Error"
                      : jobStatus === "stopping"
                        ? "Deteniendo..."
                        : "Inactivo"}
              </span>
              {stats.chainCount != null && stats.chainCount > 0 && isRunning && (
                <span className="text-[10px] text-slate-400">
                  Chain #{stats.chainCount}
                </span>
              )}
              {stats.totalProcessed != null && stats.totalProcessed > 0 && isRunning && (
                <span className="text-[10px] text-slate-400">
                  {fmt(stats.totalProcessed)} en esta sesion
                </span>
              )}
            </div>
          </div>

          {/* ── Control buttons ── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Start / Resume */}
            {(isIdle || isError) && (
              <button
                type="button"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleStart}
                disabled={actionLoading !== null}
              >
                {actionLoading === "start" ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Iniciando...
                  </span>
                ) : (
                  `▶ Iniciar${stats.missing > 0 ? ` (${fmt(stats.missing)})` : ""}`
                )}
              </button>
            )}
            {isPaused && (
              <button
                type="button"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleResume}
                disabled={actionLoading !== null}
              >
                {actionLoading === "resume" ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Reanudando...
                  </span>
                ) : (
                  "▶ Reanudar"
                )}
              </button>
            )}

            {/* Pause */}
            {isRunning && (
              <button
                type="button"
                className="rounded-xl border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handlePause}
                disabled={actionLoading !== null}
              >
                {actionLoading === "pause" ? "Pausando..." : "⏸ Pausar"}
              </button>
            )}

            {/* Stop */}
            {(isRunning || isPaused) && (
              <button
                type="button"
                className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleStop}
                disabled={actionLoading !== null}
              >
                {actionLoading === "stop" ? "Deteniendo..." : "⏹ Detener"}
              </button>
            )}

            {/* Clear */}
            {(isIdle || isError) && stats.embedded > 0 && (
              <>
                {confirmClear ? (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5">
                    <span className="text-xs text-rose-600">
                      Eliminar {fmt(stats.embedded)} embeddings?
                    </span>
                    <button
                      type="button"
                      className="rounded-lg bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-500"
                      onClick={handleClear}
                      disabled={actionLoading !== null}
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-700"
                      onClick={() => setConfirmClear(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setConfirmClear(true)}
                    disabled={actionLoading !== null}
                  >
                    🗑 Limpiar
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── skipImages toggle ── */}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={stats.config.skipImages}
              onChange={(e) => handleToggleSkipImages(e.target.checked)}
              disabled={isRunning || isPaused}
            />
            Solo texto (sin imagenes)
            <span className="text-xs text-slate-400">
              — mas rapido, sin embedding de imagen
            </span>
          </label>

          {/* ── Error display ── */}
          {isError && stats.jobError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-600">
              Error del job: {stats.jobError}
            </p>
          )}

          {/* ── Activity log ── */}
          {stats.log.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Actividad reciente
              </h4>
              <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-slate-50">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {stats.log.map((entry, i) => (
                      <tr key={`${entry.t}-${i}`}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-400">
                          {formatLogTime(entry.t)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-700">{entry.m}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
