"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type QueueCounts = Record<string, number>;

type QueueJob = {
  id: string;
  status: string;
  batchId?: string | null;
  createdAt: string;
  brand?: { id: string; name: string; slug: string } | null;
  result?: {
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
  } | null;
  finishedAt?: string | null;
};

type QueueStatus = {
  counts: QueueCounts;
  queued: QueueJob[];
  processing: QueueJob | null;
  recent: QueueJob[];
  recoveredStale?: number;
  batchId?: string | null;
  batchCounts?: Record<string, number> | null;
};

const COUNTS = [1, 5, 10, 25, 50];
const STORAGE_KEY = "oda_brand_scrape_state";

const readStoredState = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { autoRun?: boolean; batchId?: string | null };
    return parsed;
  } catch {
    return null;
  }
};

const persistState = (state: { autoRun: boolean; batchId?: string | null }) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const clearStoredState = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function BrandScrapePanel() {
  const [count, setCount] = useState(5);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const resumeRef = useRef(false);

  const queuedTotal = useMemo(() => {
    if (!status?.counts) return 0;
    return Object.values(status.counts).reduce((sum, value) => sum + value, 0);
  }, [status]);

  const appendLog = useCallback((entry: string) => {
    setLog((prev) => {
      const next = [entry, ...prev];
      return next.slice(0, 25);
    });
  }, []);

  const fetchStatus = useCallback(
    async (targetBatchId?: string | null) => {
      try {
        const params = new URLSearchParams();
        const activeBatch = targetBatchId === undefined ? batchId : targetBatchId;
        if (activeBatch) params.set("batchId", activeBatch);
        const res = await fetch(`/api/admin/brands/scrape?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudo cargar el estado de la cola");
        const payload = (await res.json()) as QueueStatus;
        setStatus(payload);
        if ((payload.recoveredStale ?? 0) > 0) {
          appendLog(`Se re-encolaron ${payload.recoveredStale} jobs atascados.`);
        }
        return payload;
      } catch (err) {
        console.warn(err);
        return null;
      }
    },
    [appendLog, batchId],
  );

  useEffect(() => {
    const stored = readStoredState();
    const storedBatchId = stored?.batchId ?? null;
    if (storedBatchId) setBatchId(storedBatchId);
    if (stored?.autoRun) setAutoRun(true);
    if (stored?.autoRun) {
      resumeRef.current = true;
    }
    fetchStatus(storedBatchId);
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const enqueue = async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/brands/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "No se pudo encolar");
      }
      const payload = await res.json();
      appendLog(`Cola creada: ${payload.enqueued} marcas (batch ${payload.batchId})`);
      await fetchStatus(payload.batchId ?? null);
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      return null;
    }
  };

  const processNext = useCallback(async (targetBatchId?: string | null) => {
    const res = await fetch("/api/admin/brands/scrape/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: targetBatchId ?? null }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error ?? "Fallo procesando job");
    }
    return res.json();
  }, []);

  const stopAutoRun = useCallback(() => {
    setAutoRun(false);
    setBatchId(null);
    clearStoredState();
  }, []);

  const runBatch = useCallback(
    async (targetBatchId?: string | null) => {
      let processed = 0;
      let consecutiveFailures = 0;
      while (true) {
        const payload = await fetchStatus(targetBatchId ?? null);
        if (payload?.processing) {
          await sleep(1500);
          continue;
        }

        const batchCounts = payload?.batchCounts ?? null;
        const queuedCount = batchCounts?.queued ?? (payload?.counts?.queued ?? 0);
        if (!queuedCount) {
          appendLog("Cola vacía. Listo.");
          break;
        }

        const result = await processNext(targetBatchId ?? null);
        if (result.status === "empty") {
          appendLog("Cola vacía. Listo.");
          break;
        }
        if (result.status === "completed") {
          const changeCount = Array.isArray(result.changes) ? result.changes.length : 0;
          appendLog(`✅ ${result.brandName ?? "Marca"} actualizada (${changeCount} cambios)`);
        }
        if (result.status === "failed") {
          appendLog(`⚠️ Error en job: ${result.error ?? "sin detalle"}`);
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) {
            appendLog("Se detuvo por multiples errores consecutivos.");
            break;
          }
        } else {
          consecutiveFailures = 0;
        }
        processed += 1;
      }

      return processed;
    },
    [appendLog, fetchStatus, processNext],
  );

  const runQueue = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const initialStatus = await fetchStatus(null);
      const existingQueued = initialStatus?.counts?.queued ?? 0;
      if (existingQueued > 0) {
        appendLog(`Hay ${existingQueued} jobs en cola. Procesando cola existente...`);
        const processedExisting = await runBatch(null);
        appendLog(`Cola existente completada (${processedExisting}).`);
      }

      const enqueueResult = await enqueue();
      if (!enqueueResult || enqueueResult.enqueued === 0) {
        const afterStatus = await fetchStatus(null);
        const remainingQueued = afterStatus?.counts?.queued ?? 0;
        if (remainingQueued > 0) {
          appendLog(`Aún quedan ${remainingQueued} jobs en cola. Procesándolos...`);
          const processedRemaining = await runBatch(null);
          appendLog(`Cola completada (${processedRemaining}).`);
        }
        setRunning(false);
        return;
      }

      const newBatchId = enqueueResult.batchId ?? null;
      setBatchId(newBatchId);
      setAutoRun(true);
      persistState({ autoRun: true, batchId: newBatchId });

      const processed = await runBatch(newBatchId);
      appendLog(`Batch completado (${processed}/${enqueueResult.enqueued}).`);
      stopAutoRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  };

  const runNextOnly = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await processNext(batchId);
      if (result.status === "empty") {
        appendLog("Cola vacía. Nada para procesar.");
      } else if (result.status === "completed") {
        const changeCount = Array.isArray(result.changes) ? result.changes.length : 0;
        appendLog(`✅ ${result.brandName ?? "Marca"} actualizada (${changeCount} cambios)`);
      }
      await fetchStatus(batchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  };

  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  useEffect(() => {
    if (!resumeRef.current || running) return;
    if (!autoRun) return;
    resumeRef.current = false;

    const resume = async () => {
      setRunning(true);
      try {
        const payload = await fetchStatus(batchId);
        const queuedCount = payload?.batchCounts?.queued ?? 0;
        if (!queuedCount) {
          stopAutoRun();
          return;
        }
        appendLog("Reanudando procesamiento pendiente...");
        await runBatch(batchId);
        stopAutoRun();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado");
      } finally {
        setRunning(false);
      }
    };

    resume();
  }, [autoRun, batchId, fetchStatus, running, appendLog, runBatch, stopAutoRun]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Ejecución de scraping</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Ejecuta enriquecimiento con OpenAI (búsqueda web) y actualiza la tabla de brands.
          </p>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Lanzar scraping</h2>
            <p className="mt-2 text-sm text-slate-600">
              Selecciona cuántas marcas quieres actualizar. Si son muchas, se crean jobs en cola.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {COUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCount(value)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                    count === value
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={runQueue}
                disabled={running}
                className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {running ? "Procesando..." : "Encolar y ejecutar"}
              </button>
              {autoRun && (
                <button
                  type="button"
                  onClick={stopAutoRun}
                  className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600"
                >
                  Pausar auto-ejecución
                </button>
              )}
              <button
                type="button"
                onClick={runNextOnly}
                disabled={running}
                className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 disabled:opacity-60"
              >
                Procesar siguiente
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-200">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Actividad</p>
              <div className="mt-2 space-y-1">
                {log.length === 0 ? (
                  <p className="text-slate-400">Sin actividad todavía.</p>
                ) : (
                  log.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)
                )}
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">Estado de la cola</h2>
            <div className="mt-4 grid gap-3 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Total jobs</span>
                <span className="font-semibold text-slate-900">{queuedTotal}</span>
              </div>
              {status?.counts &&
                Object.entries(status.counts).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="capitalize">{key}</span>
                    <span className="font-semibold text-slate-900">{value}</span>
                  </div>
                ))}
            </div>

            {batchId && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Batch activo</p>
                <p className="mt-2 text-xs font-semibold">{batchId}</p>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p>En cola: {status?.batchCounts?.queued ?? 0}</p>
                  <p>Procesando: {status?.batchCounts?.processing ?? 0}</p>
                  <p>Completados: {status?.batchCounts?.completed ?? 0}</p>
                  <p>Fallidos: {status?.batchCounts?.failed ?? 0}</p>
                </div>
              </div>
            )}

            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Procesando</h3>
              <p className="mt-2 text-sm text-slate-700">
                {status?.processing?.brand?.name ?? "Sin jobs activos"}
              </p>
            </div>

            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Siguientes</h3>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {status?.queued?.length ? (
                  status.queued.map((job) => (
                    <li key={job.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      {job.brand?.name ?? "Marca"}
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">No hay jobs en cola.</li>
                )}
              </ul>
            </div>

            <div className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Últimas ejecuciones
              </h3>
              <div className="mt-3 space-y-3 text-sm text-slate-700">
                {status?.recent?.length ? (
                  status.recent.map((job) => {
                    const changeCount = job.result?.changes?.length ?? 0;
                    return (
                      <details key={job.id} className="rounded-xl border border-slate-200 px-3 py-2">
                        <summary className="cursor-pointer list-none font-medium text-slate-800">
                          {job.brand?.name ?? "Marca"} · {job.status} · {changeCount} cambios
                        </summary>
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          {(job.result?.changes ?? []).length === 0 ? (
                            <p>Sin cambios detectados.</p>
                          ) : (
                            job.result?.changes?.map((change, idx) => (
                              <p key={`${job.id}-change-${idx}`}>
                                {change.field}: {formatValue(change.before)} → {formatValue(change.after)}
                              </p>
                            ))
                          )}
                        </div>
                      </details>
                    );
                  })
                ) : (
                  <p className="text-slate-500">Aún no hay ejecuciones.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
