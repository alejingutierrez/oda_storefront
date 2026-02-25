"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/image-proxy";
import { REAL_STYLE_OPTIONS, REAL_STYLE_LABELS, type RealStyleKey } from "@/lib/real-style/constants";

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

type QueueResponse = {
  ok: boolean;
  limit: number;
  items: QueueItem[];
  nextCursor: string | null;
  summary: Summary;
};

const BATCH_LIMIT = 30;
const SKIPPED_SESSION_KEY = "oda_admin_real_style_skipped_v1";

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

export default function RealStylePanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<RealStyleKey | null>(null);

  const [skippedSet, setSkippedSet] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem(SKIPPED_SESSION_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((entry) => typeof entry === "string"));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SKIPPED_SESSION_KEY, JSON.stringify(Array.from(skippedSet)));
    } catch {
      // ignore
    }
  }, [skippedSet]);

  const removeFirstItem = useCallback(() => {
    setItems((prev) => prev.slice(1));
  }, []);

  const fetchQueue = useCallback(
    async (mode: "reset" | "append", cursor: string | null) => {
      if (mode === "reset") {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const params = new URLSearchParams();
        params.set("limit", String(BATCH_LIMIT));
        if (cursor) params.set("cursor", cursor);

        const res = await fetch(`/api/admin/real-style/queue?${params.toString()}`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as Partial<QueueResponse> & { error?: string };
        if (!res.ok) {
          throw new Error(payload.error ?? "No se pudo cargar la cola real_style");
        }

        const batch = Array.isArray(payload.items) ? payload.items : [];
        const filteredBatch = batch.filter((item) => !skippedSet.has(item.id));

        setItems((prev) => {
          if (mode === "reset") return filteredBatch;
          const existing = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of filteredBatch) {
            if (existing.has(item.id)) continue;
            merged.push(item);
          }
          return merged;
        });

        setNextCursor(typeof payload.nextCursor === "string" && payload.nextCursor.length > 0 ? payload.nextCursor : null);
        if (payload.summary) setSummary(payload.summary);
      } catch (err) {
        console.warn(err);
        setError(err instanceof Error ? err.message : "Error cargando la cola");
      } finally {
        if (mode === "reset") setLoading(false);
        else setLoadingMore(false);
      }
    },
    [skippedSet],
  );

  useEffect(() => {
    void fetchQueue("reset", null);
  }, [fetchQueue]);

  useEffect(() => {
    if (loading || loadingMore || !nextCursor) return;
    if (items.length > 5) return;
    void fetchQueue("append", nextCursor);
  }, [fetchQueue, items.length, loading, loadingMore, nextCursor]);

  const activeItem = items[0] ?? null;
  const previewItems = items.slice(1, 3);

  const completionPct = useMemo(() => {
    if (!summary || summary.eligibleTotal <= 0) return 0;
    return Math.round((summary.assignedCount / summary.eligibleTotal) * 100);
  }, [summary]);

  const assignRealStyle = useCallback(
    async (realStyle: RealStyleKey) => {
      if (!activeItem || saving) return;
      setSaving(true);
      setError(null);
      setMessage(null);

      try {
        const res = await fetch("/api/admin/real-style/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: activeItem.id, realStyle }),
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (res.status === 409) {
            if (payload?.summary) setSummary(payload.summary as Summary);
            setMessage("Producto ya clasificado por otro admin. Continuamos con el siguiente.");
            removeFirstItem();
            return;
          }
          throw new Error(payload?.error ?? "No se pudo guardar real_style");
        }

        if (payload?.summary) setSummary(payload.summary as Summary);
        setMessage(`Asignado a ${REAL_STYLE_LABELS[realStyle]}.`);
        removeFirstItem();
      } catch (err) {
        console.warn(err);
        setError(err instanceof Error ? err.message : "Error guardando clasificación");
      } finally {
        setSaving(false);
      }
    },
    [activeItem, removeFirstItem, saving],
  );

  const handleSkip = useCallback(() => {
    if (!activeItem || saving) return;
    setSkippedSet((prev) => {
      const next = new Set(prev);
      next.add(activeItem.id);
      return next;
    });
    setMessage("Producto saltado para esta sesión.");
    setError(null);
    removeFirstItem();
  }, [activeItem, removeFirstItem, saving]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputLike(event.target)) return;
      if (!activeItem || saving) return;

      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > 8) return;

      event.preventDefault();
      const option = REAL_STYLE_OPTIONS[n - 1];
      if (!option) return;
      void assignRealStyle(option.key);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeItem, assignRealStyle, saving]);

  const renderedCover = activeItem
    ? proxiedImageUrl(activeItem.imageCoverUrl, { productId: activeItem.id, kind: "cover" }) ?? activeItem.imageCoverUrl
    : null;

  const queueDone = !loading && items.length === 0 && !nextCursor;

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Curación manual</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Real Style Board</h2>
            <p className="mt-2 text-sm text-slate-600">
              Asigna cada producto a 1 de 8 estilos. Guardado inmediato, sin autoasignación.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchQueue("reset", null)}
              disabled={loading || saving}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Recargar cola
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Elegibles</p>
            <p className="mt-1 font-semibold text-slate-900">{summary ? summary.eligibleTotal.toLocaleString("es-CO") : "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Pendientes</p>
            <p className="mt-1 font-semibold text-slate-900">{summary ? summary.pendingCount.toLocaleString("es-CO") : "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Completado</p>
            <p className="mt-1 font-semibold text-slate-900">
              {summary ? `${summary.assignedCount.toLocaleString("es-CO")} (${completionPct}%)` : "—"}
            </p>
          </div>
        </div>

        {message ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {loading ? (
            <div className="flex min-h-[560px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-600">
              Cargando baraja…
            </div>
          ) : queueDone ? (
            <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Completado</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">No hay más pendientes</h3>
              <p className="mt-2 text-sm text-slate-600">Ya clasificaste todos los productos pendientes de esta cola.</p>
            </div>
          ) : activeItem ? (
            <>
              <div className="relative mx-auto mt-2 h-[560px] w-full max-w-[360px]">
                {previewItems[1] ? (
                  <div className="absolute inset-x-8 top-10 h-[480px] rounded-3xl border border-slate-200 bg-slate-100/60 shadow-inner" />
                ) : null}
                {previewItems[0] ? (
                  <div className="absolute inset-x-5 top-6 h-[500px] rounded-3xl border border-slate-200 bg-slate-100/80 shadow-inner" />
                ) : null}

                <article
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", activeItem.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  className="absolute inset-x-0 top-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
                >
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

                  <div className="space-y-2 p-4">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">{activeItem.brandName}</p>
                    <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{activeItem.name}</h3>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
                      <p>
                        <span className="font-semibold text-slate-800">Categoría:</span> {formatShort(activeItem.category)}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Subcategoría:</span> {formatShort(activeItem.subcategory)}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Style primary:</span> {formatShort(activeItem.stylePrimary)}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Creado:</span> {formatDate(activeItem.createdAt)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <span className="font-semibold text-slate-800">Sugerido:</span>{" "}
                      {activeItem.suggestedRealStyle ? REAL_STYLE_LABELS[activeItem.suggestedRealStyle] : "Sin sugerencia"}
                      {activeItem.suggestedRealStyle && activeItem.suggestionSource ? (
                        <span className="ml-2 text-slate-500">
                          ({activeItem.suggestionSource === "style_primary" ? "stylePrimary" : "styleTags"})
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={handleSkip}
                        disabled={saving}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Saltar
                      </button>

                      {activeItem.sourceUrl ? (
                        <a
                          href={activeItem.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                        >
                          Ver fuente
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              </div>

              <p className="text-center text-xs text-slate-500">
                Atajos: teclas <span className="font-semibold text-slate-700">1–8</span> para asignar rápido.
              </p>
            </>
          ) : (
            <div className="flex min-h-[560px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-600">
              Preparando siguiente producto…
            </div>
          )}
        </div>

        <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cajas de clasificación</p>
            <p className="mt-1 text-sm text-slate-600">Arrastra la card o toca una caja para guardar inmediatamente.</p>
          </div>

          <div className="grid gap-3">
            {REAL_STYLE_OPTIONS.map((option, index) => {
              const count = summary?.byRealStyle.find((row) => row.key === option.key)?.count ?? 0;
              const suggested = activeItem?.suggestedRealStyle === option.key;
              const isDragOver = dragOverKey === option.key;

              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => void assignRealStyle(option.key)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverKey(option.key);
                  }}
                  onDragLeave={() => setDragOverKey((prev) => (prev === option.key ? null : prev))}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOverKey(null);
                    void assignRealStyle(option.key);
                  }}
                  disabled={!activeItem || saving}
                  className={classNames(
                    "w-full rounded-2xl border px-4 py-3 text-left transition disabled:opacity-50",
                    suggested
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                    isDragOver && "border-slate-900 bg-slate-100",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Caja {index + 1}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{option.label}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{option.key}</p>
                    </div>
                    <div className="text-right">
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
