"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogPriceBounds, CatalogPriceHistogram, CatalogPriceStats } from "@/lib/catalog-data";
import { labelizeSubcategory } from "@/lib/navigation";
import { getDynamicPriceStepCop } from "@/lib/price-display";

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
  occasions: FacetItem[];
};

type Props = {
  facets: Facets;
  subcategories: FacetItem[];
  showSubcategoriesSection?: boolean;
  priceBounds: CatalogPriceBounds;
  priceHistogram?: CatalogPriceHistogram | null;
  priceStats?: CatalogPriceStats | null;
  // Effective params (URL query + locked PLP params). If omitted, falls back to `useSearchParams()`.
  paramsString?: string;
  // Keys controlled by the PLP path. Any occurrences should be ignored in the URL query.
  lockedKeys?: string[];
  // Hide filter sections that would be redundant within a PLP (e.g. gender PLP hides Gender section).
  hideSections?: { gender?: boolean; category?: boolean; brand?: boolean };
  mode?: "instant" | "draft";
  externalPending?: boolean;
  // When `mode="draft"` and no external draft state is provided, auto-apply the draft to the URL after a debounce.
  // Used in desktop to avoid firing multiple navigations while users toggle several filters in a row.
  autoApplyDraftMs?: number;
  draftParamsString?: string;
  onDraftParamsStringChange?: (next: string) => void;
};

function buildSelectedLabel(count: number) {
  if (!count) return "";
  if (count === 1) return "1 seleccionado";
  return `${count} seleccionados`;
}

function formatCop(value: number) {
  if (!Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `COP ${value.toFixed(0)}`;
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isAbortError(err: unknown) {
  if (!err) return false;
  if (err instanceof DOMException) return err.name === "AbortError";
  if (err instanceof Error) return err.name === "AbortError";
  return false;
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

type SessionCacheEnvelope<T> = {
  value: T;
  cachedAt: number;
};

function readSessionCachedValue<T>(
  key: string,
  isValue: (input: unknown) => input is T,
): SessionCacheEnvelope<T> | null {
  const cached = readSessionJson<unknown>(key);
  if (cached === null) return null;
  if (isValue(cached)) {
    // Legacy format (raw value, sin metadata de frescura).
    return { value: cached, cachedAt: 0 };
  }
  if (!cached || typeof cached !== "object") return null;
  const obj = cached as { value?: unknown; cachedAt?: unknown };
  if (!isValue(obj.value)) return null;
  const cachedAt =
    typeof obj.cachedAt === "number" && Number.isFinite(obj.cachedAt) && obj.cachedAt > 0 ? obj.cachedAt : 0;
  return { value: obj.value, cachedAt };
}

function writeSessionCachedValue<T>(key: string, value: T) {
  writeSessionJson(key, { value, cachedAt: Date.now() } satisfies SessionCacheEnvelope<T>);
}

function isValidPriceBounds(input: unknown): input is CatalogPriceBounds {
  if (!input || typeof input !== "object") return false;
  const obj = input as { min?: unknown; max?: unknown };
  const minOk = obj.min === null || (typeof obj.min === "number" && Number.isFinite(obj.min));
  const maxOk = obj.max === null || (typeof obj.max === "number" && Number.isFinite(obj.max));
  return minOk && maxOk;
}

function isValidPriceHistogram(input: unknown): input is CatalogPriceHistogram {
  if (!input || typeof input !== "object") return false;
  const obj = input as { bucketCount?: unknown; buckets?: unknown };
  if (typeof obj.bucketCount !== "number" || !Number.isFinite(obj.bucketCount)) return false;
  if (!Array.isArray(obj.buckets)) return false;
  return obj.buckets.every((value) => typeof value === "number" && Number.isFinite(value));
}

function isRenderablePriceHistogram(input: unknown): input is CatalogPriceHistogram {
  if (!isValidPriceHistogram(input)) return false;
  if (!Array.isArray(input.buckets) || input.buckets.length < 6) return false;
  const maxCount = Math.max(...input.buckets.map((value) => (Number.isFinite(value) ? value : 0)));
  return maxCount > 0;
}

function isValidPriceStats(input: unknown): input is CatalogPriceStats {
  if (!input || typeof input !== "object") return false;
  const obj = input as Partial<CatalogPriceStats>;
  if (typeof obj.count !== "number" || !Number.isFinite(obj.count)) return false;
  if (typeof obj.min !== "number" || !Number.isFinite(obj.min)) return false;
  if (typeof obj.max !== "number" || !Number.isFinite(obj.max)) return false;
  const percentileFields = ["p02", "p25", "p50", "p75", "p98"] as const;
  return percentileFields.every((field) => {
    const value = obj[field];
    if (value === null) return true;
    return typeof value === "number" && Number.isFinite(value);
  });
}

type PriceInsightsSessionValue = {
  bounds: CatalogPriceBounds;
  histogram: CatalogPriceHistogram | null;
  stats: CatalogPriceStats | null;
};

function isValidPriceInsightsSessionValue(input: unknown): input is PriceInsightsSessionValue {
  if (!input || typeof input !== "object") return false;
  const obj = input as { bounds?: unknown; histogram?: unknown; stats?: unknown };
  if (!isValidPriceBounds(obj.bounds)) return false;
  const histogramOk = obj.histogram === null || isValidPriceHistogram(obj.histogram);
  if (!histogramOk) return false;
  const statsOk = obj.stats === null || isValidPriceStats(obj.stats);
  return statsOk;
}

function sortFacetItems(items: FacetItem[], selectedValues: string[]) {
  void selectedValues;
  return [...items].sort((a, b) => {
    const cmp = a.label.localeCompare(b.label, "es", { sensitivity: "base" });
    if (cmp !== 0) return cmp;
    return a.value.localeCompare(b.value, "es", { sensitivity: "base" });
  });
}

function normalizeParamsString(raw: string) {
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = String(hex || "").trim().toLowerCase();
  const value = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-f]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHsl(rgb: { r: number; g: number; b: number }) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    case b:
      h = (r - g) / d + 4;
      break;
  }

  return { h: h * 60, s, l };
}

function sortColorFacetItems(items: FacetItem[], selectedValues: string[]) {
  void selectedValues;

  const keyFor = (item: FacetItem) => {
    const rgb = item.swatch ? hexToRgb(item.swatch) : null;
    const hsl = rgb ? rgbToHsl(rgb) : null;
    const h = hsl ? hsl.h : 0;
    const s = hsl ? hsl.s : 0;
    const l = hsl ? hsl.l : 0;
    const neutral = !hsl || s < 0.16;
    return { neutral, h, s, l };
  };

  return [...items].sort((a, b) => {
    const ka = keyFor(a);
    const kb = keyFor(b);

    if (ka.neutral !== kb.neutral) return ka.neutral ? -1 : 1;
    if (ka.neutral && kb.neutral) {
      if (ka.l !== kb.l) return ka.l - kb.l; // negro -> blanco
      if (ka.s !== kb.s) return ka.s - kb.s;
      return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
    }

    if (ka.h !== kb.h) return ka.h - kb.h;
    if (ka.s !== kb.s) return kb.s - ka.s;
    if (ka.l !== kb.l) return kb.l - ka.l;
    return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
  });
}

function getStep(min: number, max: number) {
  return getDynamicPriceStepCop({ min, max });
}

const INTERACTION_PENDING_TIMEOUT_MS = 4500;
const PRICE_BOUNDS_FRESHNESS_MS = 60_000;
const PRICE_INSIGHTS_FULL_FRESHNESS_MS = 600_000;
const PRICE_INSIGHTS_FULL_WATCHDOG_MS = 12_000;
const PRICE_INSIGHTS_FULL_MAX_RETRIES = 2;

export default function CatalogoFiltersPanel({
  facets,
  subcategories,
  showSubcategoriesSection = true,
  priceBounds,
  priceHistogram,
  priceStats,
  paramsString,
  lockedKeys: lockedKeysList = [],
  hideSections,
  mode = "instant",
  externalPending = false,
  autoApplyDraftMs,
  draftParamsString = "",
  onDraftParamsStringChange,
}: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [transitionPending, startTransition] = useTransition();
  const [isInteractionPending, setIsInteractionPending] = useState(false);
  const pendingUnlockTimeoutRef = useRef<number | null>(null);
  const [resumeTick, setResumeTick] = useState(0);

  const releaseInteractionLock = useCallback(() => {
    if (pendingUnlockTimeoutRef.current !== null) {
      window.clearTimeout(pendingUnlockTimeoutRef.current);
      pendingUnlockTimeoutRef.current = null;
    }
    setIsInteractionPending(false);
  }, []);

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
    return () => {
      if (pendingUnlockTimeoutRef.current !== null) {
        window.clearTimeout(pendingUnlockTimeoutRef.current);
      }
    };
  }, []);

  const isPendingLocal = transitionPending && isInteractionPending;
  const isPending = isPendingLocal || externalPending;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => {
      releaseInteractionLock();
      setResumeTick((prev) => prev + 1);
    };
    const onFocus = () => bump();
    const onVis = () => {
      if (!document.hidden) bump();
    };
    const onPageShow = (event: PageTransitionEvent) => {
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
  }, [releaseInteractionLock]);

  const lockedKeysKey = lockedKeysList.join("|");
  const lockedKeys = useMemo(
    () => new Set(lockedKeysList.filter(Boolean)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lockedKeysKey],
  );
  const searchParamsString = (paramsString ?? params.toString()).trim();
  const committedParamsStringNoPage = useMemo(() => {
    const next = new URLSearchParams(searchParamsString);
    next.delete("page");
    return next.toString();
  }, [searchParamsString]);

  const usesExternalDraft = mode === "draft" && typeof onDraftParamsStringChange === "function";
  const usesInternalDraft = mode === "draft" && !usesExternalDraft;
  const [internalDraftParamsString, setInternalDraftParamsString] = useState<string>(() => committedParamsStringNoPage);

  useEffect(() => {
    if (!usesInternalDraft) return;
    setInternalDraftParamsString(committedParamsStringNoPage);
  }, [committedParamsStringNoPage, usesInternalDraft]);

  const effectiveDraftParamsString = usesInternalDraft ? internalDraftParamsString : draftParamsString;
  const currentParamsString = mode === "draft" ? effectiveDraftParamsString : searchParamsString;
  const committedFiltersKey = useMemo(() => {
    const next = new URLSearchParams(searchParamsString);
    next.delete("page");
    next.delete("sort");
    return normalizeParamsString(next.toString());
  }, [searchParamsString]);
  const draftFiltersKey = useMemo(() => {
    const next = new URLSearchParams(effectiveDraftParamsString);
    next.delete("page");
    next.delete("sort");
    return normalizeParamsString(next.toString());
  }, [effectiveDraftParamsString]);
  const allowZeroCounts = mode === "draft" && draftFiltersKey !== committedFiltersKey;

  const selected = useMemo(() => {
    const current = new URLSearchParams(currentParamsString);
    const category = current
      .getAll("category")
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    return {
      categories: category ? [category] : [],
      subcategories: current.getAll("subcategory"),
      genders: current.getAll("gender"),
      brandIds: current.getAll("brandId"),
      colors: current.getAll("color"),
      materials: current.getAll("material"),
      patterns: current.getAll("pattern"),
      occasions: current.getAll("occasion"),
      priceChange: (current.get("price_change") ?? "").trim().toLowerCase(),
      priceMin: current.get("price_min"),
      priceMax: current.get("price_max"),
      priceRanges: current.getAll("price_range"),
      sort: current.get("sort") ?? "",
    };
  }, [currentParamsString]);

  const [brandSearch, setBrandSearch] = useState("");
  const subcategoriesSeededPropsRef = useRef<FacetItem[] | null>(null);
  const [resolvedSubcategories, setResolvedSubcategories] = useState<FacetItem[]>(subcategories);
  const subcategoriesAbortRef = useRef<AbortController | null>(null);
  const subcategoriesFetchKey = useMemo(() => {
    const next = new URLSearchParams();
    const base = new URLSearchParams(currentParamsString);
    const category = base
      .getAll("category")
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    if (category) next.append("category", category);
    for (const gender of base
      .getAll("gender")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)) {
      next.append("gender", gender);
    }
    return next.toString();
  }, [currentParamsString]);
  const subcategoriesSessionKey = useMemo(
    () => `oda_catalog_subcategories_v1:${subcategoriesFetchKey || "base"}`,
    [subcategoriesFetchKey],
  );
  const [subcategoriesResolvedKey, setSubcategoriesResolvedKey] = useState<string>(() => {
    if (subcategories.length === 0) return "";
    return subcategoriesSessionKey;
  });
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false);
  const [resolvedPriceBounds, setResolvedPriceBounds] = useState<CatalogPriceBounds>(priceBounds);
  const [resolvedPriceHistogram, setResolvedPriceHistogram] = useState<CatalogPriceHistogram | null>(
    priceHistogram ?? null,
  );
  const [resolvedPriceStats, setResolvedPriceStats] = useState<CatalogPriceStats | null>(
    priceStats ?? null,
  );
  const priceBoundsLastOkAtRef = useRef<number>(0);
  const priceBoundsLastOkKeyRef = useRef<string>("");
  const priceInsightsFullLastOkAtRef = useRef<number>(0);
  const priceInsightsFullLastOkKeyRef = useRef<string>("");
  const priceInsightsSeededPropsRef = useRef<{
    bounds: CatalogPriceBounds;
    histogram: CatalogPriceHistogram | null | undefined;
    stats: CatalogPriceStats | null | undefined;
  } | null>(null);
  const [priceBoundsLoading, setPriceBoundsLoading] = useState(false);
  const [priceInsightsFullLoading, setPriceInsightsFullLoading] = useState(false);
  const priceBoundsAbortRef = useRef<AbortController | null>(null);
  const priceInsightsFullAbortRef = useRef<AbortController | null>(null);
  const priceInsightsFullIdleRef = useRef<number | null>(null);
  const priceInsightsFullTimeoutRef = useRef<number | null>(null);
  const priceInsightsMissingHistogramRetriedKeysRef = useRef<Set<string>>(new Set());
  const priceBoundsFetchKey = useMemo(() => {
    const next = new URLSearchParams(currentParamsString);
    next.delete("page");
    next.delete("sort");
    // El slider muestra el rango disponible segun filtros, pero no debe re-contarse contra si mismo.
    next.delete("price_min");
    next.delete("price_max");
    next.delete("price_range");
    return next.toString();
  }, [currentParamsString]);
  const priceBoundsSessionKey = useMemo(
    () => `oda_catalog_price_bounds_v1:${priceBoundsFetchKey || "base"}`,
    [priceBoundsFetchKey],
  );
  const priceInsightsFullSessionKey = useMemo(
    () => `oda_catalog_price_insights_full_v1:${priceBoundsFetchKey || "base"}`,
    [priceBoundsFetchKey],
  );
  const priceInsightsFullDemandedKeysRef = useRef<Set<string>>(new Set());
  const priceInsightsFullValidatedKeysRef = useRef<Set<string>>(new Set());
  const [priceInsightsFullDemandTick, setPriceInsightsFullDemandTick] = useState(0);
  const requestPriceInsightsFull = useCallback(() => {
    const alreadyDemanded = priceInsightsFullDemandedKeysRef.current.has(priceInsightsFullSessionKey);
    const alreadyValidated = priceInsightsFullValidatedKeysRef.current.has(priceInsightsFullSessionKey);
    if (alreadyDemanded && alreadyValidated) return;
    priceInsightsFullDemandedKeysRef.current.add(priceInsightsFullSessionKey);
    setPriceInsightsFullDemandTick((prev) => prev + 1);
  }, [priceInsightsFullSessionKey]);
  useEffect(() => {
    if (isPending) return;
    requestPriceInsightsFull();
  }, [isPending, requestPriceInsightsFull]);
  const brandSearchResetKey = useMemo(
    () =>
      `${selected.categories.join(",")}::${selected.genders.join(",")}::${selected.subcategories.join(",")}`,
    [selected.categories, selected.genders, selected.subcategories],
  );

  useEffect(() => {
    setBrandSearch("");
  }, [brandSearchResetKey]);

  useEffect(() => {
    if (subcategories.length === 0) return;
    if (subcategoriesSeededPropsRef.current === subcategories) return;
    subcategoriesSeededPropsRef.current = subcategories;
    setResolvedSubcategories(subcategories);
    writeSessionJson(subcategoriesSessionKey, subcategories);
    setSubcategoriesResolvedKey(subcategoriesSessionKey);
  }, [subcategories, subcategoriesSessionKey]);

  useEffect(() => {
    const prev = priceInsightsSeededPropsRef.current;
    if (prev && prev.bounds === priceBounds && prev.histogram === priceHistogram && prev.stats === priceStats) {
      return;
    }

    const canSeedBounds =
      typeof priceBounds.min === "number" &&
      typeof priceBounds.max === "number" &&
      Number.isFinite(priceBounds.min) &&
      Number.isFinite(priceBounds.max) &&
      priceBounds.max > priceBounds.min;
    if (!canSeedBounds) return;

    priceInsightsSeededPropsRef.current = {
      bounds: priceBounds,
      histogram: priceHistogram,
      stats: priceStats,
    };

    setResolvedPriceBounds(priceBounds);
    setResolvedPriceHistogram(priceHistogram ?? null);
    setResolvedPriceStats(priceStats ?? null);
    writeSessionCachedValue(priceBoundsSessionKey, priceBounds);
    writeSessionCachedValue(priceInsightsFullSessionKey, {
      bounds: priceBounds,
      histogram: priceHistogram ?? null,
      stats: priceStats ?? null,
    } satisfies PriceInsightsSessionValue);

    priceBoundsLastOkAtRef.current = Date.now();
    priceBoundsLastOkKeyRef.current = priceBoundsSessionKey;
    priceInsightsFullLastOkAtRef.current = Date.now();
    priceInsightsFullLastOkKeyRef.current = priceInsightsFullSessionKey;
  }, [priceBounds, priceBoundsSessionKey, priceHistogram, priceInsightsFullSessionKey, priceStats]);

  useEffect(() => {
    if (subcategories.length > 0) return;
    const cached = readSessionJson<unknown>(subcategoriesSessionKey);
    if (!Array.isArray(cached)) return;
    const next = cached
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = item as Partial<FacetItem>;
        return {
          value: typeof row.value === "string" ? row.value : "",
          label: typeof row.label === "string" ? row.label : "",
          count: typeof row.count === "number" && Number.isFinite(row.count) ? row.count : 0,
          swatch: typeof row.swatch === "string" ? row.swatch : null,
          group: typeof row.group === "string" ? row.group : null,
        } satisfies FacetItem;
      })
      .filter((item) => item.value && item.label);
    if (next.length > 0) {
      setResolvedSubcategories(next);
      setSubcategoriesResolvedKey(subcategoriesSessionKey);
    }
  }, [subcategories.length, subcategoriesSessionKey]);

  useEffect(() => {
    const cached = readSessionCachedValue(priceBoundsSessionKey, isValidPriceBounds);
    if (!cached) return;
    setResolvedPriceBounds(cached.value);
    if (typeof cached.value.min === "number" && typeof cached.value.max === "number") {
      priceBoundsLastOkAtRef.current = cached.cachedAt;
      priceBoundsLastOkKeyRef.current = priceBoundsSessionKey;
    }
  }, [priceBoundsSessionKey]);

  useEffect(() => {
    const cached = readSessionCachedValue(priceInsightsFullSessionKey, isValidPriceInsightsSessionValue);
    if (!cached) return;
    setResolvedPriceBounds(cached.value.bounds);
    setResolvedPriceHistogram(cached.value.histogram);
    setResolvedPriceStats(cached.value.stats);

    if (typeof cached.value.bounds.min === "number" && typeof cached.value.bounds.max === "number") {
      priceInsightsFullLastOkAtRef.current = cached.cachedAt;
      priceInsightsFullLastOkKeyRef.current = priceInsightsFullSessionKey;
    }
  }, [priceInsightsFullSessionKey]);

  useEffect(() => {
    if (isPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (!showSubcategoriesSection) return;
    const next = new URLSearchParams(subcategoriesFetchKey);
    const categories = next.getAll("category").filter((value) => value.trim().length > 0);
    if (categories.length === 0) {
      subcategoriesAbortRef.current?.abort();
      setResolvedSubcategories([]);
      setSubcategoriesResolvedKey("");
      setSubcategoriesLoading(false);
      return;
    }

    subcategoriesAbortRef.current?.abort();
    const controller = new AbortController();
    subcategoriesAbortRef.current = controller;
    setSubcategoriesLoading(true);

    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/catalog/subcategories?${next.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { items?: FacetItem[] };
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setResolvedSubcategories(items);
        writeSessionJson(subcategoriesSessionKey, items);
        setSubcategoriesResolvedKey(subcategoriesSessionKey);
      } catch (err) {
        if (isAbortError(err)) return;
        // Mantén el último estado válido (evita “parpadeo” al volver a una pestaña inactiva).
        setResolvedSubcategories((prev) => prev);
      } finally {
        window.clearTimeout(watchdog);
        setSubcategoriesLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      setSubcategoriesLoading(false);
    };
  }, [isPending, resumeTick, showSubcategoriesSection, subcategoriesFetchKey, subcategoriesSessionKey]);

  useEffect(() => {
    if (isPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    const isFresh =
      priceBoundsLastOkKeyRef.current === priceBoundsSessionKey &&
      now - priceBoundsLastOkAtRef.current < PRICE_BOUNDS_FRESHNESS_MS;
    if (isFresh) return;

    priceBoundsAbortRef.current?.abort();
    const controller = new AbortController();
    priceBoundsAbortRef.current = controller;
    setPriceBoundsLoading(true);

    const next = new URLSearchParams(priceBoundsFetchKey);
    next.set("mode", "lite");
    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/catalog/price-bounds?${next.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { bounds?: CatalogPriceBounds };
        const bounds = payload?.bounds;
        const nextBounds: CatalogPriceBounds = {
          min: typeof bounds?.min === "number" ? bounds.min : null,
          max: typeof bounds?.max === "number" ? bounds.max : null,
        };
        setResolvedPriceBounds(nextBounds);
        writeSessionCachedValue(priceBoundsSessionKey, nextBounds);
        priceBoundsLastOkAtRef.current = Date.now();
        priceBoundsLastOkKeyRef.current = priceBoundsSessionKey;
      } catch (err) {
        if (isAbortError(err)) return;
        // Mantén el último estado válido (evita “romper” el filtro de precio al volver a una pestaña inactiva).
        setResolvedPriceBounds((prev) => prev);
      } finally {
        window.clearTimeout(watchdog);
        setPriceBoundsLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      setPriceBoundsLoading(false);
    };
  }, [isPending, priceBoundsFetchKey, priceBoundsSessionKey, resumeTick]);

  useEffect(() => {
    if (isPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (!priceInsightsFullDemandedKeysRef.current.has(priceInsightsFullSessionKey)) return;
    const now = Date.now();
    const isFresh =
      priceInsightsFullLastOkKeyRef.current === priceInsightsFullSessionKey &&
      now - priceInsightsFullLastOkAtRef.current < PRICE_INSIGHTS_FULL_FRESHNESS_MS;
    const isNetworkValidated = priceInsightsFullValidatedKeysRef.current.has(priceInsightsFullSessionKey);
    const hasRenderableHistogram = isRenderablePriceHistogram(resolvedPriceHistogram);
    const missingHistogramRetriedForKey = priceInsightsMissingHistogramRetriedKeysRef.current.has(
      priceInsightsFullSessionKey,
    );
    const shouldForceMissingHistogram = !hasRenderableHistogram && !missingHistogramRetriedForKey;
    const shouldForceNetworkValidation = !isNetworkValidated && !hasRenderableHistogram;
    if (isFresh && !shouldForceMissingHistogram && !shouldForceNetworkValidation) return;
    if (shouldForceMissingHistogram) {
      priceInsightsMissingHistogramRetriedKeysRef.current.add(priceInsightsFullSessionKey);
    }

    // Cancel any pending schedule for the previous key.
    if (priceInsightsFullIdleRef.current !== null) {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(priceInsightsFullIdleRef.current);
      }
      priceInsightsFullIdleRef.current = null;
    }
    if (priceInsightsFullTimeoutRef.current !== null) {
      window.clearTimeout(priceInsightsFullTimeoutRef.current);
      priceInsightsFullTimeoutRef.current = null;
    }

    priceInsightsFullAbortRef.current?.abort();
    const controller = new AbortController();
    priceInsightsFullAbortRef.current = controller;

    const next = new URLSearchParams(priceBoundsFetchKey);
    next.set("mode", "full");

    const run = async () => {
      setPriceInsightsFullLoading(true);
      try {
        for (let attempt = 0; attempt <= PRICE_INSIGHTS_FULL_MAX_RETRIES; attempt += 1) {
          if (controller.signal.aborted) return;

          const attemptController = new AbortController();
          const abortAttempt = () => attemptController.abort();
          controller.signal.addEventListener("abort", abortAttempt, { once: true });
          const watchdog = window.setTimeout(() => attemptController.abort(), PRICE_INSIGHTS_FULL_WATCHDOG_MS);

          try {
            const res = await fetch(`/api/catalog/price-bounds?${next.toString()}`, {
              signal: attemptController.signal,
            });
            if (!res.ok) {
              throw new Error(`http_${res.status}`);
            }

            const payload = (await res.json()) as {
              bounds?: CatalogPriceBounds;
              histogram?: CatalogPriceHistogram | null;
              stats?: CatalogPriceStats | null;
            };
            const payloadBounds = payload?.bounds;
            const payloadHistogram = payload?.histogram ?? null;
            const payloadStats = payload?.stats ?? null;
            const payloadValid =
              isValidPriceBounds(payloadBounds) &&
              (payloadHistogram === null || isValidPriceHistogram(payloadHistogram)) &&
              (payloadStats === null || isValidPriceStats(payloadStats));
            if (!payloadValid) {
              throw new Error("invalid_payload");
            }

            const nextBounds: CatalogPriceBounds = {
              min: typeof payloadBounds.min === "number" ? payloadBounds.min : null,
              max: typeof payloadBounds.max === "number" ? payloadBounds.max : null,
            };
            setResolvedPriceBounds(nextBounds);

            const nextHistogram = payloadHistogram && Array.isArray(payloadHistogram.buckets) ? payloadHistogram : null;
            setResolvedPriceHistogram(nextHistogram);
            if (isRenderablePriceHistogram(nextHistogram)) {
              priceInsightsMissingHistogramRetriedKeysRef.current.delete(priceInsightsFullSessionKey);
            }

            const nextStats = payloadStats === null ? null : payloadStats;
            setResolvedPriceStats(nextStats);

            // Keep both caches in sync: `lite` can be shown immediately, `full` can be lazy.
            writeSessionCachedValue(priceBoundsSessionKey, nextBounds);
            writeSessionCachedValue(priceInsightsFullSessionKey, {
              bounds: nextBounds,
              histogram: nextHistogram,
              stats: nextStats,
            } satisfies PriceInsightsSessionValue);

            priceInsightsFullLastOkAtRef.current = Date.now();
            priceInsightsFullLastOkKeyRef.current = priceInsightsFullSessionKey;
            priceInsightsFullValidatedKeysRef.current.add(priceInsightsFullSessionKey);
            return;
          } catch (err) {
            if (isAbortError(err) && controller.signal.aborted) return;
            if (attempt >= PRICE_INSIGHTS_FULL_MAX_RETRIES) {
              throw err;
            }

            await new Promise<void>((resolve) => {
              if (controller.signal.aborted) {
                resolve();
                return;
              }
              let timeoutId = 0;
              const onAbort = () => {
                window.clearTimeout(timeoutId);
                controller.signal.removeEventListener("abort", onAbort);
                resolve();
              };
              timeoutId = window.setTimeout(() => {
                controller.signal.removeEventListener("abort", onAbort);
                resolve();
              }, 220 * (attempt + 1));
              controller.signal.addEventListener("abort", onAbort, { once: true });
            });
          } finally {
            window.clearTimeout(watchdog);
            controller.signal.removeEventListener("abort", abortAttempt);
          }
        }
      } catch (err) {
        if (isAbortError(err) && controller.signal.aborted) return;
        priceInsightsMissingHistogramRetriedKeysRef.current.delete(priceInsightsFullSessionKey);
        // Mantén el último estado válido (evita “romper” el filtro de precio al volver a una pestaña inactiva).
        setResolvedPriceBounds((prev) => prev);
        setResolvedPriceHistogram((prev) => prev);
        setResolvedPriceStats((prev) => prev);
      } finally {
        setPriceInsightsFullLoading(false);
      }
    };

    if (mode === "draft") {
      void run();
    } else if (typeof window.requestIdleCallback === "function") {
      priceInsightsFullIdleRef.current = window.requestIdleCallback(() => void run(), { timeout: 1200 });
    } else {
      priceInsightsFullTimeoutRef.current = window.setTimeout(() => void run(), 900);
    }

    return () => {
      if (priceInsightsFullIdleRef.current !== null) {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(priceInsightsFullIdleRef.current);
        }
        priceInsightsFullIdleRef.current = null;
      }
      if (priceInsightsFullTimeoutRef.current !== null) {
        window.clearTimeout(priceInsightsFullTimeoutRef.current);
        priceInsightsFullTimeoutRef.current = null;
      }
      controller.abort();
      setPriceInsightsFullLoading(false);
    };
  }, [
    isPending,
    mode,
    priceBoundsFetchKey,
    priceBoundsSessionKey,
    priceInsightsFullDemandTick,
    priceInsightsFullSessionKey,
    resolvedPriceHistogram,
    resumeTick,
  ]);

  const applyParams = useCallback((next: URLSearchParams) => {
    if (selected.sort && !next.get("sort")) {
      next.set("sort", selected.sort);
    }
    next.set("page", "1");
    const urlParams = new URLSearchParams(next.toString());
    for (const key of lockedKeys) urlParams.delete(key);
    const query = urlParams.toString();
    const currentUrlParams = new URLSearchParams(searchParamsString);
    for (const key of lockedKeys) currentUrlParams.delete(key);
    const currentQuery = currentUrlParams.toString();
    if (normalizeParamsString(currentQuery) === normalizeParamsString(query)) return;

    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  }, [lockedKeys, pathname, router, searchParamsString, selected.sort, startTransition]);

  const commitParams = (next: URLSearchParams) => {
    next.delete("page");
    if (mode === "draft") {
      const out = next.toString();
      if (typeof onDraftParamsStringChange === "function") {
        onDraftParamsStringChange(out);
      } else {
        setInternalDraftParamsString(out);
      }
      return;
    }
    applyParams(next);
  };

  const autoApplyTimeoutRef = useRef<number | null>(null);
  const resolvedAutoApplyDraftMs = useMemo(() => {
    if (!usesInternalDraft) return null;
    if (typeof autoApplyDraftMs !== "number" || !Number.isFinite(autoApplyDraftMs)) return null;
    return Math.max(0, Math.floor(autoApplyDraftMs));
  }, [autoApplyDraftMs, usesInternalDraft]);

  useEffect(() => {
    if (resolvedAutoApplyDraftMs === null) return;
    if (isPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (draftFiltersKey === committedFiltersKey) return;

    if (autoApplyTimeoutRef.current !== null) {
      window.clearTimeout(autoApplyTimeoutRef.current);
      autoApplyTimeoutRef.current = null;
    }

    const next = new URLSearchParams(effectiveDraftParamsString);
    next.delete("page");
    autoApplyTimeoutRef.current = window.setTimeout(() => {
      autoApplyTimeoutRef.current = null;
      applyParams(next);
    }, resolvedAutoApplyDraftMs);

    return () => {
      if (autoApplyTimeoutRef.current !== null) {
        window.clearTimeout(autoApplyTimeoutRef.current);
        autoApplyTimeoutRef.current = null;
      }
    };
  }, [
    applyParams,
    committedFiltersKey,
    draftFiltersKey,
    effectiveDraftParamsString,
    isPending,
    resolvedAutoApplyDraftMs,
  ]);

  const toggleCategory = (value: string) => {
    const next = new URLSearchParams(currentParamsString);
    const currentCategory = selected.categories[0] ?? null;
    next.delete("category");
    next.delete("subcategory"); // subcategorías dependen de categoría
    if (currentCategory !== value) {
      next.append("category", value);
    }
    commitParams(next);
  };

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(currentParamsString);
    const values = next.getAll(key);
    next.delete(key);
    if (values.includes(value)) {
      values.filter((item) => item !== value).forEach((item) => next.append(key, item));
    } else {
      values.forEach((item) => next.append(key, item));
      next.append(key, value);
    }
    commitParams(next);
  };

  const togglePriceChange = (value: "down" | "up") => {
    const next = new URLSearchParams(currentParamsString);
    const current = (next.get("price_change") ?? "").trim().toLowerCase();
    next.delete("price_change");
    if (current !== value) {
      next.set("price_change", value);
    }
    commitParams(next);
  };

  const isChecked = (list: string[], value: string) => list.includes(value);
  const activeCategory = selected.categories[0] ?? null;
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  useEffect(() => {
    setCategoriesExpanded(false);
  }, [activeCategory]);

  const sortedCategories = useMemo(
    () => sortFacetItems(facets.categories, selected.categories),
    [facets.categories, selected.categories],
  );
  const visibleCategories = useMemo(() => {
    if (!activeCategory) {
      return categoriesExpanded ? sortedCategories : sortedCategories.slice(0, 10);
    }
    if (categoriesExpanded) return sortedCategories;
    const only = sortedCategories.filter((item) => item.value === activeCategory);
    return only.length > 0 ? only : sortedCategories;
  }, [activeCategory, categoriesExpanded, sortedCategories]);
  const sortedColors = useMemo(
    () => sortColorFacetItems(facets.colors, selected.colors),
    [facets.colors, selected.colors],
  );
  const subcategoriesSettled = subcategoriesResolvedKey === subcategoriesSessionKey;
  const [subcategoriesEmptyReady, setSubcategoriesEmptyReady] = useState(false);
  const injectedSelectedSubcategories = useMemo(() => {
    const normalizedSelected = Array.from(
      new Set(
        (selected.subcategories ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );
    if (normalizedSelected.length === 0) return [];

    const map = new Map(resolvedSubcategories.map((item) => [item.value, item]));
    return normalizedSelected
      .filter((value) => !map.has(value))
      .map(
        (value) =>
          ({
            value,
            label: labelizeSubcategory(value),
            count: 0,
          }) satisfies FacetItem,
      );
  }, [resolvedSubcategories, selected.subcategories]);
  const displaySubcategories = useMemo(() => {
    if (!subcategoriesSettled) return injectedSelectedSubcategories;
    if (injectedSelectedSubcategories.length === 0) return resolvedSubcategories;
    return [...resolvedSubcategories, ...injectedSelectedSubcategories];
  }, [injectedSelectedSubcategories, resolvedSubcategories, subcategoriesSettled]);
  const rawSubcategoriesEmpty =
    displaySubcategories.length === 0 && subcategoriesSettled && !subcategoriesLoading;
  useEffect(() => {
    if (!rawSubcategoriesEmpty) {
      setSubcategoriesEmptyReady(false);
      return;
    }
    setSubcategoriesEmptyReady(false);
    const timeout = window.setTimeout(() => setSubcategoriesEmptyReady(true), 500);
    return () => window.clearTimeout(timeout);
  }, [rawSubcategoriesEmpty, subcategoriesSessionKey]);
  const showSubcategoriesEmpty = rawSubcategoriesEmpty && subcategoriesEmptyReady;
  const showSubcategoriesSkeleton =
    displaySubcategories.length === 0 &&
    (subcategoriesLoading || !subcategoriesSettled || (rawSubcategoriesEmpty && !subcategoriesEmptyReady));
  const visibleBrands = useMemo(() => {
    const query = brandSearch.trim().toLowerCase();
    if (!query) return facets.brands;
    // Preserve server ordering (cnt desc) while filtering by text.
    return facets.brands.filter((item) => item.label.toLowerCase().includes(query));
  }, [brandSearch, facets.brands]);

  return (
    <aside className="flex flex-col gap-6">
      {!hideSections?.gender ? (
        <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
          <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
            <span className="flex items-center gap-3">
              Género
              {isPending ? (
                <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Actualizando…
                </span>
              ) : null}
            </span>
            <span className="text-[10px] text-[color:var(--oda-taupe)]">
              {buildSelectedLabel(selected.genders.length)}
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-2">
            {sortFacetItems(facets.genders, selected.genders).map((item) => {
              const checked = isChecked(selected.genders, item.value);
              const countDisabled = item.count === 0 && !checked;
              const disabled = isPending || (!allowZeroCounts && countDisabled);
              const faded = !disabled && allowZeroCounts && countDisabled;
              return (
                <label
                  key={item.value}
                  className={[
                    "flex items-center justify-between gap-3 text-sm",
                    disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                    faded ? "opacity-70" : "",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMulti("gender", item.value)}
                      className="h-4 w-4 accent-[color:var(--oda-ink)]"
                      disabled={disabled}
                    />
                    {item.label}
                  </span>
                </label>
              );
            })}
          </div>
        </details>
      ) : null}

      {!hideSections?.category ? (
        <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
          <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
            <span className="flex items-center gap-3">
              Categoría
              {isPending ? (
                <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Actualizando…
                </span>
              ) : null}
            </span>
            <span className="text-[10px] text-[color:var(--oda-taupe)]">
              {buildSelectedLabel(selected.categories.length)}
            </span>
          </summary>
          <div className="mt-4">
            {activeCategory && !categoriesExpanded ? (
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Categoría seleccionada
                </p>
                <button
                  type="button"
                  onClick={() => setCategoriesExpanded(true)}
                  className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                >
                  Cambiar
                </button>
              </div>
            ) : null}
            <div data-oda-scroll-allow="true" className="relative flex flex-col gap-2">
              {visibleCategories.map((item) => {
                const checked = isChecked(selected.categories, item.value);
                const countDisabled = item.count === 0 && !checked;
                const disabled = isPending || (!allowZeroCounts && countDisabled);
                const faded = !disabled && allowZeroCounts && countDisabled;
                return (
                  <label
                    key={item.value}
                    className={[
                      "flex items-center justify-between gap-3 text-sm",
                      disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                      faded ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(item.value)}
                        className="h-4 w-4 accent-[color:var(--oda-ink)]"
                        disabled={disabled}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                  </label>
                );
              })}

              {!activeCategory && sortedCategories.length > 10 ? (
                <button
                  type="button"
                  onClick={() => setCategoriesExpanded((prev) => !prev)}
                  disabled={isPending}
                  className="mt-2 inline-flex items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {categoriesExpanded ? "Ver menos" : "Ver más"}
                </button>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}

      {selected.categories.length > 0 && showSubcategoriesSection ? (
        <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
          <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
            <span className="flex items-center gap-3">
              Subcategoría
              {subcategoriesLoading || isPending ? (
                <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Actualizando…
                </span>
              ) : null}
            </span>
            <span className="text-[10px] text-[color:var(--oda-taupe)]">
              {buildSelectedLabel(selected.subcategories.length)}
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-2">
            {showSubcategoriesSkeleton ? (
              <div className="grid gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-6 w-full rounded-lg bg-[color:var(--oda-stone)]"
                  />
                ))}
              </div>
            ) : showSubcategoriesEmpty ? (
              <p className="rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-4 text-sm text-[color:var(--oda-taupe)]">
                No hay subcategorías disponibles con estos filtros.
              </p>
            ) : (
              sortFacetItems(displaySubcategories, selected.subcategories).map((item) => {
                const checked = isChecked(selected.subcategories, item.value);
                const countDisabled = item.count === 0 && !checked;
                const disabled = isPending || (!allowZeroCounts && countDisabled);
                const faded = !disabled && allowZeroCounts && countDisabled;
                return (
                  <label
                    key={item.value}
                    className={[
                      "flex items-center justify-between gap-3 text-sm",
                      disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                      faded ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMulti("subcategory", item.value)}
                        className="h-4 w-4 accent-[color:var(--oda-ink)]"
                        disabled={disabled}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </details>
      ) : null}

      {!hideSections?.brand ? (
        <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
          <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
            <span className="flex items-center gap-3">
              Marca
              {isPending ? (
                <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Actualizando…
                </span>
              ) : null}
            </span>
            <span className="text-[10px] text-[color:var(--oda-taupe)]">
              {buildSelectedLabel(selected.brandIds.length)}
            </span>
          </summary>
          <div className="mt-4 grid gap-3">
            <input
              value={brandSearch}
              onChange={(event) => setBrandSearch(event.target.value)}
              placeholder="Buscar marca…"
              className="w-full rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-sm"
              disabled={isPending}
            />
            <div data-oda-scroll-allow="true" className="max-h-64 overflow-auto pr-1">
              <div className="flex flex-col gap-2">
                {visibleBrands.map((item) => {
                  const checked = isChecked(selected.brandIds, item.value);
                  const countDisabled = item.count === 0 && !checked;
                  const disabled = isPending || (!allowZeroCounts && countDisabled);
                  const faded = !disabled && allowZeroCounts && countDisabled;
                  return (
                    <label
                      key={item.value}
                      className={[
                        "flex items-center justify-between gap-3 text-sm",
                        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                        faded ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMulti("brandId", item.value)}
                          className="h-4 w-4 accent-[color:var(--oda-ink)]"
                          disabled={disabled}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </details>
      ) : null}

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Precio
            {isPending || priceBoundsLoading || priceInsightsFullLoading ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </span>
            ) : null}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { value: "down", label: "↓ Bajó de precio" },
              { value: "up", label: "↑ Subió de precio" },
            ] as const
          ).map((option) => {
            const selectedOption = selected.priceChange === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => togglePriceChange(option.value)}
                disabled={isPending}
                aria-pressed={selectedOption}
                className={[
                  "rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60",
                  selectedOption
                    ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <PriceRange
          bounds={resolvedPriceBounds}
          histogram={resolvedPriceHistogram}
          stats={resolvedPriceStats}
          selectedMinRaw={selected.priceMin}
          selectedMaxRaw={selected.priceMax}
          selectedRangesRaw={selected.priceRanges}
          searchParamsString={currentParamsString}
          commitParams={commitParams}
          onDemandFullInsights={requestPriceInsightsFull}
          histogramLoading={priceInsightsFullLoading}
          disabled={isPending}
        />
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Color
            {isPending ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </span>
            ) : null}
          </span>
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.colors.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          {sortedColors.map((item) => {
            const checked = isChecked(selected.colors, item.value);
            const countDisabled = item.count === 0 && !checked;
            const disabled = isPending || (!allowZeroCounts && countDisabled);
            const faded = !disabled && allowZeroCounts && countDisabled;
            return (
              <label
                key={item.value}
                className={[
                  "relative",
                  disabled ? "cursor-not-allowed opacity-35" : "cursor-pointer",
                  faded ? "opacity-70" : "",
                ].join(" ")}
                title={item.label}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleMulti("color", item.value)}
                  className="peer sr-only"
                  disabled={disabled}
                />
                <span
                  className={[
                    "block h-8 w-8 rounded-[12px] border border-[color:var(--oda-border)] shadow-[0_10px_22px_rgba(23,21,19,0.10)] transition",
                    "peer-checked:ring-2 peer-checked:ring-[color:var(--oda-ink)] peer-checked:ring-inset peer-checked:shadow-[0_16px_30px_rgba(23,21,19,0.16)]",
                  ].join(" ")}
                  style={{ backgroundColor: item.swatch ?? "#fff" }}
                >
                  <span className="sr-only">{item.label}</span>
                </span>
              </label>
            );
          })}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Material
            {isPending ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </span>
            ) : null}
          </span>
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.materials.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.materials, selected.materials).map((item) => {
            const checked = isChecked(selected.materials, item.value);
            const countDisabled = item.count === 0 && !checked;
            const disabled = isPending || (!allowZeroCounts && countDisabled);
            const faded = !disabled && allowZeroCounts && countDisabled;
            return (
              <label
                key={item.value}
                className={[
                  "flex items-center justify-between gap-3 text-sm",
                  disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                  faded ? "opacity-70" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMulti("material", item.value)}
                    className="h-4 w-4 accent-[color:var(--oda-ink)]"
                    disabled={disabled}
                  />
                  {item.label}
                </span>
              </label>
            );
          })}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Patrón
            {isPending ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </span>
            ) : null}
          </span>
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.patterns.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.patterns, selected.patterns).map((item) => {
            const checked = isChecked(selected.patterns, item.value);
            const countDisabled = item.count === 0 && !checked;
            const disabled = isPending || (!allowZeroCounts && countDisabled);
            const faded = !disabled && allowZeroCounts && countDisabled;
            return (
              <label
                key={item.value}
                className={[
                  "flex items-center justify-between gap-3 text-sm",
                  disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                  faded ? "opacity-70" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMulti("pattern", item.value)}
                    className="h-4 w-4 accent-[color:var(--oda-ink)]"
                    disabled={disabled}
                  />
                  {item.label}
                </span>
              </label>
            );
          })}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Ocasión
            {isPending ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </span>
            ) : null}
          </span>
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.occasions.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.occasions, selected.occasions).map((item) => {
            const checked = isChecked(selected.occasions, item.value);
            const countDisabled = item.count === 0 && !checked;
            const disabled = isPending || (!allowZeroCounts && countDisabled);
            const faded = !disabled && allowZeroCounts && countDisabled;
            return (
              <label
                key={item.value}
                className={[
                  "flex items-center justify-between gap-3 text-sm",
                  disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                  faded ? "opacity-70" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMulti("occasion", item.value)}
                    className="h-4 w-4 accent-[color:var(--oda-ink)]"
                    disabled={disabled}
                  />
                  {item.label}
                </span>
              </label>
            );
          })}
        </div>
      </details>

      {/* Spacer: evita que el ultimo filtro quede pegado al borde inferior del scroll. */}
      <div className="h-10" aria-hidden="true" />
    </aside>
  );
}

function PriceRange({
  bounds,
  histogram,
  stats,
  selectedMinRaw,
  selectedMaxRaw,
  selectedRangesRaw,
  searchParamsString,
  commitParams,
  onDemandFullInsights,
  histogramLoading,
  disabled,
}: {
  bounds: CatalogPriceBounds;
  histogram?: CatalogPriceHistogram | null;
  stats?: CatalogPriceStats | null;
  selectedMinRaw?: string | null;
  selectedMaxRaw?: string | null;
  selectedRangesRaw?: string[];
  searchParamsString: string;
  commitParams: (next: URLSearchParams) => void;
  onDemandFullInsights?: () => void;
  histogramLoading?: boolean;
  disabled?: boolean;
}) {
  const hasBounds = typeof bounds.min === "number" && typeof bounds.max === "number";
  const rawMinBound = typeof bounds.min === "number" ? Math.round(bounds.min) : 0;
  const rawMaxBound = typeof bounds.max === "number" ? Math.round(bounds.max) : 0;
  const hasRange = hasBounds && Number.isFinite(rawMinBound) && Number.isFinite(rawMaxBound) && rawMaxBound > rawMinBound;
  const rawStep = hasRange ? getStep(rawMinBound, rawMaxBound) : 1;
  const step = hasRange ? Math.max(1, Math.min(rawStep, Math.max(1, rawMaxBound - rawMinBound))) : 1;
  const stepsInRange = hasRange ? Math.max(1, Math.ceil((rawMaxBound - rawMinBound) / step)) : 1;
  const minBound = rawMinBound;
  const maxBound = hasRange ? minBound + stepsInRange * step : rawMaxBound;

  const selectedMin = selectedMinRaw ? Number(selectedMinRaw) : null;
  const selectedMax = selectedMaxRaw ? Number(selectedMaxRaw) : null;
  const selectedRangeTokens = (selectedRangesRaw ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const hasSelectedRanges = selectedRangeTokens.length > 0;

  const snap = (value: number) => {
    if (!Number.isFinite(value)) return minBound;
    const steps = Math.round((value - minBound) / step);
    return clamp(minBound + steps * step, minBound, maxBound);
  };

  const derived = (() => {
    if (!hasRange) return { min: 0, max: 0 };
    if (hasSelectedRanges) return { min: minBound, max: maxBound };

    const nextMinRaw = selectedMin !== null && Number.isFinite(selectedMin) ? selectedMin : minBound;
    const nextMaxRaw = selectedMax !== null && Number.isFinite(selectedMax) ? selectedMax : maxBound;
    const nextMin = snap(clamp(nextMinRaw, minBound, maxBound));
    const nextMax = snap(clamp(nextMaxRaw, minBound, maxBound));
    return {
      min: Math.min(nextMin, nextMax - step),
      max: Math.max(nextMax, nextMin + step),
    };
  })();

  const [minValue, setMinValue] = useState(() => derived.min);
  const [maxValue, setMaxValue] = useState(() => derived.max);
  const [dirty, setDirty] = useState(false);
  const [activeThumb, setActiveThumb] = useState<null | "min" | "max">(null);
  const keyboardCommitTimeoutRef = useRef<number | null>(null);

  const liveMinValue = dirty ? minValue : derived.min;
  const liveMaxValue = dirty ? maxValue : derived.max;

  const commitSliderNow = () => {
    if (disabled) return;
    if (!hasRange) return;
    if (!dirty) return;

    const next = new URLSearchParams(searchParamsString);
    // Si el usuario mueve el slider, salimos del modo de rangos disjuntos.
    next.delete("price_range");

    const nextMin = snap(minValue);
    const nextMax = snap(maxValue);

    if (nextMin <= minBound) next.delete("price_min");
    else next.set("price_min", String(nextMin));

    if (nextMax >= maxBound) next.delete("price_max");
    else next.set("price_max", String(nextMax));

    commitParams(next);
    setDirty(false);
  };

  if (!hasBounds) {
    return (
      <div className="mt-4 grid gap-3">
        <div className="h-3 w-40 rounded-full bg-[color:var(--oda-stone)]" />
        <div className="h-10 w-full rounded-xl bg-[color:var(--oda-stone)]" />
        <div className="h-3 w-56 rounded-full bg-[color:var(--oda-stone)]" />
      </div>
    );
  }

  if (!hasRange) {
    return (
      <div className="mt-4 rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-4 text-sm text-[color:var(--oda-taupe)]">
        No hay suficiente variación de precio para este filtro.
      </div>
    );
  }

  const minPct = ((liveMinValue - minBound) / (maxBound - minBound)) * 100;
  const maxPct = ((liveMaxValue - minBound) / (maxBound - minBound)) * 100;

  const presets = (() => {
    const range = maxBound - minBound;
    if (!Number.isFinite(range) || range <= 0) return [];
    if (!isRenderablePriceHistogram(histogram)) return [];
    const q = (value: number) => snap(value);

    const buckets = histogram.buckets.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
    const total = buckets.reduce((acc, value) => acc + value, 0);
    if (total <= 0) return [];

    const bucketCount = buckets.length;
    const width = range / bucketCount;
    if (!Number.isFinite(width) || width <= 0) return [];

    const midpoints = buckets.map((_, idx) => minBound + (idx + 0.5) * width);
    const cumulative: number[] = [];
    let running = 0;
    for (let i = 0; i < bucketCount; i += 1) {
      running += buckets[i] ?? 0;
      cumulative.push(running);
    }

    const valueAtQuantile = (quantile: number) => {
      if (!Number.isFinite(quantile) || quantile <= 0 || quantile >= 1) return null;
      const target = total * quantile;
      for (let i = 0; i < cumulative.length; i += 1) {
        if ((cumulative[i] ?? 0) >= target) {
          return clamp(q(midpoints[i] ?? minBound), minBound, maxBound);
        }
      }
      return clamp(q(midpoints[bucketCount - 1] ?? maxBound), minBound, maxBound);
    };

    const naturalCuts = (() => {
      if (total < 80) return null;
      const W = Array.from({ length: bucketCount + 1 }, () => 0);
      const WX = Array.from({ length: bucketCount + 1 }, () => 0);
      const WX2 = Array.from({ length: bucketCount + 1 }, () => 0);

      for (let i = 0; i < bucketCount; i += 1) {
        const w = buckets[i] ?? 0;
        const x = midpoints[i];
        W[i + 1] = W[i] + w;
        WX[i + 1] = WX[i] + w * x;
        WX2[i + 1] = WX2[i] + w * x * x;
      }

      const sse = (start: number, end: number) => {
        const wt = W[end + 1] - W[start];
        if (wt <= 0) return 0;
        const wx = WX[end + 1] - WX[start];
        const wx2 = WX2[end + 1] - WX2[start];
        return wx2 - (wx * wx) / wt;
      };

      // “Natural breaks” (k=4) sobre el histograma (ponderado por frecuencia).
      const K = 4;
      if (bucketCount < K + 2) return null;

      const dp = Array.from({ length: K }, () =>
        Array.from({ length: bucketCount }, () => Number.POSITIVE_INFINITY),
      );
      const bt = Array.from({ length: K }, () => Array.from({ length: bucketCount }, () => -1));

      for (let j = 0; j < bucketCount; j += 1) {
        dp[0][j] = sse(0, j);
        bt[0][j] = 0;
      }

      for (let k = 1; k < K; k += 1) {
        for (let j = k; j < bucketCount; j += 1) {
          let best = Number.POSITIVE_INFINITY;
          let bestI = -1;
          for (let i = k; i <= j; i += 1) {
            const cost = dp[k - 1][i - 1] + sse(i, j);
            if (cost < best) {
              best = cost;
              bestI = i;
            }
          }
          dp[k][j] = best;
          bt[k][j] = bestI;
        }
      }

      if (!Number.isFinite(dp[K - 1][bucketCount - 1])) return null;

      const starts = Array.from({ length: K }, () => 0);
      let j = bucketCount - 1;
      for (let k = K - 1; k >= 0; k -= 1) {
        const i = bt[k][j];
        if (typeof i !== "number" || i < 0) return null;
        starts[k] = i;
        j = i - 1;
      }

      const rawCuts = starts
        .slice(1)
        .map((idx) => clamp(q(minBound + idx * width), minBound, maxBound));
      const uniqueCuts = Array.from(new Set(rawCuts))
        .filter((value) => value > minBound && value < maxBound)
        .sort((a, b) => a - b);

      return uniqueCuts.length > 0 ? uniqueCuts.slice(0, 3) : null;
    })();

    const quantileCuts = [0.25, 0.5, 0.75]
      .map((quantile) => valueAtQuantile(quantile))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    let boundaries = [minBound, ...(naturalCuts ?? quantileCuts), maxBound]
      .map((value) => clamp(q(value), minBound, maxBound))
      .filter((value) => Number.isFinite(value));
    boundaries = Array.from(new Set(boundaries)).sort((a, b) => a - b);
    if (boundaries[0] !== minBound) boundaries.unshift(minBound);
    if (boundaries[boundaries.length - 1] !== maxBound) boundaries.push(maxBound);

    const segmentMass = (from: number, to: number) => {
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
      let mass = 0;
      for (let i = 0; i < bucketCount; i += 1) {
        const bucketStart = minBound + i * width;
        const bucketEnd = bucketStart + width;
        if (bucketEnd <= from || bucketStart >= to) continue;
        mass += buckets[i] ?? 0;
      }
      return mass;
    };

    let segments = Array.from({ length: Math.max(0, boundaries.length - 1) }, (_, index) => {
      const from = boundaries[index] ?? minBound;
      const to = boundaries[index + 1] ?? maxBound;
      return { from, to, mass: segmentMass(from, to) };
    }).filter((segment) => segment.to > segment.from);
    if (segments.length === 0) return [];

    const mergeAt = (index: number) => {
      if (index < 0 || index >= segments.length - 1) return;
      const left = segments[index]!;
      const right = segments[index + 1]!;
      segments.splice(index, 2, {
        from: left.from,
        to: right.to,
        mass: left.mass + right.mass,
      });
    };

    while (segments.length > 1) {
      const zeroIndex = segments.findIndex((segment) => segment.mass <= 0);
      if (zeroIndex < 0) break;
      if (zeroIndex === 0) mergeAt(0);
      else mergeAt(zeroIndex - 1);
    }

    if (segments.length < 2) {
      const medianCut = valueAtQuantile(0.5);
      if (
        typeof medianCut !== "number" ||
        !Number.isFinite(medianCut) ||
        medianCut <= minBound ||
        medianCut >= maxBound
      ) {
        return [];
      }
      segments = [
        { from: minBound, to: medianCut, mass: segmentMass(minBound, medianCut) },
        { from: medianCut, to: maxBound, mass: segmentMass(medianCut, maxBound) },
      ];
      if (segments.some((segment) => segment.mass <= 0)) return [];
    }

    while (segments.length > 4) {
      let bestIndex = 0;
      let bestCombinedMass = Number.POSITIVE_INFINITY;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const combinedMass = (segments[i]?.mass ?? 0) + (segments[i + 1]?.mass ?? 0);
        if (combinedMass < bestCombinedMass) {
          bestCombinedMass = combinedMass;
          bestIndex = i;
        }
      }
      mergeAt(bestIndex);
    }
    if (segments.length < 2) return [];

    const tokenFor = (min: number | null, max: number | null) => `${min ?? ""}:${max ?? ""}`;
    const next: Array<{ id: string; label: string; min: number | null; max: number | null; token: string }> = [];

    const first = segments[0]!;
    next.push({
      id: "under",
      label: `Hasta ${formatCop(first.to)}`,
      min: null,
      max: first.to,
      token: tokenFor(null, first.to),
    });
    for (let i = 1; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      next.push({
        id: `mid_${i}`,
        label: `${formatCop(segment.from)} a ${formatCop(segment.to)}`,
        min: segment.from,
        max: segment.to,
        token: tokenFor(segment.from, segment.to),
      });
    }

    const last = segments[segments.length - 1]!;
    next.push({
      id: "over",
      label: `Desde ${formatCop(last.from)}`,
      min: last.from,
      max: null,
      token: tokenFor(last.from, null),
    });

    const seenTokens = new Set<string>();
    return next.filter((preset) => {
      if (seenTokens.has(preset.token)) return false;
      seenTokens.add(preset.token);
      return true;
    });
  })();

  const histogramBars = (() => {
    if (!isRenderablePriceHistogram(histogram)) return null;
    const maxCount = Math.max(...histogram.buckets.map((value) => (Number.isFinite(value) ? value : 0)));
    if (!maxCount) return null;
    return histogram.buckets.map((count, index) => ({
      key: index,
      // 10px..48px para que sea visible incluso en pantallas móviles con brillo bajo.
      height: 10 + Math.round((Math.max(0, count) / maxCount) * 38),
    }));
  })();

  const selectedRangeSet = new Set(selectedRangeTokens);
  const hasPriceMinFilter =
    selectedMin !== null &&
    Number.isFinite(selectedMin) &&
    snap(clamp(selectedMin, minBound, maxBound)) > minBound;
  const hasPriceMaxFilter =
    selectedMax !== null &&
    Number.isFinite(selectedMax) &&
    snap(clamp(selectedMax, minBound, maxBound)) < maxBound;
  const hasAnyPriceFilter = hasSelectedRanges || hasPriceMinFilter || hasPriceMaxFilter;
  const isAllPresetActive = !hasAnyPriceFilter;

  const resetAllPriceFilters = () => {
    if (disabled) return;
    setActiveThumb(null);
    setDirty(false);
    const next = new URLSearchParams(searchParamsString);
    next.delete("price_min");
    next.delete("price_max");
    next.delete("price_range");
    commitParams(next);
  };

  const toggleRangeToken = (token: string) => {
    if (disabled) return;
    setActiveThumb(null);
    setDirty(false);
    const next = new URLSearchParams(searchParamsString);
    const currentTokens = next
      .getAll("price_range")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const set = new Set(currentTokens);
    if (set.has(token)) set.delete(token);
    else set.add(token);

    next.delete("price_min");
    next.delete("price_max");
    next.delete("price_range");

    const ordered = Array.from(set).sort();
    for (const value of ordered) next.append("price_range", value);

    commitParams(next);
  };

  const commitMin = (value: number) => {
    onDemandFullInsights?.();
    const baseMax = dirty ? maxValue : derived.max;
    if (!dirty) setDirty(true);
    const clamped = clamp(value, minBound, maxBound);
    const nextMin = Math.min(clamped, baseMax - step);
    setMinValue(nextMin);
    setMaxValue(Math.max(baseMax, nextMin + step));
  };

  const commitMax = (value: number) => {
    onDemandFullInsights?.();
    const baseMin = dirty ? minValue : derived.min;
    if (!dirty) setDirty(true);
    const clamped = clamp(value, minBound, maxBound);
    const nextMax = Math.max(clamped, baseMin + step);
    setMinValue(Math.min(baseMin, nextMax - step));
    setMaxValue(nextMax);
  };

  const tokenLabelMap = new Map<string, string>(presets.map((preset) => [preset.token, preset.label]));

  const formatRangeToken = (token: string) => {
    const raw = String(token || "").trim();
    const parts = raw.includes(":") ? raw.split(":") : raw.includes("-") ? raw.split("-") : null;
    if (!parts || parts.length !== 2) return raw;
    const [minRaw, maxRaw] = parts;
    const minValue = minRaw.trim().length > 0 ? Number(minRaw.trim()) : null;
    const maxValue = maxRaw.trim().length > 0 ? Number(maxRaw.trim()) : null;
    const min = minValue !== null && Number.isFinite(minValue) ? minValue : null;
    const max = maxValue !== null && Number.isFinite(maxValue) ? maxValue : null;
    if (min === null && max === null) return raw;
    if (min !== null && max !== null) return `${formatCop(min)} a ${formatCop(max)}`;
    if (min !== null) return `Desde ${formatCop(min)}`;
    return `Hasta ${formatCop(max!)}`;
  };

  const selectedRangesLabel = (() => {
    if (!hasSelectedRanges) return "";
    const labels = selectedRangeTokens.map((token) => tokenLabelMap.get(token) ?? formatRangeToken(token));
    if (labels.length <= 3) return labels.join(" · ");
    return `${labels.slice(0, 3).join(" · ")} +${labels.length - 3}`;
  })();
  const activeTooltip =
    activeThumb === "min"
      ? { label: "Mínimo", value: liveMinValue, pct: minPct }
      : activeThumb === "max"
        ? { label: "Máximo", value: liveMaxValue, pct: maxPct }
        : null;
  const activeTooltipPlacement = !activeTooltip
    ? null
    : activeTooltip.pct <= 10
      ? "left"
      : activeTooltip.pct >= 90
        ? "right"
        : "center";
  const activeTooltipStyle =
    activeTooltipPlacement === "left"
      ? ({ left: "0%" } as const)
      : activeTooltipPlacement === "right"
        ? ({ right: "0%" } as const)
        : ({ left: `${activeTooltip?.pct ?? 0}%` } as const);

  return (
    <div className="mt-4 grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[color:var(--oda-border)] bg-white px-3 py-2">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Mínimo</p>
          <p className="mt-1 truncate text-sm font-semibold tabular-nums text-[color:var(--oda-ink)]">
            {formatCop(liveMinValue)}
          </p>
        </div>
        <div className="rounded-xl border border-[color:var(--oda-border)] bg-white px-3 py-2">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Máximo</p>
          <p className="mt-1 truncate text-sm font-semibold tabular-nums text-[color:var(--oda-ink)]">
            {formatCop(liveMaxValue)}
          </p>
        </div>
      </div>

      {hasSelectedRanges ? (
        <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Rangos activos: {selectedRangeTokens.length}
        </p>
      ) : null}

      {hasSelectedRanges && selectedRangesLabel ? (
        <p className="text-xs text-[color:var(--oda-ink-soft)]">{selectedRangesLabel}</p>
      ) : null}

      {presets.length > 0 || hasAnyPriceFilter ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetAllPriceFilters}
            disabled={disabled}
            aria-pressed={isAllPresetActive}
            className={[
              "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60",
              isAllPresetActive
                ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
            ].join(" ")}
          >
            Todas
          </button>
          {presets.map((preset) => {
            const checked = selectedRangeSet.has(preset.token);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => toggleRangeToken(preset.token)}
                disabled={disabled}
                aria-pressed={checked}
                className={[
                  "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60",
                  checked
                    ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                ].join(" ")}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {!presets.length && histogramLoading ? (
        <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Calculando distribución de precio...
        </p>
      ) : null}

      <div className="oda-price-range relative h-12" data-active-thumb={activeThumb ?? undefined}>
        {activeTooltip ? (
          <div
            className={[
              "pointer-events-none absolute -top-2 z-[7] -translate-y-full",
              activeTooltipPlacement === "center" ? "-translate-x-1/2" : "",
            ].join(" ")}
            style={activeTooltipStyle}
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--oda-ink)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-cream)] shadow-[0_16px_32px_rgba(23,21,19,0.22)]">
              <span className="opacity-75">{activeTooltip.label}</span>
              <span className="normal-case tracking-[0.02em]">{formatCop(activeTooltip.value)}</span>
            </span>
          </div>
        ) : null}

        {histogramBars ? (
          <div
            className="absolute inset-x-0 top-1/2 flex h-11 -translate-y-1/2 items-end gap-[2px]"
            aria-hidden
          >
            {histogramBars.map((bar) => (
              <span
                key={bar.key}
                className="flex-1 rounded-[3px] bg-[color:var(--oda-taupe)]"
                style={{ height: `${bar.height}px` }}
              />
            ))}
          </div>
        ) : null}
        {!histogramBars && histogramLoading ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
            <span className="inline-flex rounded-full border border-[color:var(--oda-border)] bg-white/95 px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Calculando distribución de precio...
            </span>
          </div>
        ) : null}

        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[color:var(--oda-stone)]" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[color:var(--oda-ink)]"
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
        />

        <input
          type="range"
          min={minBound}
          max={maxBound}
          step={step}
          value={liveMinValue}
          onChange={(event) => commitMin(Number(event.target.value))}
          onPointerDown={(event) => {
            if (disabled) return;
            if (keyboardCommitTimeoutRef.current) {
              window.clearTimeout(keyboardCommitTimeoutRef.current);
              keyboardCommitTimeoutRef.current = null;
            }
            setActiveThumb("min");
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // ignore
            }
          }}
          onPointerUp={() => {
            setActiveThumb(null);
            window.requestAnimationFrame(() => commitSliderNow());
          }}
          onPointerCancel={() => {
            setActiveThumb(null);
            window.requestAnimationFrame(() => commitSliderNow());
          }}
          onKeyUp={() => {
            if (disabled) return;
            if (keyboardCommitTimeoutRef.current) window.clearTimeout(keyboardCommitTimeoutRef.current);
            keyboardCommitTimeoutRef.current = window.setTimeout(() => {
              keyboardCommitTimeoutRef.current = null;
              commitSliderNow();
            }, 180);
          }}
          onFocus={() => {
            if (disabled) return;
            setActiveThumb("min");
          }}
          onBlur={() => {
            if (keyboardCommitTimeoutRef.current) {
              window.clearTimeout(keyboardCommitTimeoutRef.current);
              keyboardCommitTimeoutRef.current = null;
            }
            setActiveThumb(null);
            commitSliderNow();
          }}
          className="oda-range oda-range--min absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 bg-transparent"
          disabled={disabled}
          style={{ zIndex: activeThumb === "min" ? 6 : activeThumb === "max" ? 5 : 4 }}
        />
        <input
          type="range"
          min={minBound}
          max={maxBound}
          step={step}
          value={liveMaxValue}
          onChange={(event) => commitMax(Number(event.target.value))}
          onPointerDown={(event) => {
            if (disabled) return;
            if (keyboardCommitTimeoutRef.current) {
              window.clearTimeout(keyboardCommitTimeoutRef.current);
              keyboardCommitTimeoutRef.current = null;
            }
            setActiveThumb("max");
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // ignore
            }
          }}
          onPointerUp={() => {
            setActiveThumb(null);
            window.requestAnimationFrame(() => commitSliderNow());
          }}
          onPointerCancel={() => {
            setActiveThumb(null);
            window.requestAnimationFrame(() => commitSliderNow());
          }}
          onKeyUp={() => {
            if (disabled) return;
            if (keyboardCommitTimeoutRef.current) window.clearTimeout(keyboardCommitTimeoutRef.current);
            keyboardCommitTimeoutRef.current = window.setTimeout(() => {
              keyboardCommitTimeoutRef.current = null;
              commitSliderNow();
            }, 180);
          }}
          onFocus={() => {
            if (disabled) return;
            setActiveThumb("max");
          }}
          onBlur={() => {
            if (keyboardCommitTimeoutRef.current) {
              window.clearTimeout(keyboardCommitTimeoutRef.current);
              keyboardCommitTimeoutRef.current = null;
            }
            setActiveThumb(null);
            commitSliderNow();
          }}
          className="oda-range oda-range--max absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 bg-transparent"
          disabled={disabled}
          style={{ zIndex: activeThumb === "max" ? 6 : activeThumb === "min" ? 5 : 5 }}
        />
      </div>
    </div>
  );
}
