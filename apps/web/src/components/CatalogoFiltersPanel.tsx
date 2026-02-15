"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogPriceBounds, CatalogPriceHistogram, CatalogPriceStats } from "@/lib/catalog-data";
import { labelizeSubcategory } from "@/lib/navigation";

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

type Props = {
  facets: Facets;
  subcategories: FacetItem[];
  showSubcategoriesSection?: boolean;
  priceBounds: CatalogPriceBounds;
  priceHistogram?: CatalogPriceHistogram | null;
  priceStats?: CatalogPriceStats | null;
  mode?: "instant" | "draft";
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

function getStep(max: number) {
  if (!Number.isFinite(max) || max <= 0) return 1000;
  if (max <= 200_000) return 1000;
  if (max <= 900_000) return 5000;
  return 10_000;
}

export default function CatalogoFiltersPanel({
  facets,
  subcategories,
  showSubcategoriesSection = true,
  priceBounds,
  priceHistogram,
  priceStats,
  mode = "instant",
  draftParamsString = "",
  onDraftParamsStringChange,
}: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [resumeTick, setResumeTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => setResumeTick((prev) => prev + 1);
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
  }, []);

  const searchParamsString = params.toString();
  const currentParamsString = mode === "draft" ? draftParamsString : searchParamsString;
  const committedFiltersKey = useMemo(() => {
    const next = new URLSearchParams(searchParamsString);
    next.delete("page");
    next.delete("sort");
    return normalizeParamsString(next.toString());
  }, [searchParamsString]);
  const draftFiltersKey = useMemo(() => {
    const next = new URLSearchParams(draftParamsString);
    next.delete("page");
    next.delete("sort");
    return normalizeParamsString(next.toString());
  }, [draftParamsString]);
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
  const priceInsightsLastOkAtRef = useRef<number>(0);
  const priceInsightsLastOkKeyRef = useRef<string>("");
  const priceInsightsSeededPropsRef = useRef<{
    bounds: CatalogPriceBounds;
    histogram: CatalogPriceHistogram | null | undefined;
    stats: CatalogPriceStats | null | undefined;
  } | null>(null);
  const [priceBoundsLoading, setPriceBoundsLoading] = useState(false);
  const priceBoundsAbortRef = useRef<AbortController | null>(null);
  const priceBoundsFetchKey = useMemo(() => {
    const source = mode === "draft" ? searchParamsString : currentParamsString;
    const next = new URLSearchParams(source);
    next.delete("page");
    next.delete("sort");
    // El slider muestra el rango disponible segun filtros, pero no debe re-contarse contra si mismo.
    next.delete("price_min");
    next.delete("price_max");
    next.delete("price_range");
    return next.toString();
  }, [currentParamsString, mode, searchParamsString]);
  const priceInsightsSessionKey = useMemo(
    () => `oda_catalog_price_insights_v1:${priceBoundsFetchKey || "base"}`,
    [priceBoundsFetchKey],
  );
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

    priceInsightsSeededPropsRef.current = {
      bounds: priceBounds,
      histogram: priceHistogram,
      stats: priceStats,
    };

    setResolvedPriceBounds(priceBounds);
    setResolvedPriceHistogram(priceHistogram ?? null);
    setResolvedPriceStats(priceStats ?? null);
    writeSessionJson(priceInsightsSessionKey, {
      bounds: priceBounds,
      histogram: priceHistogram ?? null,
      stats: priceStats ?? null,
    });

    if (typeof priceBounds.min === "number" && typeof priceBounds.max === "number") {
      priceInsightsLastOkAtRef.current = Date.now();
      priceInsightsLastOkKeyRef.current = priceInsightsSessionKey;
    }
  }, [priceBounds, priceHistogram, priceInsightsSessionKey, priceStats]);

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
    const cached = readSessionJson<unknown>(priceInsightsSessionKey);
    if (!cached || typeof cached !== "object") return;
    const obj = cached as { bounds?: unknown; histogram?: unknown; stats?: unknown };
    if (isValidPriceBounds(obj.bounds)) {
      setResolvedPriceBounds(obj.bounds);
    }
    if (obj.histogram === null) {
      setResolvedPriceHistogram(null);
    } else if (isValidPriceHistogram(obj.histogram)) {
      setResolvedPriceHistogram(obj.histogram);
    }
    if (obj.stats === null) {
      setResolvedPriceStats(null);
    } else if (isValidPriceStats(obj.stats)) {
      setResolvedPriceStats(obj.stats);
    }

    if (
      isValidPriceBounds(obj.bounds) &&
      typeof obj.bounds.min === "number" &&
      typeof obj.bounds.max === "number"
    ) {
      priceInsightsLastOkAtRef.current = Date.now();
      priceInsightsLastOkKeyRef.current = priceInsightsSessionKey;
    }
  }, [priceInsightsSessionKey]);

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
    };
  }, [isPending, resumeTick, showSubcategoriesSection, subcategoriesFetchKey, subcategoriesSessionKey]);

  useEffect(() => {
    if (isPending) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    const isFresh =
      priceInsightsLastOkKeyRef.current === priceInsightsSessionKey &&
      now - priceInsightsLastOkAtRef.current < 60_000;
    if (isFresh) return;

    priceBoundsAbortRef.current?.abort();
    const controller = new AbortController();
    priceBoundsAbortRef.current = controller;
    setPriceBoundsLoading(true);

    const next = new URLSearchParams(priceBoundsFetchKey);
    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/catalog/price-bounds?${next.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as {
          bounds?: CatalogPriceBounds;
          histogram?: CatalogPriceHistogram | null;
          stats?: CatalogPriceStats | null;
        };
        const bounds = payload?.bounds;
        const nextBounds: CatalogPriceBounds = {
          min: typeof bounds?.min === "number" ? bounds.min : null,
          max: typeof bounds?.max === "number" ? bounds.max : null,
        };
        setResolvedPriceBounds(nextBounds);

        const histogram = payload?.histogram;
        const nextHistogram =
          histogram && Array.isArray(histogram.buckets) ? histogram : null;
        setResolvedPriceHistogram(nextHistogram);

        const stats = payload?.stats;
        const nextStats = stats === null ? null : isValidPriceStats(stats) ? stats : null;
        setResolvedPriceStats(nextStats);

        writeSessionJson(priceInsightsSessionKey, {
          bounds: nextBounds,
          histogram: nextHistogram,
          stats: nextStats,
        });
        priceInsightsLastOkAtRef.current = Date.now();
        priceInsightsLastOkKeyRef.current = priceInsightsSessionKey;
      } catch (err) {
        if (isAbortError(err)) return;
        // Mantén el último estado válido (evita “romper” el filtro de precio al volver a una pestaña inactiva).
        setResolvedPriceBounds((prev) => prev);
        setResolvedPriceHistogram((prev) => prev);
        setResolvedPriceStats((prev) => prev);
      } finally {
        window.clearTimeout(watchdog);
        setPriceBoundsLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isPending, priceBoundsFetchKey, priceInsightsSessionKey, resumeTick]);

  const applyParams = (next: URLSearchParams) => {
    if (selected.sort && !next.get("sort")) {
      next.set("sort", selected.sort);
    }
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const commitParams = (next: URLSearchParams) => {
    next.delete("page");
    if (mode === "draft") {
      onDraftParamsStringChange?.(next.toString());
      return;
    }
    applyParams(next);
  };

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
    const list = query
      ? facets.brands.filter((item) => item.label.toLowerCase().includes(query))
      : facets.brands;
    return sortFacetItems(list, []);
  }, [brandSearch, facets.brands]);

  return (
    <aside className="flex flex-col gap-6">
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
          <div
            data-oda-scroll-allow="true"
            className="relative flex flex-col gap-2"
          >
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

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Precio
            {isPending || priceBoundsLoading ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </span>
            ) : null}
          </span>
        </summary>
        <PriceRange
          bounds={resolvedPriceBounds}
          histogram={resolvedPriceHistogram}
          stats={resolvedPriceStats}
          selectedMinRaw={selected.priceMin}
          selectedMaxRaw={selected.priceMax}
          selectedRangesRaw={selected.priceRanges}
          searchParamsString={currentParamsString}
          commitParams={commitParams}
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
  disabled?: boolean;
}) {
  const hasBounds = typeof bounds.min === "number" && typeof bounds.max === "number";
  const minBound = typeof bounds.min === "number" ? bounds.min : 0;
  const maxBound = typeof bounds.max === "number" ? bounds.max : 0;
  const rawStep = getStep(maxBound);
  const step = Math.max(1, Math.min(rawStep, Math.max(1, maxBound - minBound)));
  const hasRange = hasBounds && Number.isFinite(minBound) && Number.isFinite(maxBound) && maxBound > minBound;

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
    const q = (value: number) => snap(value);

    const fromHistogram = (() => {
      if (!histogram) return null;
      const buckets = Array.isArray(histogram.buckets) ? histogram.buckets : null;
      if (!buckets || buckets.length < 10) return null;

      const bucketCount = buckets.length;
      const width = range / bucketCount;
      if (!Number.isFinite(width) || width <= 0) return null;

      const weights = buckets.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
      const total = weights.reduce((acc, value) => acc + value, 0);
      if (total < 120) return null;

      const midpoints = weights.map((_, idx) => minBound + (idx + 0.5) * width);
      const W = Array.from({ length: bucketCount + 1 }, () => 0);
      const WX = Array.from({ length: bucketCount + 1 }, () => 0);
      const WX2 = Array.from({ length: bucketCount + 1 }, () => 0);

      for (let i = 0; i < bucketCount; i += 1) {
        const w = weights[i];
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

      if (uniqueCuts.length < 3) return null;
      return uniqueCuts.slice(0, 3);
    })();

    const fromStats =
      typeof stats?.p25 === "number" &&
      typeof stats?.p50 === "number" &&
      typeof stats?.p75 === "number" &&
      Number.isFinite(stats.p25) &&
      Number.isFinite(stats.p50) &&
      Number.isFinite(stats.p75) &&
      stats.p25 < stats.p50 &&
      stats.p50 < stats.p75
        ? [stats.p25, stats.p50, stats.p75].map((value) => clamp(q(value), minBound, maxBound))
        : null;

    const fallbackCuts = [
      clamp(q(minBound + range * 0.25), minBound, maxBound),
      clamp(q(minBound + range * 0.5), minBound, maxBound),
      clamp(q(minBound + range * 0.75), minBound, maxBound),
    ];

    const unique = Array.from(new Set(fromHistogram ?? fromStats ?? fallbackCuts)).filter(
      (v) => v > minBound && v < maxBound,
    );
    const cuts = [minBound, ...unique.sort((a, b) => a - b), maxBound];
    if (cuts.length < 3) return [];

    const tokenFor = (min: number | null, max: number | null) => `${min ?? ""}:${max ?? ""}`;
    const next: Array<{ id: string; label: string; min: number | null; max: number | null; token: string }> = [];
    const firstMax = cuts[1];
    next.push({
      id: "under",
      label: `Hasta ${formatCop(firstMax)}`,
      min: null,
      max: firstMax,
      token: tokenFor(null, firstMax),
    });
    for (let i = 1; i < cuts.length - 2; i += 1) {
      const from = cuts[i];
      const to = cuts[i + 1];
      next.push({
        id: `mid_${i}`,
        label: `${formatCop(from)} a ${formatCop(to)}`,
        min: from,
        max: to,
        token: tokenFor(from, to),
      });
    }
    const lastMin = cuts[cuts.length - 2];
    next.push({
      id: "over",
      label: `Desde ${formatCop(lastMin)}`,
      min: lastMin,
      max: null,
      token: tokenFor(lastMin, null),
    });

    return next.slice(0, 4);
  })();

  const histogramBars = (() => {
    if (!histogram) return null;
    if (!Array.isArray(histogram.buckets)) return null;
    if (histogram.buckets.length < 6) return null;
    const maxCount = Math.max(...histogram.buckets.map((value) => (Number.isFinite(value) ? value : 0)));
    if (!maxCount) return null;
    return histogram.buckets.map((count, index) => ({
      key: index,
      // 6px..40px (más legible sin hacer crecer la caja)
      height: 6 + Math.round((Math.max(0, count) / maxCount) * 34),
    }));
  })();

  const selectedRangeSet = new Set(selectedRangeTokens);

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

  const clearPriceFilters = () => {
    if (disabled) return;
    setActiveThumb(null);
    setDirty(false);
    const next = new URLSearchParams(searchParamsString);
    next.delete("price_min");
    next.delete("price_max");
    next.delete("price_range");
    commitParams(next);
  };

  const commitMin = (value: number) => {
    const baseMax = dirty ? maxValue : derived.max;
    if (!dirty) setDirty(true);
    const clamped = clamp(value, minBound, maxBound);
    const nextMin = Math.min(clamped, baseMax - step);
    setMinValue(nextMin);
    setMaxValue(Math.max(baseMax, nextMin + step));
  };

  const commitMax = (value: number) => {
    const baseMin = dirty ? minValue : derived.min;
    if (!dirty) setDirty(true);
    const clamped = clamp(value, minBound, maxBound);
    const nextMax = Math.max(clamped, baseMin + step);
    setMinValue(Math.min(baseMin, nextMax - step));
    setMaxValue(nextMax);
  };

  const hasAnyPriceSelection =
    hasSelectedRanges ||
    (selectedMin !== null && Number.isFinite(selectedMin) && selectedMin > minBound) ||
    (selectedMax !== null && Number.isFinite(selectedMax) && selectedMax < maxBound);

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

  return (
    <div className="mt-4 grid gap-3">
      <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
        <span className="min-w-0 truncate">
          {hasSelectedRanges
            ? `Rangos: ${selectedRangeTokens.length}`
            : `${formatCop(liveMinValue)} · ${formatCop(liveMaxValue)}`}
        </span>
        {hasAnyPriceSelection ? (
          <button
            type="button"
            onClick={clearPriceFilters}
            disabled={disabled}
            className="rounded-full border border-[color:var(--oda-border)] bg-white px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Limpiar
          </button>
        ) : null}
      </div>

      {hasSelectedRanges && selectedRangesLabel ? (
        <p className="text-xs text-[color:var(--oda-ink-soft)]">{selectedRangesLabel}</p>
      ) : null}

      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
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
                  "rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60",
                  checked
                    ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                ].join(" ")}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={clearPriceFilters}
            disabled={disabled}
            className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)] transition hover:bg-[color:var(--oda-stone)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Todos
          </button>
        </div>
      ) : null}

      <div className="relative h-10">
        {histogramBars ? (
          <div
            className="absolute inset-x-0 top-1/2 flex h-10 -translate-y-1/2 items-end gap-[2px] opacity-75"
            aria-hidden
          >
            {histogramBars.map((bar) => (
              <span
                key={bar.key}
                className="flex-1 rounded-[3px] bg-[color:var(--oda-stone)]"
                style={{ height: `${bar.height}px` }}
              />
            ))}
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
          onBlur={() => {
            if (keyboardCommitTimeoutRef.current) {
              window.clearTimeout(keyboardCommitTimeoutRef.current);
              keyboardCommitTimeoutRef.current = null;
            }
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
          onBlur={() => {
            if (keyboardCommitTimeoutRef.current) {
              window.clearTimeout(keyboardCommitTimeoutRef.current);
              keyboardCommitTimeoutRef.current = null;
            }
            commitSliderNow();
          }}
          className="oda-range oda-range--max absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 bg-transparent"
          disabled={disabled}
          style={{ zIndex: activeThumb === "max" ? 6 : activeThumb === "min" ? 5 : 5 }}
        />
      </div>

      <div className="text-xs text-[color:var(--oda-ink-soft)]">
        Rango disponible: {formatCop(minBound)} a {formatCop(maxBound)}
        {hasSelectedRanges ? (
          <span className="ml-2 text-[color:var(--oda-taupe)]">
            (mueve el slider para rango continuo)
          </span>
        ) : null}
      </div>
    </div>
  );
}
