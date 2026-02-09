"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SortOption = { value: string; label: string };

export const SORT_OPTIONS: SortOption[] = [
  { value: "relevancia", label: "Relevancia" },
  { value: "new", label: "Nuevos" },
  { value: "price_asc", label: "Precio: menor" },
  { value: "price_desc", label: "Precio: mayor" },
];

export type CatalogFilterLabelMaps = Partial<
  Record<
    "category" | "subcategory" | "gender" | "brandId" | "color" | "material" | "pattern",
    Record<string, string>
  >
>;

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

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  createdAt: number;
};

const SAVED_SEARCHES_KEY = "oda_catalog_saved_searches_v1";

function loadSavedSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : String(Math.random()),
        name: typeof item.name === "string" ? item.name : "Búsqueda",
        query: typeof item.query === "string" ? item.query : "",
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      }))
      .slice(0, 24);
  } catch {
    return [];
  }
}

function persistSavedSearches(next: SavedSearch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next.slice(0, 24)));
  } catch {
    // ignore
  }
}

export default function CatalogToolbar({
  totalCount,
  activeBrandCount,
  searchKey,
  labels,
}: {
  totalCount: number;
  activeBrandCount?: number | null;
  searchKey: string;
  labels?: CatalogFilterLabelMaps;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const sort = params.get("sort") ?? "new";
  const hasFilters = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("sort");
    next.delete("page");
    return next.toString().length > 0;
  }, [params]);

  const chips = useMemo(() => {
    const next: Array<{ id: string; key: string; value?: string; label: string }> = [];

    const pushList = (paramKey: string, labelKey: keyof CatalogFilterLabelMaps, prefix: string) => {
      const values = params.getAll(paramKey).filter((value) => value.trim().length > 0);
      for (const value of values) {
        const friendly = labels?.[labelKey]?.[value] ?? value;
        next.push({
          id: `${paramKey}:${value}`,
          key: paramKey,
          value,
          label: `${prefix}: ${friendly}`,
        });
      }
    };

    pushList("gender", "gender", "Género");
    pushList("category", "category", "Categoría");
    pushList("subcategory", "subcategory", "Subcategoría");
    pushList("brandId", "brandId", "Marca");
    pushList("color", "color", "Color");
    pushList("material", "material", "Material");
    pushList("pattern", "pattern", "Patrón");

    const priceMinRaw = params.get("price_min");
    const priceMaxRaw = params.get("price_max");
    const priceMin = priceMinRaw ? Number(priceMinRaw) : null;
    const priceMax = priceMaxRaw ? Number(priceMaxRaw) : null;
    if (priceMinRaw || priceMaxRaw) {
      const parts: string[] = [];
      if (Number.isFinite(priceMin)) parts.push(formatCop(priceMin!));
      if (Number.isFinite(priceMax)) parts.push(formatCop(priceMax!));
      next.push({
        id: "price",
        key: "price",
        label: `Precio: ${parts.length > 0 ? parts.join(" - ") : "—"}`,
      });
    }

    return next;
  }, [labels, params]);

  const removeChip = (chip: { key: string; value?: string }) => {
    const next = new URLSearchParams(params.toString());
    if (chip.key === "price") {
      next.delete("price_min");
      next.delete("price_max");
    } else if (chip.value) {
      const values = next.getAll(chip.key);
      next.delete(chip.key);
      values.filter((value) => value !== chip.value).forEach((value) => next.append(chip.key, value));
    } else {
      next.delete(chip.key);
    }
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const applyParams = (next: URLSearchParams) => {
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const handleSortChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "new") {
      next.delete("sort");
    } else {
      next.set("sort", value);
    }
    applyParams(next);
  };

  const handleClear = () => {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  const selectedOption =
    SORT_OPTIONS.find((option) => option.value === sort) ??
    SORT_OPTIONS.find((option) => option.value === "new")!;

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => loadSavedSearches());
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    persistSavedSearches(savedSearches);
  }, [savedSearches]);

  const saveCurrentSearch = () => {
    const query = (searchKey ?? "").trim();
    if (!query) return;
    const name = saveName.trim() || "Mi búsqueda";
    const existing = savedSearches.find((item) => item.query === query);
    const next: SavedSearch[] = existing
      ? savedSearches.map((item) => (item.id === existing.id ? { ...item, name } : item))
      : [
          {
            id: `${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`,
            name,
            query,
            createdAt: Date.now(),
          },
          ...savedSearches,
        ];
    setSavedSearches(next.slice(0, 24));
    setSaveName("");
  };

  const applySavedSearch = (query: string) => {
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const deleteSavedSearch = (id: string) => {
    setSavedSearches((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4 lg:sticky lg:top-24 lg:z-30 lg:shadow-[0_30px_80px_rgba(23,21,19,0.10)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm text-[color:var(--oda-ink)]">
            <span className="font-semibold">{totalCount.toLocaleString("es-CO")}</span> productos
          </p>
          {typeof activeBrandCount === "number" ? (
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              {activeBrandCount.toLocaleString("es-CO")} marcas activas
            </p>
          ) : (
            <div
              className="h-3 w-28 rounded-full bg-[color:var(--oda-stone)]"
              aria-label="Cargando marcas activas"
            />
          )}
          {isPending ? (
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Actualizando…
            </p>
          ) : null}
        </div>

        <div className="hidden flex-wrap items-center gap-3 lg:flex">
          <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Ordenar
            <select
              key={searchKey}
              value={selectedOption.value}
              onChange={(event) => handleSortChange(event.target.value)}
              className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasFilters || isPending}
            className={[
              "rounded-full border px-4 py-2 text-xs uppercase tracking-[0.2em] transition",
              hasFilters && !isPending
                ? "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]"
                : "cursor-not-allowed border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)] opacity-70",
            ].join(" ")}
          >
            Limpiar
          </button>

          <details className="relative">
            <summary className="list-none">
              <button
                type="button"
                className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              >
                Guardados
              </button>
            </summary>
            <div className="absolute right-0 mt-3 w-[22rem] rounded-2xl border border-[color:var(--oda-border)] bg-white p-4 shadow-[0_30px_80px_rgba(23,21,19,0.20)]">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                Guardar búsqueda actual
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Nombre (ej: básicos blancos)"
                  className="flex-1 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={saveCurrentSearch}
                  disabled={!searchKey}
                  className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:opacity-60"
                >
                  Guardar
                </button>
              </div>

              {savedSearches.length > 0 ? (
                <div className="mt-4 grid gap-2">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    Tus búsquedas
                  </p>
                  <div className="max-h-64 overflow-auto pr-1">
                    <div className="grid gap-2">
                      {savedSearches.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => applySavedSearch(item.query)}
                            className="min-w-0 flex-1 text-left text-sm font-medium text-[color:var(--oda-ink)]"
                            title="Aplicar búsqueda"
                          >
                            <span className="block truncate">{item.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSavedSearch(item.id)}
                            className="rounded-full border border-[color:var(--oda-border)] bg-white px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
                            title="Eliminar"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[color:var(--oda-ink-soft)]">
                  Aún no has guardado búsquedas.
                </p>
              )}
            </div>
          </details>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => removeChip(chip)}
              disabled={isPending}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] disabled:cursor-not-allowed disabled:opacity-60"
              title="Quitar filtro"
            >
              <span className="truncate">{chip.label}</span>
              <span className="text-[12px] leading-none text-[color:var(--oda-taupe)]" aria-hidden>
                ×
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
