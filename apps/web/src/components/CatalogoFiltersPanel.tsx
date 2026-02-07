"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogPriceBounds } from "@/lib/catalog-data";

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

export default function CatalogoFiltersPanel({ facets, subcategories, priceBounds }: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const searchParamsString = params.toString();

  const selected = useMemo(() => {
    const current = new URLSearchParams(searchParamsString);
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
  }, [searchParamsString]);

  const [brandSearch, setBrandSearch] = useState("");

  useEffect(() => {
    setBrandSearch("");
  }, [selected.categories.join(","), selected.genders.join(","), selected.subcategories.join(",")]);

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

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(searchParamsString);
    const values = next.getAll(key);
    next.delete(key);
    if (values.includes(value)) {
      values.filter((item) => item !== value).forEach((item) => next.append(key, item));
    } else {
      values.forEach((item) => next.append(key, item));
      next.append(key, value);
    }
    applyParams(next);
  };

  const isChecked = (list: string[], value: string) => list.includes(value);

  return (
    <aside className="flex flex-col gap-6">
      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          <span className="flex items-center gap-3">
            Genero
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
            const disabled = item.count === 0 && !checked;
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
          Categoria
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.categories.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.categories, selected.categories).map((item) => {
            const checked = isChecked(selected.categories, item.value);
            const disabled = item.count === 0 && !checked;
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

      {subcategories.length > 0 ? (
        <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
          <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
            Subcategoria
            <span className="text-[10px] text-[color:var(--oda-taupe)]">
              {buildSelectedLabel(selected.subcategories.length)}
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-2">
            {sortFacetItems(subcategories, selected.subcategories).map((item) => {
              const checked = isChecked(selected.subcategories, item.value);
              const disabled = item.count === 0 && !checked;
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
            })}
          </div>
        </details>
      ) : null}

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Marca
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
                const disabled = item.count === 0 && !checked;
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
          Precio
        </summary>
        <PriceRange
          key={[
            priceBounds.min ?? "min",
            priceBounds.max ?? "max",
            selected.priceMin ?? "",
            selected.priceMax ?? "",
          ].join(":")}
          bounds={priceBounds}
          selectedMinRaw={selected.priceMin}
          selectedMaxRaw={selected.priceMax}
          searchParamsString={searchParamsString}
          applyParams={applyParams}
        />
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Color
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.colors.length)}
          </span>
        </summary>
        <div className="mt-4 grid gap-4">
          {Array.from(
            facets.colors.reduce((map, item) => {
              const rawFamily = item.group?.trim() ?? "";
              const family = COLOR_FAMILY_LABEL[rawFamily] ?? (rawFamily || "Otros");
              if (!map.has(family)) map.set(family, []);
              map.get(family)!.push(item);
              return map;
            }, new Map<string, FacetItem[]>()),
          )
            .sort(([a], [b]) => getFamilyRank(a) - getFamilyRank(b) || a.localeCompare(b, "es"))
            .map(([family, items]) => (
              <div key={family} className="grid gap-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {family}
                </p>
                <div className="flex flex-wrap gap-2">
                  {sortFacetItems(items, selected.colors).map((item) => {
                    const checked = isChecked(selected.colors, item.value);
                    const disabled = item.count === 0 && !checked;
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
              </div>
            ))}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Material
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.materials.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.materials, selected.materials).map((item) => {
            const checked = isChecked(selected.materials, item.value);
            const disabled = item.count === 0 && !checked;
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
          Patron
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.patterns.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.patterns, selected.patterns).map((item) => {
            const checked = isChecked(selected.patterns, item.value);
            const disabled = item.count === 0 && !checked;
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
  selectedMinRaw,
  selectedMaxRaw,
  searchParamsString,
  applyParams,
}: {
  bounds: CatalogPriceBounds;
  selectedMinRaw?: string | null;
  selectedMaxRaw?: string | null;
  searchParamsString: string;
  applyParams: (next: URLSearchParams) => void;
}) {
  const minBound = bounds.min ?? 0;
  const maxBound = bounds.max ?? 0;
  const step = getStep(maxBound);
  const hasRange = Number.isFinite(minBound) && Number.isFinite(maxBound) && maxBound > minBound;

  const selectedMin = selectedMinRaw ? Number(selectedMinRaw) : null;
  const selectedMax = selectedMaxRaw ? Number(selectedMaxRaw) : null;

  const [minValue, setMinValue] = useState(
    hasRange ? clamp(selectedMin ?? minBound, minBound, maxBound) : 0,
  );
  const [maxValue, setMaxValue] = useState(
    hasRange ? clamp(selectedMax ?? maxBound, minBound, maxBound) : 0,
  );
  const userChangedRef = useRef(false);

  useEffect(() => {
    if (!hasRange) return;
    if (!userChangedRef.current) return;

    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParamsString);
      const nextMin = Math.round(minValue / step) * step;
      const nextMax = Math.round(maxValue / step) * step;

      if (nextMin <= minBound) next.delete("price_min");
      else next.set("price_min", String(nextMin));

      if (nextMax >= maxBound) next.delete("price_max");
      else next.set("price_max", String(nextMax));

      applyParams(next);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [applyParams, hasRange, maxBound, maxValue, minBound, minValue, searchParamsString, step]);

  if (!hasRange) {
    return (
      <div className="mt-4 rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-4 text-sm text-[color:var(--oda-taupe)]">
        No hay suficiente variación de precio para este filtro.
      </div>
    );
  }

  const minPct = ((minValue - minBound) / (maxBound - minBound)) * 100;
  const maxPct = ((maxValue - minBound) / (maxBound - minBound)) * 100;

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

      <div className="relative h-10">
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
          className="absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent accent-[color:var(--oda-ink)]"
          style={{ zIndex: minValue > maxBound - step * 2 ? 5 : 3 }}
        />
        <input
          type="range"
          min={minBound}
          max={maxBound}
          step={step}
          value={maxValue}
          onChange={(event) => commitMax(Number(event.target.value))}
          className="absolute left-0 right-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent accent-[color:var(--oda-ink)]"
          style={{ zIndex: 4 }}
        />
      </div>

      <div className="text-xs text-[color:var(--oda-ink-soft)]">
        Rango disponible: {formatCop(minBound)} a {formatCop(maxBound)}
      </div>
    </div>
  );
}
