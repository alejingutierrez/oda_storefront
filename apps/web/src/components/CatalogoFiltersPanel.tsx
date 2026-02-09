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

const COLOR_FAMILY_LABEL: Record<string, string> = {
  NEUTRAL: "Neutros",
  WARM_NEUTRAL: "Neutros cálidos",
  BROWN: "Cafés",
  METALLIC: "Metálicos",
  RED: "Rojos",
  PINK: "Rosas",
  ORANGE: "Naranjas",
  YELLOW: "Amarillos",
  GREEN: "Verdes",
  TEAL: "Turquesas",
  BLUE: "Azules",
  PURPLE: "Morados",
  MAGENTA: "Fucsias",
};

const COLOR_FAMILY_ORDER = [
  "Neutros",
  "Neutros cálidos",
  "Cafés",
  "Metálicos",
  "Rojos",
  "Rosas",
  "Naranjas",
  "Amarillos",
  "Verdes",
  "Turquesas",
  "Azules",
  "Morados",
  "Fucsias",
];

function getFamilyRank(value: string) {
  const normalized = value.trim().toLowerCase();
  const index = COLOR_FAMILY_ORDER.findIndex((item) => item.toLowerCase() === normalized);
  return index === -1 ? 999 : index;
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

  const colorGroups = useMemo(() => {
    const selectedSet = new Set(selected.colors);
    const selectedFamilies = new Set<string>();
    for (const item of facets.colors) {
      if (!selectedSet.has(item.value)) continue;
      const rawFamily = item.group?.trim() ?? "";
      const family = COLOR_FAMILY_LABEL[rawFamily] ?? (rawFamily || "Otros");
      selectedFamilies.add(family);
    }

    const selectedItems = sortFacetItems(
      facets.colors.filter((item) => selectedSet.has(item.value)),
      selected.colors,
    );

    const familyMap = new Map<string, FacetItem[]>();
    for (const item of facets.colors) {
      const checked = selectedSet.has(item.value);
      if (checked) continue;
      if (item.count === 0) continue;
      const rawFamily = item.group?.trim() ?? "";
      const family = COLOR_FAMILY_LABEL[rawFamily] ?? (rawFamily || "Otros");
      if (!familyMap.has(family)) familyMap.set(family, []);
      familyMap.get(family)!.push(item);
    }

    const families = Array.from(familyMap.entries())
      .sort(([a], [b]) => getFamilyRank(a) - getFamilyRank(b) || a.localeCompare(b, "es"))
      .map(([family, items], index) => ({
        family,
        // Abrimos por defecto la familia seleccionada; si no hay seleccion, abrimos la primera.
        open: selectedFamilies.size > 0 ? selectedFamilies.has(family) : index === 0,
        items: sortFacetItems(items, selected.colors),
      }));

    return { selectedItems, families };
  }, [facets.colors, selected.colors]);

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
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.categories, selected.categories).map((item) => {
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
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMulti("category", item.value)}
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
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMulti("subcategory", item.value)}
                        className="h-4 w-4 accent-[color:var(--oda-ink)]"
                        disabled={disabled}
                      />
                      {item.label}
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
          key={
            mode === "instant"
              ? [
                  resolvedPriceBounds.min ?? "min",
                  resolvedPriceBounds.max ?? "max",
                  resolvedPriceHistogram?.bucketCount ?? "buckets",
                  selected.priceMin ?? "",
                  selected.priceMax ?? "",
                ].join(":")
              : undefined
          }
          bounds={resolvedPriceBounds}
          histogram={resolvedPriceHistogram}
          selectedMinRaw={selected.priceMin}
          selectedMaxRaw={selected.priceMax}
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
        <div className="mt-4 grid gap-4">
          {colorGroups.selectedItems.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Seleccionados
              </p>
              <div className="flex flex-wrap gap-2">
                {colorGroups.selectedItems.map((item) => {
                  const checked = true;
                  const disabled = isPending;
                  return (
                    <label
                      key={item.value}
                      className={[
                        "relative",
                        disabled ? "cursor-not-allowed opacity-35" : "cursor-pointer",
                      ].join(" ")}
                      title={`${item.label} (${item.count})`}
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
                          "block h-8 w-8 rounded-[12px] border border-[color:var(--oda-ink)] shadow-[0_16px_30px_rgba(23,21,19,0.16)] transition",
                        ].join(" ")}
                        style={{ backgroundColor: item.swatch ?? "#fff" }}
                      >
                        <span className="sr-only">{item.label}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {colorGroups.families.map((group) => (
            <details key={group.family} open={group.open} className="rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                <span>{group.family}</span>
                <span>{group.items.length}</span>
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {group.items.map((item) => {
                  const checked = isChecked(selected.colors, item.value);
                  const disabled = (item.count === 0 && !checked) || isPending;
                  return (
                    <label
                      key={item.value}
                      className={[
                        "relative",
                        disabled ? "cursor-not-allowed opacity-35" : "cursor-pointer",
                      ].join(" ")}
                      title={`${item.label} (${item.count})`}
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
                          "block h-7 w-7 rounded-[10px] border border-[color:var(--oda-border)] shadow-[0_10px_22px_rgba(23,21,19,0.10)] transition",
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
          ))}
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
  searchParamsString,
  commitParams,
  disabled,
}: {
  bounds: CatalogPriceBounds;
  histogram?: CatalogPriceHistogram | null;
  selectedMinRaw?: string | null;
  selectedMaxRaw?: string | null;
  searchParamsString: string;
  commitParams: (next: URLSearchParams) => void;
  disabled?: boolean;
}) {
  const hasBounds = typeof bounds.min === "number" && typeof bounds.max === "number";
  const minBound = typeof bounds.min === "number" ? bounds.min : 0;
  const maxBound = typeof bounds.max === "number" ? bounds.max : 0;
  const step = getStep(maxBound);
  const hasRange = hasBounds && Number.isFinite(minBound) && Number.isFinite(maxBound) && maxBound > minBound;

  const selectedMin = selectedMinRaw ? Number(selectedMinRaw) : null;
  const selectedMax = selectedMaxRaw ? Number(selectedMaxRaw) : null;

  const [minValue, setMinValue] = useState(() =>
    hasRange ? clamp(selectedMin ?? minBound, minBound, maxBound) : 0,
  );
  const [maxValue, setMaxValue] = useState(() =>
    hasRange ? clamp(selectedMax ?? maxBound, minBound, maxBound) : 0,
  );
  const userChangedRef = useRef(false);

  useEffect(() => {
    if (!hasRange) return;
    if (!userChangedRef.current) return;
    if (disabled) return;

    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParamsString);
      const nextMin = Math.round(minValue / step) * step;
      const nextMax = Math.round(maxValue / step) * step;

      if (nextMin <= minBound) next.delete("price_min");
      else next.set("price_min", String(nextMin));

      if (nextMax >= maxBound) next.delete("price_max");
      else next.set("price_max", String(nextMax));

      commitParams(next);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [commitParams, disabled, hasRange, maxBound, maxValue, minBound, minValue, searchParamsString, step]);

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

  const minPct = ((minValue - minBound) / (maxBound - minBound)) * 100;
  const maxPct = ((maxValue - minBound) / (maxBound - minBound)) * 100;

  const presets = (() => {
    const range = maxBound - minBound;
    if (!Number.isFinite(range) || range <= 0) return [];
    const q = (value: number) => Math.round(value / step) * step;

    const b1 = clamp(q(minBound + range * 0.25), minBound, maxBound);
    const b2 = clamp(q(minBound + range * 0.5), minBound, maxBound);
    const b3 = clamp(q(minBound + range * 0.75), minBound, maxBound);

    const unique = Array.from(new Set([b1, b2, b3])).filter((v) => v > minBound && v < maxBound);
    const cuts = [minBound, ...unique, maxBound];
    if (cuts.length < 3) return [];

    const next: Array<{ id: string; label: string; min: number | null; max: number | null }> = [];
    const firstMax = cuts[1];
    next.push({ id: "under", label: `Hasta ${formatCop(firstMax)}`, min: null, max: firstMax });
    for (let i = 1; i < cuts.length - 2; i += 1) {
      const from = cuts[i];
      const to = cuts[i + 1];
      next.push({ id: `mid_${i}`, label: `${formatCop(from)} a ${formatCop(to)}`, min: from, max: to });
    }
    const lastMin = cuts[cuts.length - 2];
    next.push({ id: "over", label: `Desde ${formatCop(lastMin)}`, min: lastMin, max: null });

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
      // 5px..20px
      height: 5 + Math.round((Math.max(0, count) / maxCount) * 15),
    }));
  })();

  const applyPreset = (preset: { min: number | null; max: number | null }) => {
    const next = new URLSearchParams(searchParamsString);
    if (preset.min === null || preset.min <= minBound) next.delete("price_min");
    else next.set("price_min", String(preset.min));

    if (preset.max === null || preset.max >= maxBound) next.delete("price_max");
    else next.set("price_max", String(preset.max));

    commitParams(next);
  };

  const commitMin = (value: number) => {
    userChangedRef.current = true;
    const clamped = clamp(value, minBound, maxBound);
    setMinValue(Math.min(clamped, maxValue - step));
  };

  const commitMax = (value: number) => {
    userChangedRef.current = true;
    const clamped = clamp(value, minBound, maxBound);
    setMaxValue(Math.max(clamped, minValue + step));
  };

  return (
    <div className="mt-4 grid gap-3">
      <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
        <span>{formatCop(minValue)}</span>
        <span>{formatCop(maxValue)}</span>
      </div>

      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              disabled={disabled}
              className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => applyPreset({ min: null, max: null })}
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
          value={minValue}
          onChange={(event) => commitMin(Number(event.target.value))}
          className="oda-range oda-range--min absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 bg-transparent"
          disabled={disabled}
        />
        <input
          type="range"
          min={minBound}
          max={maxBound}
          step={step}
          value={maxValue}
          onChange={(event) => commitMax(Number(event.target.value))}
          className="oda-range oda-range--max absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 bg-transparent"
          disabled={disabled}
        />
      </div>

      <div className="text-xs text-[color:var(--oda-ink-soft)]">
        Rango disponible: {formatCop(minBound)} a {formatCop(maxBound)}
      </div>
    </div>
  );
}
