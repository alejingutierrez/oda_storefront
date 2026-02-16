"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSessionToken, useSession } from "@descope/nextjs-sdk/client";
import CatalogoFiltersPanel from "@/components/CatalogoFiltersPanel";
import CatalogMobileDock from "@/components/CatalogMobileDock";
import CatalogProductsInfinite from "@/components/CatalogProductsInfinite";
import CatalogSubcategoryChips from "@/components/CatalogSubcategoryChips";
import CatalogToolbar from "@/components/CatalogToolbar";
import type { CatalogPriceBounds, CatalogPriceInsights, CatalogProduct } from "@/lib/catalog-data";
import type { CatalogPlpContext } from "@/lib/catalog-plp";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
  group?: string | null;
};

type FacetsLite = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  colors: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
};

type FavoriteAddedDetail = {
  productId: string;
  variantId: string | null;
  productName?: string | null;
};

type UserListSummary = {
  id: string;
  name: string;
  description?: string | null;
  visibility?: string;
  _count?: { items?: number };
};

const FAVORITE_ADDED_EVENT = "oda:fav-added";
const MOBILE_COLUMNS_KEY = "oda_catalog_mobile_columns_v1";
const LEGACY_MOBILE_LAYOUT_KEY = "oda_catalog_mobile_layout_v1";

type MobileColumns = 1 | 2;

function coerceMobileColumns(input: unknown): MobileColumns {
  return input === 2 || input === "2" ? 2 : 1;
}

function readMobileColumns(): MobileColumns {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(MOBILE_COLUMNS_KEY);
    if (raw === "2") return 2;
    if (raw === "1") return 1;
  } catch {
    // ignore
  }

  // Migration path from the previous persisted shape.
  try {
    const legacyRaw = window.localStorage.getItem(LEGACY_MOBILE_LAYOUT_KEY);
    if (!legacyRaw) return 1;
    const parsed = JSON.parse(legacyRaw) as { columns?: unknown } | null;
    return coerceMobileColumns(parsed?.columns);
  } catch {
    return 1;
  }
}

function writeMobileColumns(columns: MobileColumns) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_COLUMNS_KEY, columns === 2 ? "2" : "1");
  } catch {
    // ignore
  }
}

function buildSignInHref(next: string) {
  const params = new URLSearchParams();
  params.set("next", next);
  return `/sign-in?${params.toString()}`;
}

function readSessionJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function isValidFacetsLite(input: unknown): input is FacetsLite {
  if (!input || typeof input !== "object") return false;
  const obj = input as Partial<FacetsLite>;
  const arrays = [
    obj.categories,
    obj.genders,
    obj.brands,
    obj.colors,
    obj.materials,
    obj.patterns,
  ];
  return arrays.every((value) => Array.isArray(value));
}

function isAbortError(err: unknown) {
  if (!err) return false;
  if (err instanceof DOMException) return err.name === "AbortError";
  if (err instanceof Error) return err.name === "AbortError";
  return false;
}

function normalizeSearchKey(raw: string) {
  const input = (raw ?? "").trim();
  if (!input) return "";

  const params = new URLSearchParams(input);
  const map = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const list = map.get(key) ?? [];
    list.push(cleaned);
    map.set(key, list);
  }

  const keys = Array.from(map.keys()).sort();
  const out = new URLSearchParams();
  for (const key of keys) {
    const values = map.get(key) ?? [];
    if (values.length > 1) values.sort();
    for (const value of values) out.append(key, value);
  }
  return out.toString();
}

function FiltersSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-3 w-24 rounded-full bg-[color:var(--oda-stone)]" />
            <div className="h-3 w-16 rounded-full bg-[color:var(--oda-stone)]" />
          </div>
          <div className="mt-4 grid gap-2">
            {Array.from({ length: 5 }).map((__, row) => (
              <div
                key={row}
                className="h-6 w-full rounded-lg bg-[color:var(--oda-stone)]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CatalogoClient({
  initialItems,
  totalCount,
  initialSearchParams,
  initialFacets,
  initialPriceInsights,
  initialSubcategories,
  plpContext,
}: {
  initialItems: CatalogProduct[];
  totalCount: number | null;
  initialSearchParams: string;
  initialFacets?: FacetsLite | null;
  initialPriceInsights?: CatalogPriceInsights | null;
  initialSubcategories?: FacetItem[];
  plpContext?: CatalogPlpContext | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { isAuthenticated, isSessionLoading, sessionToken } = useSession();
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [mobileColumns, setMobileColumns] = useState<MobileColumns>(1);
  const [resumeTick, setResumeTick] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("oda_catalog_filters_collapsed_v1");
      if (raw === "1") setFiltersCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const next = readMobileColumns();
    setMobileColumns(next);
    // Ensure migration persists the normalized value under the new key.
    writeMobileColumns(next);
  }, []);

  const updateMobileColumns = (columns: MobileColumns) => {
    setMobileColumns(columns);
    writeMobileColumns(columns);
  };

  const toggleFiltersCollapsed = () => {
    setFiltersCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("oda_catalog_filters_collapsed_v1", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const readToken = useCallback(() => {
    const sdkToken = getSessionToken();
    if (typeof sdkToken === "string" && sdkToken.trim().length > 0) return sdkToken.trim();
    if (typeof sessionToken === "string" && sessionToken.trim().length > 0) return sessionToken.trim();
    return null;
  }, [sessionToken]);

  const authFetch = useCallback(
    async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      const token = readToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers, credentials: "include" });
    },
    [readToken],
  );

  const [favoriteToast, setFavoriteToast] = useState<FavoriteAddedDetail | null>(null);
  const favoriteToastTimeoutRef = useRef<number | null>(null);

  const [listsOpen, setListsOpen] = useState(false);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [listsNotice, setListsNotice] = useState<string | null>(null);
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [pendingSave, setPendingSave] = useState<FavoriteAddedDetail | null>(null);
  const [savingListId, setSavingListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const listsOpenRef = useRef(listsOpen);

  useEffect(() => {
    listsOpenRef.current = listsOpen;
  }, [listsOpen]);

  // Desktop: el scroll con rueda/trackpad sobre la columna izquierda debe desplazar SOLO filtros,
  // nunca el listado de productos (incluso en Safari, donde `overscroll-behavior` puede ser inconsistente).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (filtersCollapsed) return;

    const el = document.getElementById("catalog-filters-scroll");
    if (!el) return;

    const media = window.matchMedia("(min-width: 1024px)");
    const toPixels = (event: WheelEvent) => {
      if (event.deltaMode === 1) return event.deltaY * 16; // lines → px (aprox)
      if (event.deltaMode === 2) return event.deltaY * window.innerHeight; // pages → px
      return event.deltaY; // px
    };
    const canScroll = (node: HTMLElement, deltaY: number) => {
      const max = node.scrollHeight - node.clientHeight;
      if (!Number.isFinite(max) || max <= 0) return false;
      if (deltaY > 0) return node.scrollTop < max;
      if (deltaY < 0) return node.scrollTop > 0;
      return false;
    };

    const pickScrollTarget = (target: HTMLElement, deltaY: number) => {
      const candidates: HTMLElement[] = [];
      let node: HTMLElement | null = target;
      while (node && node !== el) {
        if (node.getAttribute("data-oda-scroll-allow") === "true") {
          candidates.push(node);
        }
        node = node.parentElement;
      }
      candidates.push(el);

      for (const candidate of candidates) {
        if (canScroll(candidate, deltaY)) return candidate;
      }
      // Si nada puede scrollear en esa dirección, nos quedamos con el contenedor
      // para "tragar" el wheel y no encadenar al window/products.
      return el;
    };

    const onWheel = (event: WheelEvent) => {
      if (!media.matches) return;
      if (event.ctrlKey) return; // zoom trackpad
      const deltaY = toPixels(event);
      if (!deltaY) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;

      event.preventDefault();
      const node = pickScrollTarget(target, deltaY);
      node.scrollTop += deltaY;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [filtersCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (filtersCollapsed) return;

    const wrapper = document.getElementById("catalog-scroll-zones");
    const filtersEl = document.getElementById("catalog-filters-scroll");
    if (!wrapper || !filtersEl) return;

    const media = window.matchMedia("(min-width: 1024px)");
    const toPixels = (event: WheelEvent) => {
      if (event.deltaMode === 1) return event.deltaY * 16; // lines → px (aprox)
      if (event.deltaMode === 2) return event.deltaY * window.innerHeight; // pages → px
      return event.deltaY; // px
    };

    const onWheel = (event: WheelEvent) => {
      if (!media.matches) return;
      if (event.ctrlKey) return;
      if (document.body.style.overflow === "hidden") return;

      const target = event.target as HTMLElement | null;
      if (target && filtersEl.contains(target)) return; // ya lo maneja el handler del panel

      const deltaY = toPixels(event);
      if (!deltaY) return;

      const rect = filtersEl.getBoundingClientRect();
      if (!(event.clientX <= rect.right)) return;

      event.preventDefault();
      filtersEl.scrollTop += deltaY;
    };

    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      wrapper.removeEventListener("wheel", onWheel);
    };
  }, [filtersCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");

    const normalizeDetail = (detail: unknown): FavoriteAddedDetail | null => {
      if (!detail || typeof detail !== "object") return null;
      const obj = detail as Partial<FavoriteAddedDetail>;
      if (typeof obj.productId !== "string" || obj.productId.trim().length === 0) return null;
      const variantId = typeof obj.variantId === "string" && obj.variantId.trim().length > 0 ? obj.variantId.trim() : null;
      const productName =
        typeof obj.productName === "string" && obj.productName.trim().length > 0 ? obj.productName.trim() : null;
      return { productId: obj.productId.trim(), variantId, productName };
    };

    const onAdded = (event: Event) => {
      if (!media.matches) return;
      const detail = normalizeDetail((event as CustomEvent).detail);
      if (!detail) return;

      setPendingSave(detail);
      setListsNotice(null);

      if (listsOpenRef.current) return;

      setFavoriteToast(detail);
      if (favoriteToastTimeoutRef.current) {
        window.clearTimeout(favoriteToastTimeoutRef.current);
      }
      favoriteToastTimeoutRef.current = window.setTimeout(() => {
        favoriteToastTimeoutRef.current = null;
        setFavoriteToast(null);
      }, 6000);
    };

    window.addEventListener(FAVORITE_ADDED_EVENT, onAdded as EventListener);
    return () => {
      window.removeEventListener(FAVORITE_ADDED_EVENT, onAdded as EventListener);
      if (favoriteToastTimeoutRef.current) {
        window.clearTimeout(favoriteToastTimeoutRef.current);
        favoriteToastTimeoutRef.current = null;
      }
    };
  }, []);

  const lockedKeysKey = (plpContext?.lockedKeys ?? []).join("|");
  const lockedParamsString = plpContext?.lockedParams ?? "";
  const lockedParams = useMemo(() => new URLSearchParams(lockedParamsString), [lockedParamsString]);
  const lockedKeys = useMemo(
    () => new Set((plpContext?.lockedKeys ?? []).filter(Boolean)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lockedKeysKey],
  );
  const effectiveParamsString = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    // El path manda sobre estos filtros: ignoramos overrides en query.
    for (const key of lockedKeys) next.delete(key);
    // Aplica contexto bloqueado (aunque no esté en query).
    for (const [key, value] of lockedParams.entries()) {
      next.append(key, value);
    }
    return next.toString();
  }, [lockedKeys, lockedParams, params]);

  const uiSearchKeyRaw = useMemo(() => {
    const next = new URLSearchParams(effectiveParamsString);
    next.delete("page");
    return next.toString();
  }, [effectiveParamsString]);

  const uiSearchKey = useMemo(() => normalizeSearchKey(uiSearchKeyRaw), [uiSearchKeyRaw]);
  const initialSearchKey = useMemo(
    () => normalizeSearchKey(initialSearchParams),
    [initialSearchParams],
  );

  // Cuando el usuario cambia filtros (router.replace), `useSearchParams()` se actualiza antes
  // de que lleguen los nuevos props SSR. En ese lapso, evitamos "re-key" del grid para no
  // mostrar productos antiguos bajo filtros nuevos.
  const navigationPending = uiSearchKey !== initialSearchKey;

  const totalCountFetchKey = useMemo(() => {
    const next = new URLSearchParams(effectiveParamsString);
    next.delete("page");
    next.delete("sort");
    return normalizeSearchKey(next.toString());
  }, [effectiveParamsString]);
  const totalCountSessionKey = useMemo(
    () => `oda_catalog_products_count_v1:${totalCountFetchKey || "base"}`,
    [totalCountFetchKey],
  );
  const [resolvedTotalCount, setResolvedTotalCount] = useState<number | null>(() => {
    if (typeof totalCount === "number" && Number.isFinite(totalCount) && totalCount >= 0) return totalCount;
    const cached = readSessionJson<unknown>(totalCountSessionKey);
    return typeof cached === "number" && Number.isFinite(cached) && cached >= 0 ? cached : null;
  });
  const totalCountLastOkAtRef = useRef<number>(0);
  const totalCountLastOkKeyRef = useRef<string>("");
  const totalCountAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof totalCount === "number" && Number.isFinite(totalCount) && totalCount >= 0) {
      setResolvedTotalCount(totalCount);
      writeSessionJson(totalCountSessionKey, totalCount);
      totalCountLastOkAtRef.current = Date.now();
      totalCountLastOkKeyRef.current = totalCountSessionKey;
      return;
    }

    const cached = readSessionJson<unknown>(totalCountSessionKey);
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      setResolvedTotalCount(cached);
      totalCountLastOkAtRef.current = Date.now();
      totalCountLastOkKeyRef.current = totalCountSessionKey;
    } else {
      setResolvedTotalCount(null);
    }
  }, [totalCount, totalCountSessionKey]);

  const facetsSessionKey = "oda_catalog_facets_static_v1";
  const [facets, setFacets] = useState<FacetsLite | null>(() => {
    if (isValidFacetsLite(initialFacets)) return initialFacets;
    const cached = readSessionJson<unknown>(facetsSessionKey);
    return isValidFacetsLite(cached) ? cached : null;
  });
  const [facetsLoading, setFacetsLoading] = useState(false);
  const facetsAbortRef = useRef<AbortController | null>(null);
  const facetsLastAttemptAtRef = useRef<number>(0);
  const facetsLastOkAtRef = useRef<number>(0);
  const facetsLastOkKeyRef = useRef<string>("");

  useEffect(() => {
    if (navigationPending) {
      const cached = readSessionJson<unknown>(facetsSessionKey);
      if (!isValidFacetsLite(cached)) return;
      setFacets(cached);
      facetsLastOkAtRef.current = Date.now();
      facetsLastOkKeyRef.current = facetsSessionKey;
      return;
    }

    if (isValidFacetsLite(initialFacets)) {
      setFacets(initialFacets);
      writeSessionJson(facetsSessionKey, initialFacets);
      facetsLastOkAtRef.current = Date.now();
      facetsLastOkKeyRef.current = facetsSessionKey;
      return;
    }

    const cached = readSessionJson<unknown>(facetsSessionKey);
    if (!isValidFacetsLite(cached)) return;
    setFacets(cached);
    facetsLastOkAtRef.current = Date.now();
    facetsLastOkKeyRef.current = facetsSessionKey;
  }, [facetsSessionKey, initialFacets, navigationPending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => setResumeTick((prev) => prev + 1);
    const onFocus = () => bump();
    const onVis = () => {
      if (!document.hidden) bump();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // bfcache: al volver atrás/adelante, refresh de facets/subcats/precio.
      if (event.persisted) bump();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    if (navigationPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    const isFresh =
      Boolean(facets) &&
      facetsLastOkKeyRef.current === facetsSessionKey &&
      now - facetsLastOkAtRef.current < 60_000;
    if (isFresh) return;
    // Evita loops si focus/visibility se disparan en ráfaga.
    if (now - facetsLastAttemptAtRef.current < 800) return;
    facetsLastAttemptAtRef.current = now;

    facetsAbortRef.current?.abort();
    const controller = new AbortController();
    facetsAbortRef.current = controller;
    setFacetsLoading(true);

    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch("/api/catalog/facets-static", {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { facets?: FacetsLite };
        const nextFacets = payload?.facets;
        if (isValidFacetsLite(nextFacets)) {
          setFacets(nextFacets);
          writeSessionJson(facetsSessionKey, nextFacets);
          facetsLastOkAtRef.current = Date.now();
          facetsLastOkKeyRef.current = facetsSessionKey;
        } else {
          // Mantén el último estado válido.
          setFacets((prev) => prev);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        // Mantén el último estado válido: es preferible a “romper” la UI al volver a una pestaña inactiva.
        setFacets((prev) => {
          if (prev) return prev;
          const cached = readSessionJson<unknown>(facetsSessionKey);
          return isValidFacetsLite(cached) ? cached : null;
        });
      } finally {
        window.clearTimeout(watchdog);
        setFacetsLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      setFacetsLoading(false);
    };
  }, [facets, facetsSessionKey, navigationPending, resumeTick]);

  useEffect(() => {
    if (navigationPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    const isFresh =
      totalCountLastOkKeyRef.current === totalCountSessionKey &&
      now - totalCountLastOkAtRef.current < 60_000;
    if (isFresh && typeof resolvedTotalCount === "number") return;

    totalCountAbortRef.current?.abort();
    const controller = new AbortController();
    totalCountAbortRef.current = controller;

    const next = new URLSearchParams(totalCountFetchKey);
    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/catalog/products-count?${next.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { totalCount?: number };
        const nextTotal =
          typeof payload.totalCount === "number" && Number.isFinite(payload.totalCount) && payload.totalCount >= 0
            ? payload.totalCount
            : null;
        if (nextTotal !== null) {
          setResolvedTotalCount(nextTotal);
          writeSessionJson(totalCountSessionKey, nextTotal);
          totalCountLastOkAtRef.current = Date.now();
          totalCountLastOkKeyRef.current = totalCountSessionKey;
        }
      } catch (err) {
        if (isAbortError(err)) return;
        // Mantén el último estado válido si existe.
        setResolvedTotalCount((prev) => prev);
      } finally {
        window.clearTimeout(watchdog);
      }
    }, 140);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [navigationPending, resumeTick, resolvedTotalCount, totalCountFetchKey, totalCountSessionKey]);

  const closeListsDrawer = useCallback(() => {
    setListsOpen(false);
    setListsError(null);
    setListsNotice(null);
    setSavingListId(null);
    setCreatingList(false);
  }, []);

  const openListsDrawer = useCallback(() => {
    setFavoriteToast(null);
    setListsOpen(true);
  }, []);

  const loadLists = useCallback(async (): Promise<UserListSummary[] | null> => {
    if (isSessionLoading) return null;
    if (!isAuthenticated) return null;

    const token = readToken();
    if (!token) return null;

    const res = await authFetch("/api/user/lists");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = (await res.json()) as { lists?: UserListSummary[] };
    return Array.isArray(data.lists) ? data.lists : [];
  }, [authFetch, isAuthenticated, isSessionLoading, readToken]);

  useEffect(() => {
    if (!listsOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeListsDrawer();
    };

    window.addEventListener("keydown", onKeyDown);

    setListsNotice(null);
    setListsError(null);
    setListsLoading(true);

    const controller = new AbortController();
    void (async () => {
      try {
        const next = await loadLists();
        if (controller.signal.aborted) return;
        if (!next) {
          closeListsDrawer();
          const nextHref =
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}${window.location.hash}`
              : "/catalogo";
          router.push(buildSignInHref(nextHref));
          return;
        }
        setLists(next);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Catalogo: fallo cargando listas", error);
        setListsError("No pudimos cargar tus listas. Reintenta.");
      } finally {
        if (!controller.signal.aborted) setListsLoading(false);
      }
    })();

    return () => {
      controller.abort();
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeListsDrawer, listsOpen, loadLists, router]);

  const saveToList = useCallback(
    async (listId: string) => {
      if (!pendingSave) return;
      if (savingListId || creatingList) return;
      setListsNotice(null);
      setListsError(null);
      setSavingListId(listId);
      try {
        const res = await authFetch(`/api/user/lists/${listId}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            productId: pendingSave.productId,
            variantId: pendingSave.variantId ?? null,
          }),
        });
        if (res.status === 401) {
          closeListsDrawer();
          const nextHref =
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}${window.location.hash}`
              : "/catalogo";
          router.push(buildSignInHref(nextHref));
          return;
        }
        if (!res.ok) throw new Error(`http_${res.status}`);
        const listName = lists.find((item) => item.id === listId)?.name ?? "lista";
        setListsNotice(`Guardado en ${listName}.`);
        const refreshed = await loadLists();
        if (refreshed) setLists(refreshed);
      } catch (error) {
        console.error("Catalogo: fallo guardando en lista", error);
        setListsError("No pudimos guardar en la lista. Reintenta.");
      } finally {
        setSavingListId(null);
      }
    },
    [authFetch, closeListsDrawer, creatingList, lists, loadLists, pendingSave, router, savingListId],
  );

  const createListAndSave = useCallback(async () => {
    if (!pendingSave) return;
    if (savingListId || creatingList) return;
    const name = newListName.trim();
    if (!name) return;
    setListsNotice(null);
    setListsError(null);
    setCreatingList(true);
    try {
      const res = await authFetch("/api/user/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 401) {
        closeListsDrawer();
        const nextHref =
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}${window.location.hash}`
            : "/catalogo";
        router.push(buildSignInHref(nextHref));
        return;
      }
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = (await res.json()) as { list?: { id?: string } };
      const listId = data.list?.id;
      if (!listId) throw new Error("missing_list_id");
      setNewListName("");
      const refreshed = await loadLists();
      if (refreshed) setLists(refreshed);
      await saveToList(listId);
    } catch (error) {
      console.error("Catalogo: fallo creando lista", error);
      setListsError("No pudimos crear la lista. Reintenta.");
    } finally {
      setCreatingList(false);
    }
  }, [
    authFetch,
    closeListsDrawer,
    creatingList,
    loadLists,
    newListName,
    pendingSave,
    router,
    saveToList,
    savingListId,
  ]);

  const activeBrandCount = useMemo(() => {
    if (!facets) return null;
    return facets.brands.filter((brand) => brand.count > 0).length;
  }, [facets]);

  const priceBounds: CatalogPriceBounds = initialPriceInsights?.bounds ?? { min: null, max: null };
  const priceHistogram = initialPriceInsights?.histogram ?? null;
  const priceStats = initialPriceInsights?.stats ?? null;
  const initialSubcats = useMemo(() => initialSubcategories ?? [], [initialSubcategories]);
  const lockedKeysList = plpContext?.lockedKeys ?? [];
  const inferredHideFilters = useMemo(() => {
    const locked = new URLSearchParams(lockedParamsString);
    return {
      gender: locked.getAll("gender").length > 0,
      category: locked.getAll("category").length > 0,
      brand: locked.getAll("brandId").length > 0,
    };
  }, [lockedParamsString]);
  const hideFilters = {
    gender: Boolean(inferredHideFilters.gender || plpContext?.hideFilters?.gender),
    category: Boolean(inferredHideFilters.category || plpContext?.hideFilters?.category),
    brand: Boolean(inferredHideFilters.brand || plpContext?.hideFilters?.brand),
  };
  const plpTitle = plpContext?.title?.trim() || "Catálogo";
  const plpSubtitle =
    typeof plpContext?.subtitle === "string" && plpContext.subtitle.trim().length > 0
      ? plpContext.subtitle.trim()
      : "Descubre marcas locales con inventario disponible.";

  const unlockedSearchKey = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    for (const key of lockedKeys) next.delete(key);
    return normalizeSearchKey(next.toString());
  }, [lockedKeys, params]);

  return (
    <section
      id="catalog-scroll-zones"
      className="pb-[calc(var(--oda-mobile-dock-h)+1.25rem)] pt-10 lg:pb-16"
    >
      <div className="oda-container">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-4xl text-[color:var(--oda-ink)]">{plpTitle}</h1>
              </div>

              <div className="lg:hidden">
                <div
                  className="inline-flex overflow-hidden rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]"
                  aria-label="Columnas"
                >
                  <button
                    type="button"
                    onClick={() => updateMobileColumns(1)}
                    className={[
                      "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--oda-cream)]",
                      mobileColumns === 1
                        ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                        : "text-[color:var(--oda-ink)]",
                    ].join(" ")}
                    aria-pressed={mobileColumns === 1}
                    title="1 por fila"
                  >
                    1
                  </button>
                  <button
                    type="button"
                    onClick={() => updateMobileColumns(2)}
                    className={[
                      "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--oda-cream)]",
                      mobileColumns === 2
                        ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                        : "text-[color:var(--oda-ink)]",
                    ].join(" ")}
                    aria-pressed={mobileColumns === 2}
                    title="2 por fila"
                  >
                    2
                  </button>
                </div>
              </div>
            </div>

            <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
              {plpSubtitle}
            </p>
          </header>

          <div
            className={[
              "grid grid-cols-1 gap-8",
              filtersCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[260px_minmax(0,1fr)]",
            ].join(" ")}
          >
            {!filtersCollapsed ? (
              <div
                id="catalog-filters-scroll"
                aria-label="Filtros"
                className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto lg:overscroll-contain lg:pr-1 lg:pb-8"
              >
                <div className="sticky top-0 z-20 bg-[color:var(--oda-cream)] pb-4">
                  <div className="flex min-h-[68px] items-center justify-between gap-3 rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      Filtros
                    </p>
                    <button
                      type="button"
                      onClick={toggleFiltersCollapsed}
                      className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                    >
                      Ocultar
                    </button>
                  </div>
                </div>
                {facets ? (
                  <CatalogoFiltersPanel
                    facets={facets}
                    subcategories={initialSubcats}
                    showSubcategoriesSection={false}
                    priceBounds={priceBounds}
                    priceHistogram={priceHistogram}
                    priceStats={priceStats}
                    paramsString={effectiveParamsString}
                    lockedKeys={lockedKeysList}
                    hideSections={hideFilters}
                  />
                ) : (
                  <FiltersSkeleton />
                )}
              </div>
            ) : null}

            <section aria-label="Resultados" className="flex min-w-0 flex-col gap-6">
              <div className="hidden lg:block">
                <CatalogToolbar
                  totalCount={resolvedTotalCount}
                  activeBrandCount={activeBrandCount}
                  searchKey={unlockedSearchKey}
                  paramsString={effectiveParamsString}
                  lockedKeys={lockedKeysList}
                  filtersCollapsed={filtersCollapsed}
                  onToggleFiltersCollapsed={toggleFiltersCollapsed}
                />
              </div>

              <CatalogSubcategoryChips
                mode="mobile"
                paramsString={effectiveParamsString}
                lockedKeys={lockedKeysList}
              />

              <CatalogProductsInfinite
                key={uiSearchKey || initialSearchKey}
                initialItems={initialItems}
                totalCount={resolvedTotalCount}
                initialSearchParams={uiSearchKey || initialSearchKey}
                navigationPending={navigationPending}
                optimisticSearchParams={uiSearchKey}
                filtersCollapsed={filtersCollapsed}
                mobileColumns={mobileColumns}
              />
            </section>
          </div>
        </div>
      </div>

      <CatalogMobileDock
        totalCount={resolvedTotalCount}
        activeBrandCount={activeBrandCount}
        facets={facets}
        subcategories={initialSubcats}
        priceBounds={priceBounds}
        priceHistogram={priceHistogram}
        priceStats={priceStats}
        facetsLoading={facetsLoading}
        paramsString={effectiveParamsString}
        lockedKeys={lockedKeysList}
        hideSections={hideFilters}
      />

      {favoriteToast ? (
        <div className="fixed bottom-24 right-6 z-[210] hidden lg:block">
          <button
            type="button"
            onClick={openListsDrawer}
            className="rounded-2xl border border-white/40 bg-white/75 px-5 py-4 text-left shadow-[0_24px_70px_rgba(23,21,19,0.16)] backdrop-blur-xl transition hover:bg-white/85"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              Agregar a una lista
            </p>
            {favoriteToast.productName ? (
              <p className="mt-2 max-w-[20rem] truncate text-sm font-semibold text-[color:var(--oda-ink)]">
                {favoriteToast.productName}
              </p>
            ) : null}
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Click para elegir
            </p>
          </button>
        </div>
      ) : null}

      {listsOpen ? (
        <div className="fixed inset-0 z-[220] hidden lg:block" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            aria-label="Cerrar listas"
            onClick={closeListsDrawer}
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-[28rem] flex-col border-l border-white/40 bg-white/70 pr-[env(safe-area-inset-right)] shadow-[0_30px_90px_rgba(23,21,19,0.35)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/30 bg-white/55 px-5 py-4 backdrop-blur-xl">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Agregar a una lista
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-[color:var(--oda-ink)]">
                  {pendingSave?.productName ?? "Producto"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeListsDrawer}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="flex-1 overflow-auto overflow-x-hidden px-5 pb-6 pt-5">
              {listsNotice ? (
                <div className="mb-4">
                  <span className="inline-flex rounded-full bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)]">
                    {listsNotice}
                  </span>
                </div>
              ) : null}

              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                Crear lista
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  placeholder="Nombre (ej: looks oficina)"
                  className="flex-1 rounded-full border border-[color:var(--oda-border)] bg-white/80 px-4 py-2 text-sm"
                  disabled={listsLoading || creatingList || Boolean(savingListId)}
                />
                <button
                  type="button"
                  onClick={() => void createListAndSave()}
                  disabled={
                    listsLoading ||
                    creatingList ||
                    Boolean(savingListId) ||
                    newListName.trim().length === 0 ||
                    !pendingSave
                  }
                  className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingList ? "Creando…" : "Crear y guardar"}
                </button>
              </div>

              <div className="mt-6 grid gap-2">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Tus listas
                </p>

                {listsError ? (
                  <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white/70 p-4">
                    <p className="text-sm text-[color:var(--oda-ink-soft)]">{listsError}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setListsLoading(true);
                        setListsError(null);
                        void loadLists()
                          .then((next) => {
                            if (next) setLists(next);
                          })
                          .catch((error) => {
                            console.error(error);
                            setListsError("No pudimos cargar tus listas. Reintenta.");
                          })
                          .finally(() => setListsLoading(false));
                      }}
                      className="mt-3 rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                    >
                      Reintentar
                    </button>
                  </div>
                ) : null}

                {listsLoading && !listsError ? (
                  <div className="grid gap-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-14 rounded-2xl border border-[color:var(--oda-border)] bg-white/55"
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                ) : null}

                {!listsLoading && !listsError && lists.length === 0 ? (
                  <p className="rounded-2xl border border-[color:var(--oda-border)] bg-white/70 p-4 text-sm text-[color:var(--oda-ink-soft)]">
                    Aún no tienes listas. Crea una arriba.
                  </p>
                ) : null}

                {!listsLoading && !listsError && lists.length > 0 ? (
                  <div className="grid gap-2">
                    {lists.map((list) => {
                      const count = list._count?.items ?? 0;
                      const busy = savingListId === list.id;
                      return (
                        <div
                          key={list.id}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-white/40 bg-white/55 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[color:var(--oda-ink)]">
                              {list.name}
                            </p>
                            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                              {count.toLocaleString("es-CO")} items
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void saveToList(list.id)}
                            disabled={
                              listsLoading ||
                              creatingList ||
                              Boolean(savingListId) ||
                              !pendingSave ||
                              busy
                            }
                            className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busy ? "Guardando…" : "Guardar"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
