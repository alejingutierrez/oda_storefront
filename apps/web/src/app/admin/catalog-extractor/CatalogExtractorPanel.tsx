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
};

const buildProgress = (state?: RunState | ExtractSummary | null) => {
  const total = state?.total ?? state?.discovered ?? 0;
  const failed = state?.failed ?? 0;
  const pending = state?.pending ?? Math.max(0, total - (state?.processed ?? 0));
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
  const [summary, setSummary] = useState<ExtractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentBrand = useMemo(
    () => brands.find((brand) => brand.id === selectedBrand) ?? null,
    [brands, selectedBrand],
  );

  const nextBrandId = useMemo(() => {
    if (!brands.length) return "";
    const next = brands.find((brand) => brand.runState?.status !== "completed");
    return next?.id ?? brands[0]?.id ?? "";
  }, [brands]);

  const currentState = useMemo(
    () => summary ?? currentBrand?.runState ?? null,
    [summary, currentBrand],
  );

  const progress = useMemo(() => buildProgress(currentState), [currentState]);

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
      }
    } catch (err) {
      console.warn(err);
    }
  }, [updateBrandRunState]);

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
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!selectedBrand) return;
    pollRef.current = setInterval(() => {
      fetchState(selectedBrand);
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedBrand, fetchState]);

  const runExtraction = useCallback(async () => {
    if (!selectedBrand) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/catalog-extractor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: selectedBrand, batchSize: 1 }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Fallo ejecutando extractor");
      }
      const payload = await res.json();
      const nextSummary = payload.summary ?? null;
      setSummary(nextSummary);
      if (nextSummary) {
        updateBrandRunState(selectedBrand, {
          status: nextSummary.status,
          runId: nextSummary.runId,
          total: nextSummary.total ?? nextSummary.discovered ?? 0,
          completed: buildProgress(nextSummary).completed,
          failed: nextSummary.failed ?? 0,
          pending: nextSummary.pending ?? 0,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setAutoPlay(false);
    } finally {
      setRunning(false);
    }
  }, [selectedBrand]);

  const handlePlay = () => {
    if (!selectedBrand) return;
    setAutoPlay(true);
    runExtraction();
  };

  const handlePause = async () => {
    if (!selectedBrand) return;
    setAutoPlay(false);
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
    setRunning(false);
    setSummary(null);
    await fetch("/api/admin/catalog-extractor/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: selectedBrand }),
    });
    fetchBrands(selectedPlatform);
  };

  useEffect(() => {
    if (!autoPlay || running || !selectedBrand) return;
    if (!currentState) {
      runExtraction();
      return;
    }

    if (currentState.status === "blocked" || currentState.status === "paused" || currentState.status === "stopped") {
      setAutoPlay(false);
      return;
    }

    if (currentState.status === "completed") {
      if (nextBrandId && nextBrandId !== selectedBrand) {
        setSelectedBrand(nextBrandId);
        return;
      }
      setAutoPlay(false);
      return;
    }

    const timer = setTimeout(() => {
      runExtraction();
    }, 600);
    return () => clearTimeout(timer);
  }, [autoPlay, running, selectedBrand, currentState, runExtraction, nextBrandId]);

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
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={handlePlay}
            disabled={!selectedBrand || running}
            className="flex-1 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {running ? "Procesando..." : "Play"}
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

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
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
