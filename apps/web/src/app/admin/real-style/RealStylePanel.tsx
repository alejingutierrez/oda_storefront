"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/image-proxy";
import {
  isRealStyleKey,
  REAL_STYLE_OPTIONS,
  REAL_STYLE_LABELS,
  type RealStyleKey,
} from "@/lib/real-style/constants";

type QueueItem = {
  id: string;
  name: string;
  brandName: string;
  imageCoverUrl: string | null;
  category: string | null;
  subcategory: string | null;
  stylePrimary: string | null;
  styleSecondary: string | null;
  styleTags: string[];
  sourceUrl: string | null;
  createdAt: string;
  suggestedRealStyle: RealStyleKey | null;
  suggestionSource: "style_primary" | "style_tags" | null;
  suggestionScore: number;
};

type Summary = {
  eligibleTotal: number;
  pendingCount: number;
  assignedCount: number;
  byRealStyle: Array<{ key: RealStyleKey; label: string; order: number; count: number }>;
};

type QueuePayload = {
  ok: boolean;
  limit: number;
  items: QueueItem[];
  nextCursor: string | null;
  summary?: Summary;
};

type SummaryPayload = {
  ok: boolean;
  summary: Summary;
};

const BATCH_LIMIT = 30;
const PREFETCH_LOW_WATERMARK = 8;
const SUMMARY_SYNC_EVERY_ASSIGNMENTS = 10;
const SKIPPED_SESSION_KEY = "oda_admin_real_style_skipped_v1";
const MESSAGE_TIMEOUT_MS = 2_400;

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isTextInputLike(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

function formatShort(value: string | null) {
  if (!value) return "—";
  return value;
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString("es-CO");
  } catch {
    return value;
  }
}

function readSkippedSetFromSession() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.sessionStorage.getItem(SKIPPED_SESSION_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((entry) => typeof entry === "string"));
  } catch {
    return new Set<string>();
  }
}

function writeSkippedSetToSession(skippedSet: Set<string>) {
  try {
    window.sessionStorage.setItem(SKIPPED_SESSION_KEY, JSON.stringify(Array.from(skippedSet)));
  } catch {
    // ignore
  }
}

export default function RealStylePanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const skippedSetRef = useRef<Set<string>>(readSkippedSetFromSession());
  const assignmentsSinceSummarySyncRef = useRef(0);

  const removeFirstItem = useCallback(() => {
    setItems((prev) => prev.slice(1));
  }, []);

  const fetchSummary = useCallback(async (options?: { silent?: boolean }) => {
    setLoadingSummary(true);
    try {
      const res = await fetch("/api/admin/real-style/summary", { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as Partial<SummaryPayload> & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "No se pudo actualizar el resumen");
      }
      if (payload.summary) {
        setSummary(payload.summary);
      }
      assignmentsSinceSummarySyncRef.current = 0;
    } catch (err) {
      console.warn(err);
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : "Error actualizando resumen");
      }
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchQueue = useCallback(async (mode: "reset" | "append", cursor: string | null) => {
    if (mode === "reset") {
      setLoadingQueue(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", String(BATCH_LIMIT));
      params.set("includeSummary", "false");
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/admin/real-style/queue?${params.toString()}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as Partial<QueuePayload> & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "No se pudo cargar la cola real_style");
      }

      const batch = Array.isArray(payload.items) ? payload.items : [];
      const filteredBatch = batch.filter((item) => !skippedSetRef.current.has(item.id));

      setItems((prev) => {
        if (mode === "reset") return filteredBatch;
        if (filteredBatch.length === 0) return prev;

        const existing = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        for (const item of filteredBatch) {
          if (existing.has(item.id)) continue;
          merged.push(item);
          existing.add(item.id);
        }
        return merged;
      });

      setNextCursor(typeof payload.nextCursor === "string" && payload.nextCursor.length > 0 ? payload.nextCursor : null);
      if (payload.summary) setSummary(payload.summary);
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error cargando la cola");
    } finally {
      if (mode === "reset") setLoadingQueue(false);
      else setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void fetchQueue("reset", null);
    void fetchSummary({ silent: true });
  }, [fetchQueue, fetchSummary]);

  useEffect(() => {
    if (loadingQueue || loadingMore || !nextCursor) return;
    if (items.length > PREFETCH_LOW_WATERMARK) return;
    void fetchQueue("append", nextCursor);
  }, [fetchQueue, items.length, loadingQueue, loadingMore, nextCursor]);

  useEffect(() => {
    if (loadingQueue || loadingMore) return;
    if (items.length !== 0) return;
    void fetchSummary({ silent: true });
  }, [fetchSummary, items.length, loadingQueue, loadingMore]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), MESSAGE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const activeItem = items[0] ?? null;
  const previewItems = items.slice(1, 3);

  const completionPct = useMemo(() => {
    if (!summary || summary.eligibleTotal <= 0) return 0;
    return Math.round((summary.assignedCount / summary.eligibleTotal) * 100);
  }, [summary]);

  const applyOptimisticSummaryUpdate = useCallback(
    (params: {
      pendingDelta?: number;
      assignedDelta?: number;
      eligibleDelta?: number;
      realStyle?: RealStyleKey | null;
    }) => {
      setSummary((prev) => {
        if (!prev) return prev;

        const pendingCount = Math.max(0, prev.pendingCount + (params.pendingDelta ?? 0));
        const assignedCount = Math.max(0, prev.assignedCount + (params.assignedDelta ?? 0));
        const eligibleTotal = Math.max(0, prev.eligibleTotal + (params.eligibleDelta ?? 0));

        const byRealStyle = prev.byRealStyle.map((row) => {
          if (!params.realStyle || row.key !== params.realStyle) return row;
          return { ...row, count: Math.max(0, row.count + 1) };
        });

        return {
          ...prev,
          eligibleTotal,
          pendingCount,
          assignedCount,
          byRealStyle,
        };
      });
    },
    [],
  );

  const bumpAndMaybeResyncSummary = useCallback(() => {
    assignmentsSinceSummarySyncRef.current += 1;
    if (assignmentsSinceSummarySyncRef.current >= SUMMARY_SYNC_EVERY_ASSIGNMENTS) {
      assignmentsSinceSummarySyncRef.current = 0;
      void fetchSummary({ silent: true });
    }
  }, [fetchSummary]);

  const assignRealStyle = useCallback(
    async (realStyle: RealStyleKey) => {
      if (!activeItem || assigning) return;
      setAssigning(true);
      setError(null);
      setMessage(null);

      try {
        const res = await fetch("/api/admin/real-style/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: activeItem.id,
            realStyle,
            includeSummary: false,
          }),
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (res.status === 504 || payload?.error === "assign_busy") {
            setError("Servidor ocupado. Intenta de nuevo.");
            return;
          }

          if (res.status === 409) {
            if (payload?.summary) {
              setSummary(payload.summary as Summary);
            } else {
              const conflictStyle = isRealStyleKey(payload?.currentRealStyle) ? payload.currentRealStyle : null;
              applyOptimisticSummaryUpdate({
                pendingDelta: -1,
                assignedDelta: conflictStyle ? 1 : 0,
                realStyle: conflictStyle,
              });
            }

            setMessage("Producto ya cambió de estado. Continuamos con el siguiente.");
            removeFirstItem();
            bumpAndMaybeResyncSummary();
            if (!payload?.summary) {
              void fetchSummary({ silent: true });
            }
            return;
          }
          throw new Error(payload?.error ?? "No se pudo guardar real_style");
        }

        if (payload?.summary) {
          setSummary(payload.summary as Summary);
        } else {
          applyOptimisticSummaryUpdate({
            pendingDelta: -1,
            assignedDelta: 1,
            realStyle,
          });
        }

        removeFirstItem();
        bumpAndMaybeResyncSummary();
      } catch (err) {
        console.warn(err);
        setError(err instanceof Error ? err.message : "Error guardando clasificación");
      } finally {
        setAssigning(false);
      }
    },
    [
      activeItem,
      applyOptimisticSummaryUpdate,
      assigning,
      bumpAndMaybeResyncSummary,
      fetchSummary,
      removeFirstItem,
    ],
  );

  const handleSkip = useCallback(() => {
    if (!activeItem || assigning) return;

    const nextSkippedSet = new Set(skippedSetRef.current);
    nextSkippedSet.add(activeItem.id);
    skippedSetRef.current = nextSkippedSet;
    writeSkippedSetToSession(nextSkippedSet);

    setMessage("Producto saltado para esta sesión.");
    setError(null);
    removeFirstItem();
  }, [activeItem, assigning, removeFirstItem]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputLike(event.target)) return;
      if (!activeItem || assigning) return;

      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > 8) return;

      event.preventDefault();
      const option = REAL_STYLE_OPTIONS[n - 1];
      if (!option) return;
      void assignRealStyle(option.key);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeItem, assignRealStyle, assigning]);

  const renderedCover = activeItem
    ? proxiedImageUrl(activeItem.imageCoverUrl, { productId: activeItem.id, kind: "cover" }) ?? activeItem.imageCoverUrl
    : null;
  const suggestedKey = activeItem?.suggestedRealStyle ?? null;

  const queueDone = !loadingQueue && items.length === 0 && !nextCursor;

  return (
    <section className="space-y-3 md:space-y-4 xl:space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4 xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 md:text-lg">Real Style Board</h2>
            <p className="mt-1 hidden text-sm text-slate-600 xl:block">
              Asigna cada producto a 1 de 8 estilos. Guardado inmediato, sin autoasignación.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchQueue("reset", null)}
              disabled={loadingQueue || loadingMore}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Recargar
            </button>
            <button
              type="button"
              onClick={() => void fetchSummary()}
              disabled={loadingSummary}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              {loadingSummary ? "…" : "Resumen"}
            </button>
          </div>
        </div>

        <div className="mt-2 flex gap-2 md:mt-3 md:gap-3">
          <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs md:rounded-xl md:px-3 md:py-2 md:text-sm">
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 md:text-xs">Elegibles</p>
            <p className="font-semibold text-slate-900">{summary ? summary.eligibleTotal.toLocaleString("es-CO") : "—"}</p>
          </div>
          <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs md:rounded-xl md:px-3 md:py-2 md:text-sm">
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 md:text-xs">Pendientes</p>
            <p className="font-semibold text-slate-900">{summary ? summary.pendingCount.toLocaleString("es-CO") : "—"}</p>
          </div>
          <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs md:rounded-xl md:px-3 md:py-2 md:text-sm">
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 md:text-xs">Completado</p>
            <p className="font-semibold text-slate-900">
              {summary ? `${summary.assignedCount.toLocaleString("es-CO")} (${completionPct}%)` : "—"}
            </p>
          </div>
        </div>

        {message ? (
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 md:text-sm">{message}</p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 md:text-sm">{error}</p>
        ) : null}
      </header>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4 xl:space-y-4 xl:p-6">
          {loadingQueue ? (
            <div className="flex min-h-[400px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-600 xl:min-h-[560px]">
              Cargando baraja…
            </div>
          ) : queueDone ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-center xl:min-h-[560px]">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Completado</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">No hay más pendientes</h3>
              <p className="mt-2 text-sm text-slate-600">Ya clasificaste todos los productos pendientes de esta cola.</p>
            </div>
          ) : activeItem ? (
            <>
              <div className="relative mx-auto mt-2 h-[400px] w-full max-w-[280px] md:max-w-none lg:h-[480px] xl:h-[560px] xl:max-w-[360px]">
                {previewItems[1] ? (
                  <div className="absolute inset-x-8 top-10 h-[340px] rounded-3xl border border-slate-200 bg-slate-100/60 shadow-inner lg:h-[420px] xl:h-[480px]" />
                ) : null}
                {previewItems[0] ? (
                  <div className="absolute inset-x-5 top-6 h-[360px] rounded-3xl border border-slate-200 bg-slate-100/80 shadow-inner lg:h-[440px] xl:h-[500px]" />
                ) : null}

                <article className="absolute inset-x-0 top-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
                    {renderedCover ? (
                      <Image
                        src={renderedCover}
                        alt={activeItem.name}
                        fill
                        className="object-cover"
                        sizes="(min-width: 1280px) 360px, (min-width: 640px) 60vw, 90vw"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-400">
                        Sin imagen
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 p-3 xl:space-y-2 xl:p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 xl:text-[11px]">{activeItem.brandName}</p>
                      <p className="text-[10px] text-slate-400 xl:text-xs">{formatDate(activeItem.createdAt)}</p>
                    </div>
                    <h3 className="line-clamp-2 text-xs font-semibold text-slate-900 xl:text-sm">{activeItem.name}</h3>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 xl:text-xs">
                      <p><span className="font-semibold text-slate-700">Cat:</span> {formatShort(activeItem.category)}</p>
                      <p><span className="font-semibold text-slate-700">Sub:</span> {formatShort(activeItem.subcategory)}</p>
                      <p><span className="font-semibold text-slate-700">Style:</span> {formatShort(activeItem.stylePrimary)}</p>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 xl:rounded-xl xl:px-3 xl:py-2 xl:text-xs">
                      <span className="font-semibold text-slate-800">Sugerido:</span>{" "}
                      {activeItem.suggestedRealStyle ? REAL_STYLE_LABELS[activeItem.suggestedRealStyle] : "—"}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSkip}
                        disabled={assigning}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 disabled:opacity-50 xl:px-4 xl:py-2 xl:text-xs"
                      >
                        Saltar
                      </button>

                      {suggestedKey ? (
                        <button
                          type="button"
                          onClick={() => void assignRealStyle(suggestedKey)}
                          disabled={assigning}
                          className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 disabled:opacity-50 xl:px-4 xl:py-2 xl:text-xs"
                        >
                          {assigning ? "…" : "Usar sugerido"}
                        </button>
                      ) : null}

                      {activeItem.sourceUrl ? (
                        <a
                          href={activeItem.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 xl:px-4 xl:py-2 xl:text-xs"
                        >
                          Fuente
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              </div>

              <p className="hidden text-center text-xs text-slate-500 xl:block">
                Atajos: teclas <span className="font-semibold text-slate-700">1–8</span> para asignar rápido.
              </p>
            </>
          ) : (
            <div className="flex min-h-[400px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-600 xl:min-h-[560px]">
              Preparando siguiente producto…
            </div>
          )}
        </div>

        <aside className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:space-y-3 xl:space-y-4 xl:p-5">
          <div>
            <p className="text-xs font-semibold text-slate-700">Clasificar como:</p>
          </div>

          <div className="grid gap-2 xl:gap-3">
            {REAL_STYLE_OPTIONS.map((option, index) => {
              const count = summary?.byRealStyle.find((row) => row.key === option.key)?.count ?? 0;
              const suggested = activeItem?.suggestedRealStyle === option.key;

              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => void assignRealStyle(option.key)}
                  disabled={!activeItem || assigning}
                  className={classNames(
                    "w-full min-h-[44px] rounded-xl border px-3 py-2 text-left transition disabled:opacity-50 xl:rounded-2xl xl:px-4 xl:py-3",
                    suggested
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 xl:text-[11px]">Caja {index + 1}</p>
                      <p className="mt-0.5 text-xs font-semibold text-slate-900 xl:mt-1 xl:text-sm">{option.label}</p>
                      <p className="mt-0.5 hidden text-[11px] text-slate-500 xl:block">{option.key}</p>
                    </div>
                    <div className="hidden text-right lg:block">
                      <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Asignados</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{count.toLocaleString("es-CO")}</p>
                    </div>
                  </div>
                  {suggested ? (
                    <p className="mt-2 text-xs font-semibold text-emerald-700">Sugerencia activa para este producto</p>
                  ) : null}
                </button>
              );
            })}
          </div>

          {loadingMore ? (
            <p className="text-xs text-slate-500">Cargando más pendientes…</p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
