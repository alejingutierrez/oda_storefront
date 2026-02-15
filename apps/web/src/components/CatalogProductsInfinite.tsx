"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CatalogProductCard from "@/components/CatalogProductCard";
import CompareProvider from "@/components/CompareProvider";
import CompareBar from "@/components/CompareBar";
import type { CatalogProduct } from "@/lib/catalog-data";

type ApiResponse = {
  items: CatalogProduct[];
  pageSize?: number;
};

type PersistedState = {
  version: 1;
  ts: number;
  page: number;
  scrollY: number;
  items: CatalogProduct[];
};

type MobileLayoutState = {
  version: 1;
  columns: 1 | 2;
  aspect: "original" | "square";
};

const MOBILE_LAYOUT_KEY = "oda_catalog_mobile_layout_v1";
const DEFAULT_PAGE_SIZE = 24;

function readMobileLayout(): MobileLayoutState {
  if (typeof window === "undefined") return { version: 1, columns: 1, aspect: "original" };
  try {
    const raw = window.localStorage.getItem(MOBILE_LAYOUT_KEY);
    if (!raw) return { version: 1, columns: 1, aspect: "original" };
    const parsed = JSON.parse(raw) as Partial<MobileLayoutState> | null;
    if (!parsed || parsed.version !== 1) return { version: 1, columns: 1, aspect: "original" };
    const columns = parsed.columns === 2 ? 2 : 1;
    // Migration: "portrait" (4:5) ya no existe; cae a "original" (3:4).
    const aspect = parsed.aspect === "square" ? "square" : "original";
    return { version: 1, columns, aspect };
  } catch {
    return { version: 1, columns: 1, aspect: "original" };
  }
}

function writeMobileLayout(state: MobileLayoutState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_LAYOUT_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function readPersisted(key: string): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
    if (!parsed || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.items)) return null;
    if (typeof parsed.ts !== "number") return null;
    if (typeof parsed.page !== "number") return null;
    if (typeof parsed.scrollY !== "number") return null;
    return parsed as PersistedState;
  } catch {
    return null;
  }
}

function writePersisted(key: string, state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function ProductsSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div
      className={
        className ?? "grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3"
      }
      aria-label="Cargando productos"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-[color:var(--oda-border)] bg-white shadow-[0_16px_36px_rgba(23,21,19,0.08)]"
        >
          <div className="aspect-[3/4] w-full bg-[color:var(--oda-stone)]" />
          <div className="grid gap-2 p-4">
            <div className="h-3 w-24 rounded-full bg-[color:var(--oda-stone)]" />
            <div className="h-4 w-48 rounded-full bg-[color:var(--oda-stone)]" />
            <div className="h-3 w-28 rounded-full bg-[color:var(--oda-stone)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CatalogProductsInfinite({
  initialItems,
  totalCount,
  initialSearchParams,
  navigationPending = false,
  optimisticSearchParams,
  filtersCollapsed = false,
}: {
  initialItems: CatalogProduct[];
  totalCount?: number | null;
  initialSearchParams: string;
  navigationPending?: boolean;
  optimisticSearchParams?: string;
  filtersCollapsed?: boolean;
}) {
  const stateKey = useMemo(
    () => `oda_catalog_plp_state_v1:${initialSearchParams}`,
    [initialSearchParams],
  );
  const restored = useMemo(() => {
    const persisted = readPersisted(stateKey);
    if (!persisted) return null;
    // Solo restauramos estados recientes.
    if (Date.now() - persisted.ts > 1000 * 60 * 30) return null;
    // Evitamos restaurar si el shape no cuadra.
    if (!Array.isArray(persisted.items) || persisted.items.length === 0) return null;
    return persisted;
  }, [stateKey]);

  const [items, setItems] = useState<CatalogProduct[]>(() => restored?.items ?? initialItems);
  const [page, setPage] = useState(() => restored?.page ?? 1);
  const [pageSize, setPageSize] = useState(() => DEFAULT_PAGE_SIZE);
  const [hasMoreFallback, setHasMoreFallback] = useState(() => {
    const initialCount = (restored?.items ?? initialItems).length;
    return initialCount >= DEFAULT_PAGE_SIZE;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    key: string;
    items: CatalogProduct[];
    pageSize: number;
  } | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const [mobileLayout, setMobileLayout] = useState<MobileLayoutState>(() => readMobileLayout());
  useEffect(() => {
    writeMobileLayout(mobileLayout);
  }, [mobileLayout]);

  const gridClassName = useMemo(() => {
    const baseCols =
      mobileLayout.columns === 2 ? "grid-cols-2 gap-3 sm:gap-6" : "grid-cols-1 gap-4 sm:gap-6";
    const base = `grid ${baseCols} sm:grid-cols-2 md:grid-cols-3`;
    return filtersCollapsed ? `${base} lg:grid-cols-4` : `${base} lg:grid-cols-3`;
  }, [filtersCollapsed, mobileLayout.columns]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadedIdsRef = useRef(new Set((restored?.items ?? initialItems).map((item) => item.id)));
  const prefetchRef = useRef<Record<number, ApiResponse>>({});
  const scrollYRef = useRef(restored?.scrollY ?? 0);
  const persistTimeoutRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!navigationPending) {
      previewAbortRef.current?.abort();
      setPreview(null);
      return;
    }
    const key = (optimisticSearchParams ?? "").trim();
    if (key === initialSearchParams) return;
    if (preview?.key === key) return;

    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreview(null);

    const nextParams = new URLSearchParams(key);
    nextParams.delete("page");
    nextParams.set("page", "1");

    void fetch(`/api/catalog/products-page?${nextParams.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as ApiResponse;
        const nextItems = Array.isArray(data.items) ? data.items : [];
        const nextPageSize =
          typeof data.pageSize === "number" && Number.isFinite(data.pageSize) && data.pageSize > 0
            ? Math.round(data.pageSize)
            : DEFAULT_PAGE_SIZE;
        return { items: nextItems, pageSize: nextPageSize };
      })
      .then((payload) => {
        if (!payload) return;
        setPreview({ key, items: payload.items, pageSize: payload.pageSize });
        setPageSize(payload.pageSize);
      })
      .catch((err) => {
        if ((err as { name?: unknown })?.name === "AbortError") return;
      });
  }, [initialSearchParams, navigationPending, optimisticSearchParams, preview?.key]);

  useEffect(() => {
    const persisted = readPersisted(stateKey);
    const usable =
      persisted &&
      persisted.version === 1 &&
      Array.isArray(persisted.items) &&
      persisted.items.length >= initialItems.length &&
      Date.now() - persisted.ts <= 1000 * 60 * 30
        ? persisted
        : null;

    const nextItems = usable?.items ?? initialItems;
    setItems(nextItems);
    setPage(usable?.page ?? 1);
    setPageSize(DEFAULT_PAGE_SIZE);
    setHasMoreFallback(nextItems.length >= DEFAULT_PAGE_SIZE);
    setLoading(false);
    setError(null);
    loadedIdsRef.current = new Set(nextItems.map((item) => item.id));
    prefetchRef.current = {};
    scrollYRef.current = usable?.scrollY ?? 0;

    if (usable?.scrollY && typeof window !== "undefined") {
      const y = usable.scrollY;
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: y, left: 0, behavior: "auto" });
      });
    }
  }, [initialItems, initialSearchParams, stateKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (navigationPending) return;
    const onScroll = () => {
      scrollYRef.current = window.scrollY || 0;
      if (persistTimeoutRef.current) return;
      persistTimeoutRef.current = window.setTimeout(() => {
        persistTimeoutRef.current = null;
        writePersisted(stateKey, {
          version: 1,
          ts: Date.now(),
          page,
          scrollY: scrollYRef.current,
          items: items.slice(0, 360),
        });
      }, 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items, navigationPending, page, stateKey]);

  useEffect(() => {
    if (navigationPending) return;
    writePersisted(stateKey, {
      version: 1,
      ts: Date.now(),
      page,
      scrollY: scrollYRef.current,
      items: items.slice(0, 360),
    });
  }, [items, navigationPending, page, stateKey]);

  const displayItems = useMemo(() => {
    if (navigationPending) {
      if (preview && (optimisticSearchParams ?? "").trim() === preview.key) {
        return preview.items;
      }
    }
    return items;
  }, [items, navigationPending, optimisticSearchParams, preview]);

  const knownTotalCount =
    typeof totalCount === "number" && Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : null;
  const hasMore = useMemo(() => {
    if (knownTotalCount !== null) return displayItems.length < knownTotalCount;
    return hasMoreFallback;
  }, [displayItems.length, hasMoreFallback, knownTotalCount]);

  const progressPct = useMemo(() => {
    if (!knownTotalCount) return null;
    return Math.max(0, Math.min(100, (displayItems.length / knownTotalCount) * 100));
  }, [displayItems.length, knownTotalCount]);

  const loadMore = useCallback(async () => {
    if (navigationPending) return;
    if (loadingRef.current || loading || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const nextPage = page + 1;
    const prefetched = prefetchRef.current[nextPage];

    try {
      const data: ApiResponse = prefetched
        ? prefetched
        : await (async () => {
            const nextParams = new URLSearchParams(initialSearchParams);
            nextParams.delete("page");
            nextParams.set("page", String(nextPage));
            const res = await fetch(`/api/catalog/products-page?${nextParams.toString()}`);
            if (!res.ok) {
              throw new Error(`http_${res.status}`);
            }
            return (await res.json()) as ApiResponse;
          })();

      delete prefetchRef.current[nextPage];
      const nextItems = Array.isArray(data.items) ? data.items : [];
      const nextPageSize =
        typeof data.pageSize === "number" && Number.isFinite(data.pageSize) && data.pageSize > 0
          ? Math.round(data.pageSize)
          : pageSize;
      setItems((prev) => {
        const merged = [...prev];
        for (const item of nextItems) {
          if (!loadedIdsRef.current.has(item.id)) {
            loadedIdsRef.current.add(item.id);
            merged.push(item);
          }
        }
        return merged;
      });
      setPage(nextPage);
      setPageSize(nextPageSize);
      setHasMoreFallback(nextItems.length >= nextPageSize);
    } catch (err) {
      const message = err instanceof Error ? err.message : "load_failed";
      setError(message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, initialSearchParams, loading, navigationPending, page, pageSize]);

  useEffect(() => {
    if (navigationPending) return;
    if (!hasMore) return;
    if (loading) return;
    const nextPage = page + 1;
    if (prefetchRef.current[nextPage]) return;

    const nextParams = new URLSearchParams(initialSearchParams);
    nextParams.delete("page");
    nextParams.set("page", String(nextPage));

    const schedule = (fn: () => void) => {
      if (typeof window === "undefined") return;
      type RequestIdleCallbackFn = (cb: () => void, opts?: { timeout?: number }) => number;
      const ric = (window as unknown as { requestIdleCallback?: RequestIdleCallbackFn }).requestIdleCallback;
      if (ric) {
        ric(fn, { timeout: 650 });
      } else {
        window.setTimeout(fn, 140);
      }
    };

    schedule(() => {
      void fetch(`/api/catalog/products-page?${nextParams.toString()}`)
        .then(async (res) => {
          if (!res.ok) return null;
          const payload = (await res.json()) as ApiResponse;
          return payload;
        })
        .then((payload) => {
          if (!payload) return;
          prefetchRef.current[nextPage] = payload;
        })
        .catch(() => {});
    });
  }, [hasMore, initialSearchParams, loading, navigationPending, page]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore) return;
    if (navigationPending) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "1200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, navigationPending]);

  // Fallback: en algunos móviles el IntersectionObserver puede ser intermitente (targets sin alto, iOS quirks).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (navigationPending) return;
    if (!hasMore) return;

    const thresholdPx = 1200;
    let raf: number | null = null;

    const check = () => {
      raf = null;
      if (loadingRef.current) return;
      const doc = document.documentElement;
      const scrollY = window.scrollY || 0;
      const viewport = window.innerHeight || 0;
      const height = doc.scrollHeight || 0;
      if (!height) return;
      if (scrollY + viewport >= height - thresholdPx) {
        void loadMore();
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(check);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [hasMore, loadMore, navigationPending]);

  if (!navigationPending && displayItems.length === 0) {
    return (
      <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-10 text-center">
        <p className="text-lg font-semibold text-[color:var(--oda-ink)]">
          No encontramos productos con esos filtros.
        </p>
        <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
          Prueba ajustar genero, categoria o rango de precio para ampliar resultados.
        </p>
        <a
          href="/catalogo"
          className="mt-6 inline-flex rounded-full bg-[color:var(--oda-ink)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
        >
          Volver al catálogo
        </a>
      </div>
    );
  }

  return (
    <CompareProvider>
      <div className="flex flex-col gap-6">
          <div id="catalog-results" className="scroll-mt-32">
            <div className="lg:hidden">
              <div className="mb-4 rounded-2xl border border-[color:var(--oda-border)] bg-white px-4 py-3 shadow-[0_10px_22px_rgba(23,21,19,0.06)]">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      Columnas
                    </p>
                    <div className="mt-2 inline-flex overflow-hidden rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]">
                      <button
                        type="button"
                        onClick={() => setMobileLayout((prev) => ({ ...prev, columns: 1 }))}
                        className={[
                          "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition",
                          mobileLayout.columns === 1
                            ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                            : "text-[color:var(--oda-ink)]",
                        ].join(" ")}
                        aria-pressed={mobileLayout.columns === 1}
                        title="1 por fila"
                      >
                        1
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileLayout((prev) => ({ ...prev, columns: 2 }))}
                        className={[
                          "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition",
                          mobileLayout.columns === 2
                            ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                            : "text-[color:var(--oda-ink)]",
                        ].join(" ")}
                        aria-pressed={mobileLayout.columns === 2}
                        title="2 por fila"
                      >
                        2
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      Formato
                    </p>
                    <div className="mt-2 inline-flex overflow-hidden rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]">
                      <button
                        type="button"
                        onClick={() => setMobileLayout((prev) => ({ ...prev, aspect: "original" }))}
                        className={[
                          "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition",
                          mobileLayout.aspect === "original"
                            ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                            : "text-[color:var(--oda-ink)]",
                        ].join(" ")}
                        aria-pressed={mobileLayout.aspect === "original"}
                        title="Original (3:4)"
                      >
                        3:4
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileLayout((prev) => ({ ...prev, aspect: "square" }))}
                        className={[
                          "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition",
                          mobileLayout.aspect === "square"
                            ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                            : "text-[color:var(--oda-ink)]",
                        ].join(" ")}
                        aria-pressed={mobileLayout.aspect === "square"}
                        title="Cuadrado (1:1)"
                      >
                        1:1
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          {navigationPending && !preview ? (
            <div className="grid gap-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando resultados…
              </p>
              <ProductsSkeleton count={12} className={gridClassName} />
            </div>
          ) : (
            <ul className={[gridClassName, "list-none p-0 m-0"].join(" ")} aria-label="Productos">
              {displayItems.map((product) => (
                <li key={product.id}>
                  <CatalogProductCard
                    product={product}
                    mobileAspect={mobileLayout.aspect}
                    mobileCompact={mobileLayout.columns === 2}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="w-full rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Mostrando{" "}
                <span className="font-semibold text-[color:var(--oda-ink)]">
                  {displayItems.length.toLocaleString("es-CO")}
                </span>{" "}
                {knownTotalCount !== null ? (
                  <>
                    de{" "}
                    <span className="font-semibold text-[color:var(--oda-ink)]">
                      {knownTotalCount.toLocaleString("es-CO")}
                    </span>
                  </>
                ) : null}
              </p>
              {progressPct !== null ? (
                <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {Math.round(progressPct)}%
                </p>
              ) : null}
            </div>
            {progressPct !== null ? (
              <div className="mt-3 h-2 w-full rounded-full bg-[color:var(--oda-stone)]">
                <div
                  className="h-2 rounded-full bg-[color:var(--oda-ink)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            ) : (
              <div className="mt-3 h-2 w-full rounded-full bg-[color:var(--oda-stone)]" aria-hidden="true" />
            )}
          </div>

          {error ? (
            <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4 text-center">
              <p className="text-sm text-[color:var(--oda-ink-soft)]">
                No pudimos cargar más productos. Intenta de nuevo.
              </p>
              <button
                type="button"
                onClick={() => void loadMore()}
                className="mt-3 rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
              >
                Reintentar
              </button>
            </div>
          ) : null}

          {hasMore ? (
            <div className="w-full">
              <div ref={sentinelRef} className="h-px w-full" />
              <div className="mt-2 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loading || navigationPending}
                  className={[
                    "rounded-full border border-[color:var(--oda-border)] bg-white px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]",
                    loading ? "cursor-not-allowed opacity-60" : "",
                  ].join(" ")}
                >
                  {loading ? "Cargando…" : "Cargar más"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Fin del catálogo
            </p>
          )}
        </div>
      </div>

      <CompareBar />

      <ToTopButton progressPct={progressPct} />
    </CompareProvider>
  );
}

function ToTopButton({ progressPct }: { progressPct: number | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf: number | null = null;

    const check = () => {
      raf = null;
      setVisible((window.scrollY || 0) > 900);
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(check);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  if (!visible) return null;

  const canShowPct = typeof progressPct === "number" && Number.isFinite(progressPct) && progressPct > 0;

  return (
    <div className="fixed right-4 top-24 z-40 lg:bottom-6 lg:right-6 lg:top-auto">
      <div className="mb-2 hidden justify-center lg:flex">
        {canShowPct ? (
          <span className="inline-flex rounded-full border border-[color:var(--oda-border)] bg-white/92 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-ink)] shadow-[0_20px_60px_rgba(23,21,19,0.18)] backdrop-blur">
            {Math.round(progressPct)}% visto
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
          const filters = document.getElementById("catalog-filters-scroll");
          if (filters) {
            try {
              filters.scrollTo({ top: 0, left: 0, behavior: "smooth" });
            } catch {
              filters.scrollTop = 0;
            }
          }
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white/92 text-[color:var(--oda-ink)] shadow-[0_20px_60px_rgba(23,21,19,0.20)] backdrop-blur transition hover:bg-[color:var(--oda-stone)] lg:h-auto lg:w-auto lg:px-4 lg:py-3 lg:text-[10px] lg:font-semibold lg:uppercase lg:tracking-[0.22em]"
        aria-label="Volver arriba"
        title="Arriba"
      >
        <span className="text-base leading-none lg:hidden" aria-hidden="true">
          ↑
        </span>
        <span className="hidden lg:inline">Arriba</span>
      </button>
    </div>
  );
}
