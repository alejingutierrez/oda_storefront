"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogPriceBounds, CatalogPriceHistogram } from "@/lib/catalog-data";

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
  priceBounds: CatalogPriceBounds;
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

function sortFacetItems(items: FacetItem[], selectedValues: string[]) {
  const selectedSet = new Set(selectedValues);
  const orderMap = new Map(selectedValues.map((value, index) => [value, index]));

  return [...items].sort((a, b) => {
    const aSelected = selectedSet.has(a.value);
    const bSelected = selectedSet.has(b.value);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;

    if (aSelected && bSelected) {
      return (orderMap.get(a.value) ?? 0) - (orderMap.get(b.value) ?? 0);
    }

    if (a.count !== b.count) return b.count - a.count;
    return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
  });
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
  const selectedSet = new Set(selectedValues);
  const orderMap = new Map(selectedValues.map((value, index) => [value, index]));

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
    const aSelected = selectedSet.has(a.value);
    const bSelected = selectedSet.has(b.value);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;

    if (aSelected && bSelected) {
      return (orderMap.get(a.value) ?? 0) - (orderMap.get(b.value) ?? 0);
    }

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
  priceBounds,
  mode = "instant",
  draftParamsString = "",
  onDraftParamsStringChange,
}: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const searchParamsString = params.toString();
  const currentParamsString = mode === "draft" ? draftParamsString : searchParamsString;

  const selected = useMemo(() => {
    const current = new URLSearchParams(currentParamsString);
    return {
      categories: current.getAll("category"),
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
  const [resolvedSubcategories, setResolvedSubcategories] = useState<FacetItem[]>(subcategories);
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false);
  const subcategoriesAbortRef = useRef<AbortController | null>(null);
  const subcategoriesFetchKey = useMemo(() => {
    const next = new URLSearchParams(currentParamsString);
    next.delete("page");
    next.delete("sort");
    return next.toString();
  }, [currentParamsString]);
  const [resolvedPriceBounds, setResolvedPriceBounds] = useState<CatalogPriceBounds>(priceBounds);
  const [resolvedPriceHistogram, setResolvedPriceHistogram] = useState<CatalogPriceHistogram | null>(null);
  const [priceBoundsLoading, setPriceBoundsLoading] = useState(false);
  const priceBoundsAbortRef = useRef<AbortController | null>(null);
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
    setResolvedSubcategories(subcategories);
  }, [subcategories]);

  useEffect(() => {
    if (typeof priceBounds.min !== "number" || typeof priceBounds.max !== "number") return;
    setResolvedPriceBounds(priceBounds);
  }, [priceBounds]);

  useEffect(() => {
    const next = new URLSearchParams(subcategoriesFetchKey);
    const categories = next.getAll("category").filter((value) => value.trim().length > 0);
    if (categories.length === 0) {
      subcategoriesAbortRef.current?.abort();
      setResolvedSubcategories([]);
      setSubcategoriesLoading(false);
      return;
    }

    subcategoriesAbortRef.current?.abort();
    const controller = new AbortController();
    subcategoriesAbortRef.current = controller;
    setSubcategoriesLoading(true);

    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/subcategories?${next.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as { items?: FacetItem[] };
        setResolvedSubcategories(Array.isArray(payload?.items) ? payload.items : []);
      } catch (err) {
        if (isAbortError(err)) return;
        setResolvedSubcategories([]);
      } finally {
        setSubcategoriesLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [subcategoriesFetchKey]);

  useEffect(() => {
    priceBoundsAbortRef.current?.abort();
    const controller = new AbortController();
    priceBoundsAbortRef.current = controller;
    setPriceBoundsLoading(true);

    const next = new URLSearchParams(priceBoundsFetchKey);
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/price-bounds?${next.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const payload = (await res.json()) as {
          bounds?: CatalogPriceBounds;
          histogram?: CatalogPriceHistogram | null;
        };
        const bounds = payload?.bounds;
        setResolvedPriceBounds({
          min: typeof bounds?.min === "number" ? bounds.min : null,
          max: typeof bounds?.max === "number" ? bounds.max : null,
        });

        const histogram = payload?.histogram;
        setResolvedPriceHistogram(
          histogram && Array.isArray(histogram.buckets) ? histogram : null,
        );
      } catch (err) {
        if (isAbortError(err)) return;
        setResolvedPriceBounds({ min: null, max: null });
        setResolvedPriceHistogram(null);
      } finally {
        setPriceBoundsLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [priceBoundsFetchKey]);

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

  const sortedCategories = useMemo(
    () => sortFacetItems(facets.categories, selected.categories),
    [facets.categories, selected.categories],
  );
  const sortedColors = useMemo(
    () => sortColorFacetItems(facets.colors, selected.colors),
    [facets.colors, selected.colors],
  );

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
            const disabled = (item.count === 0 && !checked) || isPending;
            return (
              <label
                key={item.value}
                className={[
                  "flex items-center justify-between gap-3 text-sm",
                  disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
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
                <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
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
          <div className="relative flex flex-col gap-2 lg:max-h-[18rem] lg:overflow-auto lg:pr-2">
            {sortedCategories.map((item) => {
              const checked = isChecked(selected.categories, item.value);
              const disabled = (item.count === 0 && !checked) || isPending;
              return (
                <label
                  key={item.value}
                  className={[
                    "flex items-center justify-between gap-3 text-sm",
                    disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                  ].join(" ")}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMulti("category", item.value)}
                      className="h-4 w-4 accent-[color:var(--oda-ink)]"
                      disabled={disabled}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
                </label>
              );
            })}
            {sortedCategories.length > 10 ? (
              <div className="pointer-events-none sticky bottom-0 hidden lg:block">
                <div
                  className="h-12 w-full bg-gradient-to-t from-white to-transparent"
                  aria-hidden
                />
                <div className="absolute bottom-3 right-3 rounded-full border border-[color:var(--oda-border)] bg-white/85 px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)] shadow-[0_12px_30px_rgba(23,21,19,0.10)] backdrop-blur">
                  Scroll ↓
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </details>

      {selected.categories.length > 0 ? (
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
            {subcategoriesLoading && resolvedSubcategories.length === 0 ? (
              <div className="grid gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-6 w-full rounded-lg bg-[color:var(--oda-stone)]"
                  />
                ))}
              </div>
            ) : resolvedSubcategories.length === 0 ? (
              <p className="rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-4 text-sm text-[color:var(--oda-taupe)]">
                No hay subcategorías disponibles con estos filtros.
              </p>
            ) : (
              sortFacetItems(resolvedSubcategories, selected.subcategories).map((item) => {
                const checked = isChecked(selected.subcategories, item.value);
                const disabled = (item.count === 0 && !checked) || isPending;
                return (
                  <label
                    key={item.value}
                    className={[
                      "flex items-center justify-between gap-3 text-sm",
                      disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
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
                    <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
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
          <div className="max-h-64 overflow-auto pr-1">
            <div className="flex flex-col gap-2">
              {sortFacetItems(
                facets.brands.filter((item) => {
                  const query = brandSearch.trim().toLowerCase();
                  if (!query) return true;
                  return item.label.toLowerCase().includes(query);
                }),
                selected.brandIds,
              ).map((item) => {
                const checked = isChecked(selected.brandIds, item.value);
                const disabled = (item.count === 0 && !checked) || isPending;
                return (
                  <label
                    key={item.value}
                    className={[
                      "flex items-center justify-between gap-3 text-sm",
                      disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
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
                    <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
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
            const disabled = (item.count === 0 && !checked) || isPending;
            return (
              <label
                key={item.value}
                className={["relative", disabled ? "cursor-not-allowed opacity-35" : "cursor-pointer"].join(
                  " ",
                )}
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
                    "peer-checked:border-[color:var(--oda-ink)] peer-checked:shadow-[0_16px_30px_rgba(23,21,19,0.16)]",
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
            const disabled = (item.count === 0 && !checked) || isPending;
            return (
              <label
                key={item.value}
                className={[
                  "flex items-center justify-between gap-3 text-sm",
                  disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
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
                <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
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
            const disabled = (item.count === 0 && !checked) || isPending;
            return (
              <label
                key={item.value}
                className={[
                  "flex items-center justify-between gap-3 text-sm",
                  disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
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
                <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
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
  selectedMinRaw,
  selectedMaxRaw,
  selectedRangesRaw,
  searchParamsString,
  commitParams,
  disabled,
}: {
  bounds: CatalogPriceBounds;
  histogram?: CatalogPriceHistogram | null;
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

    const b1 = clamp(q(minBound + range * 0.25), minBound, maxBound);
    const b2 = clamp(q(minBound + range * 0.5), minBound, maxBound);
    const b3 = clamp(q(minBound + range * 0.75), minBound, maxBound);

    const unique = Array.from(new Set([b1, b2, b3])).filter((v) => v > minBound && v < maxBound);
    const cuts = [minBound, ...unique, maxBound];
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
      // 7px..24px (sin cambiar la altura total del filtro)
      height: 7 + Math.round((Math.max(0, count) / maxCount) * 17),
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
            className="absolute inset-x-0 top-1/2 flex h-6 -translate-y-1/2 items-end gap-[2px] opacity-70"
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
