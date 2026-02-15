"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
};

type Facets = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  seoTags: FacetItem[];
  colors: FacetItem[];
  sizes: FacetItem[];
  fits: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
  occasions: FacetItem[];
  seasons: FacetItem[];
  styles: FacetItem[];
};

type Props = {
  facets: Facets;
  subcategories: FacetItem[];
};

function buildSelectedLabel(count: number) {
  if (!count) return "";
  if (count === 1) return "1 seleccionado";
  return `${count} seleccionados`;
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

export default function CatalogFiltersPanel({ facets, subcategories }: Props) {
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
      seoTags: current.getAll("seo_tag"),
      colors: current.getAll("color"),
      sizes: current.getAll("size"),
      fits: current.getAll("fit"),
      materials: current.getAll("material"),
      patterns: current.getAll("pattern"),
      occasions: current.getAll("occasion"),
      seasons: current.getAll("season"),
      styles: current.getAll("style"),
      inStock: current.get("in_stock") === "1" || current.get("in_stock") === "true",
      q: current.get("q") ?? "",
      priceMin: current.get("price_min") ?? "",
      priceMax: current.get("price_max") ?? "",
      sort: current.get("sort") ?? "",
    };
  }, [searchParamsString]);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const priceMinRef = useRef<HTMLInputElement | null>(null);
  const priceMaxRef = useRef<HTMLInputElement | null>(null);
  const [brandSearch, setBrandSearch] = useState("");
  const [seoTagSearch, setSeoTagSearch] = useState("");

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

  const toggleMulti = (key: string, value: string, allowEmptyValue = false) => {
    const next = new URLSearchParams(searchParamsString);
    const values = next.getAll(key);
    next.delete(key);
    if (!allowEmptyValue && value === "") {
      values.forEach((item) => next.append(key, item));
      applyParams(next);
      return;
    }
    if (values.includes(value)) {
      values.filter((item) => item !== value).forEach((item) => next.append(key, item));
    } else {
      values.forEach((item) => next.append(key, item));
      next.append(key, value);
    }
    applyParams(next);
  };

  const setSingle = (key: string, value: string) => {
    const next = new URLSearchParams(searchParamsString);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    applyParams(next);
  };

  const clearAll = () => {
    applyParams(new URLSearchParams());
  };

  const isChecked = (list: string[], value: string) => list.includes(value);

  const handleSearchCommit = () => {
    const value = (searchInputRef.current?.value ?? "").trim();
    setSingle("q", value);
  };

  const handlePriceCommit = () => {
    const priceMin = (priceMinRef.current?.value ?? "").trim();
    const priceMax = (priceMaxRef.current?.value ?? "").trim();
    const next = new URLSearchParams(searchParamsString);
    if (priceMin.trim().length > 0) {
      next.set("price_min", priceMin.trim());
    } else {
      next.delete("price_min");
    }
    if (priceMax.trim().length > 0) {
      next.set("price_max", priceMax.trim());
    } else {
      next.delete("price_max");
    }
    applyParams(next);
  };

  return (
    <aside className="flex flex-col gap-6">
      <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Buscar</p>
        <div className="mt-3 flex flex-col gap-3">
          <input
            key={`q:${selected.q}`}
            ref={searchInputRef}
            defaultValue={selected.q}
            onBlur={handleSearchCommit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearchCommit();
              }
            }}
            placeholder="Buscador inteligente"
            className="w-full rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Estado</p>
          {isPending ? (
            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Actualizando…
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Categoria
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.categories.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {sortFacetItems(facets.categories, selected.categories).map((item) => (
            <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isChecked(selected.categories, item.value)}
                  onChange={() => toggleMulti("category", item.value)}
                  className="h-4 w-4 accent-[color:var(--oda-ink)]"
                />
                {item.label}
              </span>
              <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
            </label>
          ))}
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
            {subcategories.map((item) => (
              <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked(selected.subcategories, item.value)}
                    onChange={() => toggleMulti("subcategory", item.value)}
                    className="h-4 w-4 accent-[color:var(--oda-ink)]"
                  />
                  {item.label}
                </span>
                <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
              </label>
            ))}
          </div>
        </details>
      ) : null}

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Genero
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.genders.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {facets.genders.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isChecked(selected.genders, item.value)}
                  onChange={() => toggleMulti("gender", item.value)}
                  className="h-4 w-4 accent-[color:var(--oda-ink)]"
                />
                {item.label}
              </span>
              <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
            </label>
          ))}
        </div>
      </details>

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
              ).map((item) => (
                <label
                  key={item.value}
                  className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked(selected.brandIds, item.value)}
                      onChange={() => toggleMulti("brandId", item.value)}
                      className="h-4 w-4 accent-[color:var(--oda-ink)]"
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          SEO tags
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.seoTags.length)}
          </span>
        </summary>
        <div className="mt-4 grid gap-3">
          {facets.seoTags.length > 0 ? (
            <>
              <input
                value={seoTagSearch}
                onChange={(event) => setSeoTagSearch(event.target.value)}
                placeholder="Buscar SEO tag…"
                className="w-full rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-sm"
                disabled={isPending}
              />
              <div className="max-h-64 overflow-auto pr-1">
                <div className="flex flex-col gap-2">
                  {sortFacetItems(
                    facets.seoTags.filter((item) => {
                      const query = seoTagSearch.trim().toLowerCase();
                      if (!query) return true;
                      return (
                        item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query)
                      );
                    }),
                    selected.seoTags,
                  ).map((item) => (
                    <label
                      key={item.value}
                      className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked(selected.seoTags, item.value)}
                          onChange={() => toggleMulti("seo_tag", item.value)}
                          className="h-4 w-4 accent-[color:var(--oda-ink)]"
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[color:var(--oda-taupe)]">No hay SEO tags para estos resultados.</p>
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Precio
        </summary>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              key={`price-min:${selected.priceMin}`}
              ref={priceMinRef}
              defaultValue={selected.priceMin}
              onBlur={handlePriceCommit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handlePriceCommit();
                }
              }}
              placeholder="Min"
              className="w-full rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2 text-sm"
            />
            <input
              key={`price-max:${selected.priceMax}`}
              ref={priceMaxRef}
              defaultValue={selected.priceMax}
              onBlur={handlePriceCommit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handlePriceCommit();
                }
              }}
              placeholder="Max"
              className="w-full rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2 text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-[color:var(--oda-ink-soft)]">
            <input
              type="checkbox"
              checked={selected.inStock}
              onChange={() => {
                if (selected.inStock) {
                  const next = new URLSearchParams(searchParamsString);
                  next.delete("in_stock");
                  applyParams(next);
                } else {
                  toggleMulti("in_stock", "1", true);
                }
              }}
              className="h-4 w-4 accent-[color:var(--oda-ink)]"
            />
            Solo en stock
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Color
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.colors.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          {facets.colors.map((item) => (
            <label key={item.value} className="cursor-pointer">
              <input
                type="checkbox"
                checked={isChecked(selected.colors, item.value)}
                onChange={() => toggleMulti("color", item.value)}
                className="peer sr-only"
              />
              <span className="flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] transition peer-checked:border-[color:var(--oda-ink)] peer-checked:text-[color:var(--oda-ink)]">
                <span
                  className="h-3 w-3 rounded-full border border-[color:var(--oda-border)]"
                  style={{ backgroundColor: item.swatch ?? "#fff" }}
                />
                {item.label}
              </span>
            </label>
          ))}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Talla
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.sizes.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          {facets.sizes.map((item) => (
            <label key={item.value} className="cursor-pointer">
              <input
                type="checkbox"
                checked={isChecked(selected.sizes, item.value)}
                onChange={() => toggleMulti("size", item.value)}
                className="peer sr-only"
              />
              <span className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] transition peer-checked:border-[color:var(--oda-ink)] peer-checked:text-[color:var(--oda-ink)]">
                {item.label}
              </span>
            </label>
          ))}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5" open>
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Fit
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.fits.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          {facets.fits.map((item) => (
            <label key={item.value} className="cursor-pointer">
              <input
                type="checkbox"
                checked={isChecked(selected.fits, item.value)}
                onChange={() => toggleMulti("fit", item.value)}
                className="peer sr-only"
              />
              <span className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] transition peer-checked:border-[color:var(--oda-ink)] peer-checked:text-[color:var(--oda-ink)]">
                {item.label}
              </span>
            </label>
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
          {facets.materials.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isChecked(selected.materials, item.value)}
                  onChange={() => toggleMulti("material", item.value)}
                  className="h-4 w-4 accent-[color:var(--oda-ink)]"
                />
                {item.label}
              </span>
              <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
            </label>
          ))}
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
          {facets.patterns.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isChecked(selected.patterns, item.value)}
                  onChange={() => toggleMulti("pattern", item.value)}
                  className="h-4 w-4 accent-[color:var(--oda-ink)]"
                />
                {item.label}
              </span>
              <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
            </label>
          ))}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Ocasion
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.occasions.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {facets.occasions.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isChecked(selected.occasions, item.value)}
                  onChange={() => toggleMulti("occasion", item.value)}
                  className="h-4 w-4 accent-[color:var(--oda-ink)]"
                />
                {item.label}
              </span>
              <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
            </label>
          ))}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Temporada
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.seasons.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          {facets.seasons.map((item) => (
            <label key={item.value} className="cursor-pointer">
              <input
                type="checkbox"
                checked={isChecked(selected.seasons, item.value)}
                onChange={() => toggleMulti("season", item.value)}
                className="peer sr-only"
              />
              <span className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] transition peer-checked:border-[color:var(--oda-ink)] peer-checked:text-[color:var(--oda-ink)]">
                {item.label}
              </span>
            </label>
          ))}
        </div>
      </details>

      <details className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-5">
        <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Estilo principal
          <span className="text-[10px] text-[color:var(--oda-taupe)]">
            {buildSelectedLabel(selected.styles.length)}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          {facets.styles.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isChecked(selected.styles, item.value)}
                  onChange={() => toggleMulti("style", item.value)}
                  className="h-4 w-4 accent-[color:var(--oda-ink)]"
                />
                {item.label}
              </span>
              <span className="text-xs text-[color:var(--oda-taupe)]">{item.count}</span>
            </label>
          ))}
        </div>
      </details>
    </aside>
  );
}
