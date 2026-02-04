"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TechStatus = {
  total: number;
  withPlatform: number;
  pending: number;
};

type TechRunResult =
  | {
      status: "completed";
      brandId: string;
      brandName: string;
      platform: string;
      confidence: number;
    }
  | { status: "empty" }
  | { status: "failed"; brandId?: string; brandName?: string; error?: string };

const COUNTS = [5, 10, 25, 50, 100];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function BrandTechPanel() {
  const [count, setCount] = useState(10);
  const [status, setStatus] = useState<TechStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState(0);
  const [success, setSuccess] = useState(0);
  const [failed, setFailed] = useState(0);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brands/tech", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el estado");
      const payload = (await res.json()) as TechStatus;
      setStatus(payload);
      return payload;
    } catch (err) {
      console.warn(err);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const appendLog = useCallback((entry: string) => {
    setLog((prev) => {
      const next = [entry, ...prev];
      return next.slice(0, 40);
    });
  }, []);

  const progress = useMemo(() => {
    if (!count) return 0;
    return Math.min(100, Math.round((processed / count) * 100));
  }, [count, processed]);

  const runBatch = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setProcessed(0);
    setSuccess(0);
    setFailed(0);

    try {
      for (let index = 0; index < count; index += 1) {
        const res = await fetch("/api/admin/brands/tech/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });

        const payload = (await res.json()) as TechRunResult;
        if (payload.status === "failed") {
          appendLog(`⚠️ ${payload.brandName ?? "Marca"}: ${payload.error ?? "error"}`);
          setFailed((prev) => prev + 1);
          setProcessed((prev) => prev + 1);
          continue;
        }

        if (!res.ok) {
          appendLog("⚠️ Error inesperado al procesar marca.");
          setFailed((prev) => prev + 1);
          setProcessed((prev) => prev + 1);
          continue;
        }

        if (payload.status === "empty") {
          appendLog("Cola vacia: no hay mas marcas pendientes.");
          break;
        }

        appendLog(`✅ ${payload.brandName} -> ${payload.platform} (${Math.round(payload.confidence * 100)}%)`);
        setSuccess((prev) => prev + 1);
        setProcessed((prev) => prev + 1);
        await sleep(500);
      }
      await fetchStatus();
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
          <h2 className="text-lg font-semibold text-slate-900">Tech profiler de marcas</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Ejecuta el perfilador de tecnologia ecommerce (Shopify, WooCommerce, Magento, VTEX o custom)
            en lotes controlados para actualizar cada marca.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLog([])}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
        >
          Limpiar log
        </button>
      </div>

      <div className="mt-6 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Con sitio</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{status?.total ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Procesadas</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{status?.withPlatform ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pendientes</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{status?.pending ?? 0}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        {COUNTS.map((value) => (
          <button
            key={`count-${value}`}
            type="button"
            onClick={() => setCount(value)}
            className={`rounded-full border px-4 py-2 text-xs font-semibold ${
              count === value
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            {value} marcas
          </button>
        ))}
        <button
          type="button"
          onClick={runBatch}
          disabled={running}
          className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {running ? "Procesando..." : "Procesar lote"}
        </button>
        <span className="text-xs text-slate-500">Procesa en serie para evitar bloqueos.</span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Progreso</span>
          <span>
            {processed}/{count}
          </span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Resultados lote</p>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>
              <span className="font-semibold text-slate-800">Procesadas:</span> {processed}
            </p>
            <p>
              <span className="font-semibold text-slate-800">Exitosas:</span> {success}
            </p>
            <p>
              <span className="font-semibold text-slate-800">Fallidas:</span> {failed}
            </p>
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>
        <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Log reciente</p>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto text-xs text-slate-600">
            {log.length ? (
              log.map((entry, index) => <p key={`log-${index}`}>{entry}</p>)
            ) : (
              <p className="text-slate-500">Aun no hay eventos.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
