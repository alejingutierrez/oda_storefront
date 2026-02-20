"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import CatalogoFiltersPanel from "@/components/CatalogoFiltersPanel";
import type { CatalogPriceBounds, CatalogPriceHistogram, CatalogPriceStats } from "@/lib/catalog-data";
import { SORT_OPTIONS } from "@/components/CatalogToolbar";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
  group?: string | null;
};

type Facets = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  colors: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
};

const INTERACTION_PENDING_TIMEOUT_MS = 4500;
const MOBILE_FILTER_LOCK_TIMEOUT_MS = 12_000;

function countActiveFilters(params: URLSearchParams) {
  let count = 0;
  let hasPrice = false;
  for (const [key, value] of params.entries()) {
    if (key === "sort" || key === "page") continue;
    if (value.trim().length === 0) continue;
    if (key === "price_min" || key === "price_max" || key === "price_range") {
      hasPrice = true;
      continue;
    }
    count += 1;
  }
  if (hasPrice) count += 1;
  return count;
}

export default function CatalogMobileDock({
  totalCount,
  brandCount,
  facets,
  subcategories,
  priceBounds,
  priceHistogram,
  priceStats,
  facetsLoading = false,
  navigationPending = false,
  paramsString,
  lockedKeys: lockedKeysList = [],
  hideSections,
}: {
  totalCount: number | null;
  brandCount?: number | null;
  facets: Facets | null;
  subcategories: FacetItem[];
  priceBounds: CatalogPriceBounds;
  priceHistogram?: CatalogPriceHistogram | null;
  priceStats?: CatalogPriceStats | null;
  facetsLoading?: boolean;
  navigationPending?: boolean;
  paramsString: string;
  lockedKeys?: string[];
  hideSections?: { gender?: boolean; category?: boolean; brand?: boolean };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [transitionPending, startTransition] = useTransition();
  const [isInteractionPending, setIsInteractionPending] = useState(false);
  const [mobileFilterLocked, setMobileFilterLocked] = useState(false);
  const pendingUnlockTimeoutRef = useRef<number | null>(null);
  const mobileLockWatchdogRef = useRef<number | null>(null);
  const mobileLockSawPendingRef = useRef(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const lockedKeysKey = lockedKeysList.join("|");
  const lockedKeys = useMemo(
    () => new Set(lockedKeysList.filter(Boolean)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lockedKeysKey],
  );
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString]);

  useEffect(() => {
    const node = dockRef.current;
    if (!node) return;

    const root = document.documentElement;
    const commit = () => {
      const height = Math.ceil(node.getBoundingClientRect().height || 0);
      if (!height) return;
      root.style.setProperty("--oda-mobile-dock-h", `${height}px`);
    };

    commit();

    const onResize = () => commit();
    window.addEventListener("resize", onResize);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onResize);
    }

    const ro = new ResizeObserver(() => commit());
    ro.observe(node);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const viewport = window.visualViewport;

    const commit = () => {
      if (!viewport) {
        root.style.setProperty("--oda-mobile-fixed-bottom-offset", "0px");
        return;
      }
      const offset = Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)));
      root.style.setProperty("--oda-mobile-fixed-bottom-offset", `${offset}px`);
    };

    commit();

    viewport?.addEventListener("resize", commit);
    viewport?.addEventListener("scroll", commit);
    window.addEventListener("resize", commit);
    window.addEventListener("orientationchange", commit);

    return () => {
      viewport?.removeEventListener("resize", commit);
      viewport?.removeEventListener("scroll", commit);
      window.removeEventListener("resize", commit);
      window.removeEventListener("orientationchange", commit);
    };
  }, []);

  const sort = params.get("sort") ?? "new";
  const hasFilters = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("sort");
    next.delete("page");
    for (const key of lockedKeys) next.delete(key);
    return next.toString().length > 0;
  }, [lockedKeys, params]);
  const filterCount = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    for (const key of lockedKeys) next.delete(key);
    return countActiveFilters(next);
  }, [lockedKeys, params]);

  const [open, setOpen] = useState(false);
  const [draftParamsString, setDraftParamsString] = useState("");

  const releaseInteractionLock = useCallback(() => {
    if (pendingUnlockTimeoutRef.current !== null) {
      window.clearTimeout(pendingUnlockTimeoutRef.current);
      pendingUnlockTimeoutRef.current = null;
    }
    setIsInteractionPending(false);
  }, []);

  const clearMobileLockWatchdog = useCallback(() => {
    if (mobileLockWatchdogRef.current !== null) {
      window.clearTimeout(mobileLockWatchdogRef.current);
      mobileLockWatchdogRef.current = null;
    }
  }, []);

  const releaseMobileFilterLock = useCallback(() => {
    clearMobileLockWatchdog();
    mobileLockSawPendingRef.current = false;
    setMobileFilterLocked(false);
  }, [clearMobileLockWatchdog]);

  const activateMobileFilterLock = useCallback(() => {
    setMobileFilterLocked(true);
    clearMobileLockWatchdog();
    mobileLockWatchdogRef.current = window.setTimeout(() => {
      mobileLockWatchdogRef.current = null;
      mobileLockSawPendingRef.current = false;
      setMobileFilterLocked(false);
    }, MOBILE_FILTER_LOCK_TIMEOUT_MS);
  }, [clearMobileLockWatchdog]);

  useEffect(() => {
    if (!transitionPending) {
      releaseInteractionLock();
      return;
    }
    setIsInteractionPending(true);
    if (pendingUnlockTimeoutRef.current !== null) {
      window.clearTimeout(pendingUnlockTimeoutRef.current);
    }
    pendingUnlockTimeoutRef.current = window.setTimeout(() => {
      pendingUnlockTimeoutRef.current = null;
      setIsInteractionPending(false);
    }, INTERACTION_PENDING_TIMEOUT_MS);
  }, [releaseInteractionLock, transitionPending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => releaseInteractionLock();
    const onVis = () => {
      if (!document.hidden) releaseInteractionLock();
    };
    const onPageShow = () => releaseInteractionLock();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [releaseInteractionLock]);

  useEffect(() => {
    return () => {
      if (pendingUnlockTimeoutRef.current !== null) {
        window.clearTimeout(pendingUnlockTimeoutRef.current);
      }
      clearMobileLockWatchdog();
    };
  }, [clearMobileLockWatchdog]);

  const isPending = transitionPending && isInteractionPending;
  const isDockLocked = mobileFilterLocked || navigationPending || isPending;

  useEffect(() => {
    if (!mobileFilterLocked) return;

    if (navigationPending || transitionPending || isInteractionPending) {
      mobileLockSawPendingRef.current = true;
      clearMobileLockWatchdog();
      mobileLockWatchdogRef.current = window.setTimeout(() => {
        mobileLockWatchdogRef.current = null;
        mobileLockSawPendingRef.current = false;
        setMobileFilterLocked(false);
      }, MOBILE_FILTER_LOCK_TIMEOUT_MS);
      return;
    }

    if (!mobileLockSawPendingRef.current) return;
    releaseMobileFilterLock();
  }, [
    clearMobileLockWatchdog,
    isInteractionPending,
    mobileFilterLocked,
    navigationPending,
    releaseMobileFilterLock,
    transitionPending,
  ]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openSheet = () => {
    if (isDockLocked) return;
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    setDraftParamsString(next.toString());
    setOpen(true);
  };

  const applyDraft = () => {
    if (isDockLocked) return;
    const next = new URLSearchParams(draftParamsString);
    next.delete("page");
    const urlParams = new URLSearchParams(next.toString());
    for (const key of lockedKeys) urlParams.delete(key);
    const query = urlParams.toString();
    const currentUrlParams = new URLSearchParams(params.toString());
    for (const key of lockedKeys) currentUrlParams.delete(key);
    if (query === currentUrlParams.toString()) {
      setOpen(false);
      return;
    }

    const url = query ? `${pathname}?${query}` : pathname;
    activateMobileFilterLock();
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
    setOpen(false);

    // En mobile, al aplicar filtros queremos llevar al usuario directo a resultados.
    window.setTimeout(() => {
      const target = document.getElementById("catalog-results");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);
  };

  const clearAll = () => {
    if (isDockLocked) return;
    const current = new URLSearchParams(draftParamsString);
    const kept = new URLSearchParams();
    for (const key of lockedKeys) {
      const values = current.getAll(key);
      for (const value of values) kept.append(key, value);
    }
    setDraftParamsString(kept.toString());
  };

  const handleSortChange = (value: string) => {
    if (isDockLocked) return;
    const next = new URLSearchParams(params.toString());
    if (!value || value === "new") next.delete("sort");
    else next.set("sort", value);
    next.set("page", "1");
    const urlParams = new URLSearchParams(next.toString());
    for (const key of lockedKeys) urlParams.delete(key);
    const query = urlParams.toString();
    const currentUrlParams = new URLSearchParams(params.toString());
    for (const key of lockedKeys) currentUrlParams.delete(key);
    if (query === currentUrlParams.toString()) return;

    const url = query ? `${pathname}?${query}` : pathname;
    activateMobileFilterLock();
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const handleClearCommitted = () => {
    if (isDockLocked) return;
    const currentUrlParams = new URLSearchParams(params.toString());
    for (const key of lockedKeys) currentUrlParams.delete(key);
    if (currentUrlParams.toString().length === 0) return;
    activateMobileFilterLock();
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  const selectedOption =
    SORT_OPTIONS.find((option) => option.value === sort) ??
    SORT_OPTIONS.find((option) => option.value === "new")!;

  return (
    <>
      <div
        ref={dockRef}
        className="fixed inset-x-0 bottom-[var(--oda-mobile-fixed-bottom-offset)] z-40 border-t border-[color:var(--oda-border)] bg-white/92 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 lg:hidden"
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={openSheet}
            disabled={isDockLocked}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3 text-xs font-semibold text-[color:var(--oda-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Filtrar
            {facetsLoading && !facets ? (
              <span className="rounded-full bg-[color:var(--oda-stone)] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Cargando
              </span>
            ) : null}
            {filterCount > 0 ? (
              <span className="rounded-full bg-[color:var(--oda-ink)] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)]">
                {filterCount}
              </span>
            ) : null}
          </button>

          <label className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            <span className="sr-only">Ordenar</span>
            <span className="relative inline-flex">
              <select
                value={selectedOption.value}
                onChange={(event) => handleSortChange(event.target.value)}
                aria-label="Ordenar"
                disabled={isDockLocked}
                className="h-11 min-w-[8.25rem] appearance-none rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 pr-9 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--oda-taupe)]"
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={handleClearCommitted}
            disabled={!hasFilters || isDockLocked}
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition",
              hasFilters && !isDockLocked
                ? "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)]"
                : "cursor-not-allowed border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)] opacity-70",
            ].join(" ")}
            aria-label="Limpiar filtros"
            title="Limpiar"
          >
            ×
          </button>
        </div>

        <div className="mt-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          <span>
            {typeof totalCount === "number" ? (
              `${totalCount.toLocaleString("es-CO")} productos`
            ) : (
              <span className="inline-flex h-3 w-20 rounded-full bg-[color:var(--oda-stone)]" />
            )}
          </span>
          {typeof brandCount === "number" ? (
            <span>{brandCount.toLocaleString("es-CO")} marcas</span>
          ) : (
            <span className="inline-flex h-3 w-16 rounded-full bg-[color:var(--oda-stone)]" />
          )}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar filtros"
            onClick={() => {
              if (isDockLocked) return;
              setOpen(false);
            }}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-3xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] shadow-[0_-30px_80px_rgba(23,21,19,0.30)]">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--oda-border)] bg-white px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Filtros
                </p>
                <p className="mt-1 text-sm font-semibold text-[color:var(--oda-ink)]">
                  Ajusta tu búsqueda
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isDockLocked) return;
                  setOpen(false);
                }}
                disabled={isDockLocked}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[calc(85vh-10.5rem)] overscroll-contain overflow-auto px-4 pb-6 pt-5">
              {facets ? (
                <CatalogoFiltersPanel
                  facets={facets}
                  subcategories={subcategories}
                  showSubcategoriesSection={false}
                  priceBounds={priceBounds}
                  priceHistogram={priceHistogram}
                  priceStats={priceStats}
                  mode="draft"
                  draftParamsString={draftParamsString}
                  onDraftParamsStringChange={setDraftParamsString}
                  paramsString={paramsString}
                  lockedKeys={lockedKeysList}
                  hideSections={hideSections}
                  externalPending={isDockLocked}
                />
              ) : (
                <div className="grid gap-3">
                  <p className="text-xs text-[color:var(--oda-taupe)]">
                    Cargando filtros…
                  </p>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-14 w-full rounded-2xl border border-[color:var(--oda-border)] bg-white"
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[color:var(--oda-border)] bg-white px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={!facets || isDockLocked}
                  className="rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={applyDraft}
                  disabled={isDockLocked || !facets}
                  className="rounded-full bg-[color:var(--oda-ink)] px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:opacity-70"
                >
                  {isDockLocked ? "Aplicando…" : "Aplicar"}
                </button>
              </div>
              <p className="mt-3 text-[8px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Tip: puedes seleccionar varios filtros antes de aplicar.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isDockLocked ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 backdrop-blur-[1px] lg:hidden">
          <div
            className="inline-flex items-center gap-3 rounded-full border border-white/40 bg-white/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-ink)] shadow-[0_22px_56px_rgba(23,21,19,0.24)]"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--oda-ink)] border-r-transparent" />
            Aplicando filtros…
          </div>
        </div>
      ) : null}
    </>
  );
}
