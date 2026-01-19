"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type QueueCounts = Record<string, number>;

type QueueJob = {
  id: string;
  status: string;
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
};

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  siteUrl: string | null;
  instagram: string | null;
  isActive: boolean;
  lastStatus: string | null;
  lastCreatedAt: string | null;
  lastFinishedAt: string | null;
  lastResult: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
  } | null;
  hasCompleted: boolean | null;
};

type BrandSummary = {
  total: number;
  unprocessed: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
};

type BrandListResponse = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  summary: BrandSummary;
  brands: BrandRow[];
};

const COUNTS = [1, 5, 10, 25, 50];

export default function BrandScrapePanel() {
  const [count, setCount] = useState(5);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [brandData, setBrandData] = useState<BrandListResponse | null>(null);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [onlyUnprocessed, setOnlyUnprocessed] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brands/scrape", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el estado de la cola");
      const payload = (await res.json()) as QueueStatus;
      setStatus(payload);
    } catch (err) {
      console.warn(err);
    }
  }, []);

  const fetchBrands = useCallback(async () => {
    setBrandsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        filter: onlyUnprocessed ? "unprocessed" : "all",
      });
      const res = await fetch(`/api/admin/brands?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar la tabla de marcas");
      const payload = (await res.json()) as BrandListResponse;
      setBrandData(payload);
    } catch (err) {
      console.warn(err);
    } finally {
      setBrandsLoading(false);
    }
  }, [page, pageSize, onlyUnprocessed]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

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
      await fetchStatus();
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      return null;
    }
  };

  const processNext = async () => {
    const res = await fetch("/api/admin/brands/scrape/next", { method: "POST" });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error ?? "Fallo procesando job");
    }
    return res.json();
  };

  const runQueue = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const enqueueResult = await enqueue();
      if (!enqueueResult || enqueueResult.enqueued === 0) {
        setRunning(false);
        return;
      }

      while (true) {
        const result = await processNext();
        if (result.status === "empty") {
          appendLog("Cola vacía. Listo.");
          break;
        }
        if (result.status === "completed") {
          const changeCount = Array.isArray(result.changes) ? result.changes.length : 0;
          appendLog(`✅ ${result.brandName ?? "Marca"} actualizada (${changeCount} cambios)`);
        }
        await fetchStatus();
        await fetchBrands();
      }
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
      const result = await processNext();
      if (result.status === "empty") {
        appendLog("Cola vacía. Nada para procesar.");
      } else if (result.status === "completed") {
        const changeCount = Array.isArray(result.changes) ? result.changes.length : 0;
        appendLog(`✅ ${result.brandName ?? "Marca"} actualizada (${changeCount} cambios)`);
      }
      await fetchStatus();
      await fetchBrands();
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
                      <details
                        key={job.id}
                        className="rounded-xl border border-slate-200 px-3 py-2"
                      >
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

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Marcas</h2>
            <p className="mt-2 text-sm text-slate-600">
              {brandData?.summary?.unprocessed ?? 0} marcas pendientes por procesar.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyUnprocessed}
                onChange={(event) => {
                  setPage(1);
                  setOnlyUnprocessed(event.target.checked);
                }}
              />
              Ver solo pendientes
            </label>
            <select
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
            >
              {[10, 25, 50].map((value) => (
                <option key={value} value={value}>
                  {value} por página
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{brandData?.summary?.total ?? 0}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pendientes</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {brandData?.summary?.unprocessed ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Procesadas</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {brandData?.summary?.completed ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-6 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-[0.15em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Marca</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Ciudad</th>
                <th className="px-4 py-3">Sitio</th>
                <th className="px-4 py-3">Última ejecución</th>
                <th className="px-4 py-3">Cambios</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {brandsLoading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={6}>
                    Cargando marcas...
                  </td>
                </tr>
              ) : brandData?.brands?.length ? (
                brandData.brands.map((brand) => {
                  const statusLabel = brand.lastStatus ?? (brand.hasCompleted ? "completed" : "pending");
                  const changes = brand.lastResult?.changes ?? [];
                  const lastFinished = brand.lastFinishedAt
                    ? new Date(brand.lastFinishedAt).toLocaleString("es-CO")
                    : "Sin ejecución";
                  return (
                    <tr key={brand.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{brand.name}</div>
                        <div className="text-xs text-slate-500">{brand.slug}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            statusLabel === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : statusLabel === "failed"
                                ? "bg-rose-100 text-rose-700"
                                : statusLabel === "processing"
                                  ? "bg-amber-100 text-amber-700"
                                  : statusLabel === "queued"
                                    ? "bg-indigo-100 text-indigo-700"
                                    : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3">{brand.city ?? "—"}</td>
                      <td className="px-4 py-3">
                        {brand.siteUrl ? (
                          <a href={brand.siteUrl} className="text-indigo-600 hover:underline" target="_blank">
                            {brand.siteUrl}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">{lastFinished}</td>
                      <td className="px-4 py-3">
                        {changes.length === 0 ? (
                          <span className="text-slate-500">Sin cambios</span>
                        ) : (
                          <details className="rounded-lg border border-slate-200 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                              Ver diff ({changes.length})
                            </summary>
                            <div className="mt-3 grid gap-4 text-xs text-slate-600 md:grid-cols-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Antes</p>
                                <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2">
                                  {formatValue(brand.lastResult?.before ?? {})}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Después</p>
                                <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2">
                                  {formatValue(brand.lastResult?.after ?? {})}
                                </pre>
                              </div>
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={6}>
                    No hay marcas para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            Página {brandData?.page ?? page} de {brandData?.totalPages ?? 1} ·{" "}
            {brandData?.totalCount ?? 0} marcas
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((prev) => Math.min(brandData?.totalPages ?? prev + 1, prev + 1))
              }
              disabled={brandData?.totalPages ? page >= brandData.totalPages : false}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
