"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlatformOption = {
  platform: string;
  count: number;
};

type RunState = {
  status?: string;
  runId?: string;
  total?: number;
  completed?: number;
  failed?: number;
  pending?: number;
  cursor?: number;
  lastError?: string | null;
  blockReason?: string | null;
};

type BrandOption = {
  id: string;
  name: string;
  slug: string;
  siteUrl: string | null;
  ecommercePlatform: string | null;
  _count: { products: number };
  runState?: RunState | null;
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
  lastError?: string | null;
  blockReason?: string | null;
};

const POLL_INTERVAL_MS = 2000;
const RUN_BATCH_SIZE = 25;
const DRAIN_BATCH = 40;
const DRAIN_CONCURRENCY = 8;
const DRAIN_MAX_MS = 15000;

const buildProgress = (state?: RunState | ExtractSummary | null) => {
  if (!state) {
    return { total: 0, completed: 0, failed: 0, pending: 0, percent: 0 };
  }
  const isSummary = "discovered" in state;
  const total = isSummary ? state.total ?? state.discovered ?? 0 : state.total ?? 0;
  const processed = isSummary ? state.processed ?? 0 : 0;
  const failed = state.failed ?? 0;
  const pending = state.pending ?? Math.max(0, total - processed);
  const completed = Math.max(0, total - pending - failed);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, failed, pending, percent };
};

export default function CatalogExtractorPanel() {
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoRunAll, setAutoRunAll] = useState(false);
  const [summary, setSummary] = useState<ExtractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainInFlightRef = useRef(false);

  const currentBrand = useMemo(
    () => brands.find((brand) => brand.id === selectedBrand) ?? null,
    [brands, selectedBrand],
  );

  const getNextBrandId = useCallback(
    (excludeId?: string, mode: "auto" | "single" = "single") => {
      if (!brands.length) return "";
      const isPending = (brand: BrandOption) => {
        if (brand.id === excludeId) return false;
        const status = brand.runState?.status ?? "idle";
        if (status === "completed") return false;
        if (mode === "auto" && (status === "paused" || status === "stopped" || status === "blocked")) {
          return false;
        }
        return true;
      };
      const uncataloged = brands.filter(
        (brand) => (brand._count?.products ?? 0) === 0 && isPending(brand),
      );
      if (uncataloged.length) return uncataloged[0]?.id ?? "";
      const next = brands.find(isPending);
      return next?.id ?? "";
    },
    [brands],
  );

  const currentState = useMemo(
    () => summary ?? currentBrand?.runState ?? null,
    [summary, currentBrand],
  );

  const progress = useMemo(() => buildProgress(currentState), [currentState]);
  const shouldResumeForState = useCallback((state: RunState | null) => {
    if (!state) return false;
    const cursorValue =
      "cursor" in state && typeof state.cursor === "number" ? state.cursor : 0;
    const stateProgress = buildProgress(state);
    const hasProgress = stateProgress.completed > 0 || stateProgress.failed > 0 || cursorValue > 0;
    return Boolean(
      state.status !== "completed" &&
        (state.status === "paused" ||
          state.status === "stopped" ||
          (state.status === "processing" && hasProgress)),
    );
  }, []);
  const shouldResume = useMemo(() => shouldResumeForState(currentState), [currentState, shouldResumeForState]);
  const playLabel = useMemo(() => {
    if (running) return "Procesando...";
    return shouldResume ? "Resume" : "Play";
  }, [running, shouldResume]);
  const errorDetails = useMemo(() => {
    if (error) return { title: "Fallo al ejecutar", message: error };
    if (currentState?.blockReason) {
      return { title: "Proceso bloqueado", message: currentState.blockReason };
    }
    if (currentState?.lastError) {
      return { title: "Último error", message: currentState.lastError };
    }
    if (summary?.errors?.length) {
      const last = summary.errors[summary.errors.length - 1];
      return { title: "Error de producto", message: `${last.url} — ${last.error}` };
    }
    return null;
  }, [error, currentState, summary]);

  const updateBrandRunState = useCallback((brandId: string, nextState: RunState) => {
    setBrands((prev) =>
      prev.map((brand) =>
        brand.id === brandId
          ? {
              ...brand,
              runState: nextState,
            }
          : brand,
      ),
    );
  }, []);

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/catalog-extractor/platforms", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudieron cargar las plataformas");
      const payload = await res.json();
      setPlatforms(payload.platforms ?? []);
    } catch (err) {
      console.warn(err);
    }
  }, []);

  const fetchBrands = useCallback(
    async (platform: string) => {
      if (!platform) return;
      setLoadingBrands(true);
      try {
        const res = await fetch(
          `/api/admin/catalog-extractor/brands?platform=${encodeURIComponent(platform)}&limit=200`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("No se pudieron cargar las marcas");
        const payload = await res.json();
        const list = (payload.brands ?? []) as BrandOption[];
        setBrands(list);
        const nextId = payload.nextBrandId || (list[0] ? list[0].id : "");
        setSelectedBrand((prev) => (prev && list.some((b) => b.id === prev) ? prev : nextId));
      } catch (err) {
        console.warn(err);
      } finally {
        setLoadingBrands(false);
      }
    },
    [],
  );

  const fetchState = useCallback(async (brandId: string) => {
    if (!brandId) return;
    try {
      const res = await fetch(`/api/admin/catalog-extractor/state?brandId=${brandId}`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.state) {
        updateBrandRunState(brandId, payload.state);
        return payload.state as RunState;
      }
    } catch (err) {
      console.warn(err);
    }
    return null;
  }, [updateBrandRunState]);

  const drainNow = useCallback(async (brandId: string) => {
    if (!brandId || drainInFlightRef.current) return null;
    drainInFlightRef.current = true;
    try {
      const res = await fetch("/api/admin/catalog-extractor/drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          drainBatch: DRAIN_BATCH,
          drainConcurrency: DRAIN_CONCURRENCY,
          drainMaxMs: DRAIN_MAX_MS,
        }),
      });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      drainInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchPlatforms();
  }, [fetchPlatforms]);

  useEffect(() => {
    if (!selectedPlatform && platforms.length) {
      setSelectedPlatform(platforms[0]?.platform ?? "");
    }
  }, [platforms, selectedPlatform]);

  useEffect(() => {
    setAutoPlay(false);
    setRunning(false);
    setSummary(null);
    if (!selectedPlatform) return;
    fetchBrands(selectedPlatform);
  }, [selectedPlatform, fetchBrands]);

  useEffect(() => {
    setSummary(null);
    if (!selectedBrand) return;
    fetchState(selectedBrand);
  }, [selectedBrand, fetchState]);

  useEffect(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    if (!selectedBrand) return;
    let active = true;
    const tick = async () => {
      if (!active) return;
      const state = await fetchState(selectedBrand);
      if (active && state?.status === "processing" && autoPlay) {
        await drainNow(selectedBrand);
        await fetchState(selectedBrand);
      }
      if (!active) return;
      pollRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      active = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [selectedBrand, fetchState, drainNow, autoPlay]);

  const runExtraction = useCallback(async (overrideBrandId?: string) => {
    const targetBrand = overrideBrandId ?? selectedBrand;
    if (!targetBrand) return;
    const targetState =
      targetBrand === selectedBrand
        ? currentState
        : brands.find((brand) => brand.id === targetBrand)?.runState ?? null;
    const resumeFlag = shouldResumeForState(targetState);
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/catalog-extractor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: targetBrand,
          batchSize: RUN_BATCH_SIZE,
          resume: resumeFlag,
          drainBatch: DRAIN_BATCH,
          drainConcurrency: DRAIN_CONCURRENCY,
          drainMaxMs: DRAIN_MAX_MS,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Fallo ejecutando extractor");
      }
      const payload = await res.json();
      const nextSummary = payload.summary ?? null;
      setSummary(nextSummary);
      if (nextSummary) {
        updateBrandRunState(targetBrand, {
          status: nextSummary.status,
          runId: nextSummary.runId,
          total: nextSummary.total ?? nextSummary.discovered ?? 0,
          completed: buildProgress(nextSummary).completed,
          failed: nextSummary.failed ?? 0,
          pending: nextSummary.pending ?? 0,
          lastError: nextSummary.lastError ?? null,
          blockReason: nextSummary.blockReason ?? null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  }, [selectedBrand, currentState, brands, shouldResumeForState, updateBrandRunState]);

  const handlePlay = () => {
    if (!selectedBrand) return;
    setAutoRunAll(false);
    setAutoPlay(true);
    runExtraction(selectedBrand);
  };

  const handleAutoRunAll = () => {
    const targetBrand = selectedBrand || getNextBrandId(undefined, "auto");
    if (!targetBrand) return;
    setAutoRunAll(true);
    if (targetBrand !== selectedBrand) {
      setSelectedBrand(targetBrand);
    }
    setAutoPlay(true);
    runExtraction(targetBrand);
  };

  const handlePause = async () => {
    if (!selectedBrand) return;
    setAutoPlay(false);
    setAutoRunAll(false);
    setRunning(false);
    await fetch("/api/admin/catalog-extractor/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: selectedBrand }),
    });
    fetchBrands(selectedPlatform);
  };

  const handleStop = async () => {
    if (!selectedBrand) return;
    setAutoPlay(false);
    setAutoRunAll(false);
    setRunning(false);
    setSummary(null);
    await fetch("/api/admin/catalog-extractor/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: selectedBrand }),
    });
    fetchBrands(selectedPlatform);
  };

  const handleFinish = async () => {
    if (!selectedBrand || !currentBrand) return;
    const confirmFinish = window.confirm(
      `¿Confirmas marcar como terminada la marca ${currentBrand.name}? Saldrá de la lista de espera.`,
    );
    if (!confirmFinish) return;
    setAutoPlay(false);
    setAutoRunAll(false);
    setRunning(false);
    setSummary(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/catalog-extractor/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: selectedBrand }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "No se pudo marcar como terminada");
      }
      fetchBrands(selectedPlatform);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    }
  };

  useEffect(() => {
    if (!autoPlay || running) return;
    const targetBrand = autoRunAll ? selectedBrand || getNextBrandId() : selectedBrand;
    if (!targetBrand) {
      if (autoRunAll) {
        setAutoPlay(false);
        setAutoRunAll(false);
      }
      return;
    }
    if (!currentState) {
      if (!selectedBrand) setSelectedBrand(targetBrand);
      runExtraction(targetBrand);
      return;
    }

    if (currentState.status === "blocked") {
      if (autoRunAll) {
        const nextTarget = getNextBrandId(selectedBrand ?? targetBrand, "auto");
        if (nextTarget && nextTarget !== selectedBrand) {
          setSelectedBrand(nextTarget);
          return;
        }
      }
      setAutoPlay(false);
      setAutoRunAll(false);
      return;
    }
    if (currentState.status === "paused" || currentState.status === "stopped") {
      if (autoRunAll) {
        const nextTarget = getNextBrandId(selectedBrand ?? targetBrand, "auto");
        if (nextTarget && nextTarget !== selectedBrand) {
          setSelectedBrand(nextTarget);
          return;
        }
      }
      setAutoPlay(false);
      setAutoRunAll(false);
      return;
    }

    if (currentState.status === "processing") {
      return;
    }

    if (currentState.status === "completed") {
      if (autoRunAll) {
        const nextTarget = getNextBrandId(selectedBrand ?? targetBrand, "auto");
        if (nextTarget && nextTarget !== selectedBrand) {
          setSelectedBrand(nextTarget);
          return;
        }
      }
      setAutoPlay(false);
      setAutoRunAll(false);
      return;
    }

    const timer = setTimeout(() => {
      runExtraction();
    }, 600);
    return () => clearTimeout(timer);
  }, [
    autoPlay,
    autoRunAll,
    running,
    selectedBrand,
    currentState,
    runExtraction,
    getNextBrandId,
  ]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Catalog extractor</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Selecciona una tecnologia y procesa marcas en orden. El extractor obtiene sitemap primero,
            carga productos uno a uno y recuerda el progreso para reanudar.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr,1fr,0.8fr]">
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-500">Tecnologia</label>
          <select
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={selectedPlatform}
            onChange={(event) => setSelectedPlatform(event.target.value)}
          >
            <option value="">Selecciona tecnologia</option>
            {platforms.map((platform) => (
              <option key={platform.platform} value={platform.platform}>
                {platform.platform} · {platform.count} marcas
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-500">Marca actual</label>
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {currentBrand ? (
              <p>
                {currentBrand.name} · {currentBrand.ecommercePlatform ?? "—"} ·{" "}
                {currentBrand._count.products} productos
              </p>
            ) : (
              <p>Selecciona una tecnologia</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <button
            type="button"
            onClick={handleAutoRunAll}
            disabled={running || brands.length === 0}
            className="rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Auto‑Play (todas las marcas)
          </button>
          <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={handlePlay}
            disabled={!selectedBrand || running}
            className="flex-1 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {playLabel}
          </button>
          <button
            type="button"
            onClick={handlePause}
            disabled={!selectedBrand}
            className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            Pausar
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={!selectedBrand}
            className="flex-1 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
          >
            Detener
          </button>
          <button
            type="button"
            onClick={handleFinish}
            disabled={!selectedBrand}
            className="flex-1 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            Finalizar
          </button>
          </div>
        </div>
      </div>

      {loadingBrands && <p className="mt-2 text-xs text-slate-500">Cargando marcas...</p>}

      {currentBrand && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">Sitio:</span> {currentBrand.siteUrl ?? "—"}
          </p>
          <p>
            <span className="font-semibold text-slate-800">Estado:</span> {currentState?.status ?? "—"}
          </p>
        </div>
      )}

      {errorDetails && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <p className="text-xs uppercase tracking-[0.2em] text-rose-500">{errorDetails.title}</p>
          <p className="mt-2">{errorDetails.message}</p>
        </div>
      )}

      {currentState && (
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
                Estado: {currentState.status ?? "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {summary?.errors?.length ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Errores recientes</p>
          <div className="mt-2 space-y-2 text-xs text-slate-600">
            {summary.errors.slice(-5).map((item) => (
              <p key={`${item.url}-${item.error}`}>{item.url} — {item.error}</p>
            ))}
          </div>
        </div>
      ) : null}

      {brands.length > 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
            <p>Marcas por tecnologia</p>
            <p>{brands.length} marcas</p>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {brands.map((brand) => (
              <button
                key={brand.id}
                type="button"
                onClick={() => setSelectedBrand(brand.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                  brand.id === selectedBrand
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <span>{brand.name}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {brand.runState?.status ?? "pendiente"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
