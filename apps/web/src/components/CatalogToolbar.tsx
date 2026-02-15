"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CatalogSubcategoryChips from "@/components/CatalogSubcategoryChips";

type SortOption = { value: string; label: string };

export const SORT_OPTIONS: SortOption[] = [
  { value: "relevancia", label: "Relevancia" },
  { value: "new", label: "Nuevos" },
  { value: "price_asc", label: "Precio: menor" },
  { value: "price_desc", label: "Precio: mayor" },
];

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  createdAt: number;
};

const SAVED_SEARCHES_KEY = "oda_catalog_saved_searches_v1";

function SaveIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v4h8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 16h10l1-16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

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
  filtersCollapsed = false,
  onToggleFiltersCollapsed,
}: {
  totalCount: number | null;
  activeBrandCount?: number | null;
  searchKey: string;
  filtersCollapsed?: boolean;
  onToggleFiltersCollapsed?: () => void;
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

  const activeFiltersCount = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("sort");
    next.delete("page");

    let count = 0;

    const hasPrice = next.has("price_min") || next.has("price_max") || next.has("price_range");
    if (hasPrice) {
      count += 1;
      next.delete("price_min");
      next.delete("price_max");
      next.delete("price_range");
    }

    const keys = ["gender", "category", "subcategory", "brandId", "color", "material", "pattern"];
    for (const key of keys) {
      const values = next.getAll(key).filter((value) => value.trim().length > 0);
      count += values.length;
      next.delete(key);
    }

    // Cuenta cualquier filtro extra no contemplado arriba.
    count += Array.from(next).length;
    return count;
  }, [params]);

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
  const [savedOpen, setSavedOpen] = useState(false);

  useEffect(() => {
    persistSavedSearches(savedSearches);
  }, [savedSearches]);

  useEffect(() => {
    if (!savedOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSavedOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [savedOpen]);

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
    <>
      <div className="min-h-[68px] rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-3 lg:sticky lg:top-24 lg:z-30">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-4">
            <p className="text-sm text-[color:var(--oda-ink)]">
              {typeof totalCount === "number" ? (
                <span className="font-semibold">{totalCount.toLocaleString("es-CO")}</span>
              ) : (
                <span
                  className="inline-flex h-4 w-16 rounded-full bg-[color:var(--oda-stone)] align-middle"
                  aria-label="Cargando conteo"
                />
              )}{" "}
              productos
            </p>
            {typeof activeBrandCount === "number" ? (
              <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                {activeBrandCount.toLocaleString("es-CO")} marcas
              </p>
            ) : (
              <div className="h-3 w-20 rounded-full bg-[color:var(--oda-stone)]" aria-label="Cargando marcas" />
            )}
            {isPending ? (
              <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Actualizando…
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {filtersCollapsed && onToggleFiltersCollapsed ? (
              <button
                type="button"
                onClick={onToggleFiltersCollapsed}
                className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              >
                <span className="inline-flex items-center gap-2">
                  <span>Filtros</span>
                  {activeFiltersCount > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--oda-ink)] px-2 py-0.5 text-[10px] font-semibold leading-none text-[color:var(--oda-cream)]">
                      {activeFiltersCount}
                    </span>
                  ) : null}
                </span>
              </button>
            ) : null}

            <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Ordenar
              <span className="relative inline-flex">
                <select
                  key={searchKey}
                  value={selectedOption.value}
                  onChange={(event) => handleSortChange(event.target.value)}
                  className="appearance-none rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2 pr-9 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
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
              onClick={() => setSavedOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              aria-label="Guardados"
              title="Guardados"
            >
              <SaveIcon />
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={!hasFilters || isPending}
              className={[
                "inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition",
                hasFilters && !isPending
                  ? "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]"
                  : "cursor-not-allowed border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)] opacity-60",
              ].join(" ")}
              aria-label="Limpiar filtros"
              title="Limpiar"
            >
              ×
            </button>
          </div>
        </div>

        <CatalogSubcategoryChips mode="toolbar" />
      </div>

      {savedOpen ? (
        <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar guardados"
            onClick={() => setSavedOpen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-[26rem] flex-col border-l border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] pr-[env(safe-area-inset-right)] shadow-[0_30px_90px_rgba(23,21,19,0.35)]">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--oda-border)] bg-white px-5 py-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Guardados
                </p>
                <p className="mt-1 text-sm font-semibold text-[color:var(--oda-ink)]">
                  Tus búsquedas
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSavedOpen(false)}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="flex-1 overflow-auto overflow-x-hidden px-5 pb-6 pt-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                Guardar búsqueda actual
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Nombre (ej: básicos blancos)"
                  className="flex-1 rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-sm"
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
                <div className="mt-6 grid gap-2">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    Guardadas
                  </p>
                  <div className="grid gap-2">
                    {savedSearches.map((item) => (
                      <div
                        key={item.id}
                        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-[color:var(--oda-border)] bg-white px-4 py-3"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            applySavedSearch(item.query);
                            setSavedOpen(false);
                          }}
                          className="min-w-0 flex-1 text-left"
                          title="Aplicar búsqueda"
                        >
                          <span className="block truncate text-sm font-semibold text-[color:var(--oda-ink)]">
                            {item.name}
                          </span>
                          <span className="mt-1 block truncate text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                            {item.query}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedSearch(item.id)}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-love)] transition hover:bg-[color:var(--oda-stone)]"
                          title="Eliminar"
                          aria-label={`Eliminar ${item.name}`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-6 text-sm text-[color:var(--oda-ink-soft)]">
                  Aún no has guardado búsquedas.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
