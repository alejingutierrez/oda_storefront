"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { logExperienceEvent } from "@/lib/experience-events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SuggestionTermItem = {
  type: string;
  value: string;
  label: string;
  href: string;
  count?: number;
};

type SuggestionProductItem = {
  id: string;
  name: string;
  brandName: string;
  imageCoverUrl: string | null;
  minPrice: string | null;
  href: string;
};

type SearchSuggestionsResponse = {
  query: string;
  groups: {
    terms: SuggestionTermItem[];
    brands: SuggestionTermItem[];
    products: SuggestionProductItem[];
  };
};

type FlatItem =
  | { kind: "term"; item: SuggestionTermItem }
  | { kind: "brand"; item: SuggestionTermItem }
  | { kind: "product"; item: SuggestionProductItem };

// ---------------------------------------------------------------------------
// Recent searches (localStorage)
// ---------------------------------------------------------------------------

const RECENT_KEY = "oda_recent_searches_v1";
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  const recent = getRecentSearches().filter((r) => r !== q);
  recent.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function removeRecentSearch(query: string) {
  const recent = getRecentSearches().filter((r) => r !== query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

// ---------------------------------------------------------------------------
// Price formatter
// ---------------------------------------------------------------------------

const priceFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatPrice(value: string | null): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return priceFormatter.format(n);
}

// ---------------------------------------------------------------------------
// Type labels
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  category: "Categoria",
  subcategory: "Subcategoria",
  material: "Material",
  pattern: "Estampado",
  occasion: "Ocasion",
  realStyle: "Estilo",
};

// ---------------------------------------------------------------------------
// SearchOverlay Component
// ---------------------------------------------------------------------------

export default function SearchOverlay({
  open,
  onClose,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  mode: "desktop" | "mobile";
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchSuggestionsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load recent searches on open
  useEffect(() => {
    if (open) {
      setRecentSearches(getRecentSearches());
      setQuery("");
      setResults(null);
      setActiveIndex(-1);
      // Focus input after paint
      requestAnimationFrame(() => inputRef.current?.focus());
      logExperienceEvent({
        type: "search_open",
        path: `${window.location.pathname}${window.location.search}`,
        properties: { surface: mode },
      });
    }
  }, [open, mode]);

  // Lock body scroll on mobile
  useEffect(() => {
    if (!open || mode !== "mobile") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, mode]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Click outside (desktop only)
  useEffect(() => {
    if (!open || mode !== "desktop") return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately on the click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose, mode]);

  // Debounced fetch
  useEffect(() => {
    if (query.length < 2) {
      setResults(null);
      setActiveIndex(-1);
      return;
    }
    setIsLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/search/suggestions?q=${encodeURIComponent(query)}&limit=12`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const data: SearchSuggestionsResponse = await res.json();
          setResults(data);
          setActiveIndex(-1);
        }
      } catch {
        // Aborted or network error; ignore.
      } finally {
        setIsLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Flat results for keyboard navigation
  const flatResults = useMemo((): FlatItem[] => {
    if (!results) return [];
    return [
      ...results.groups.terms.map((item): FlatItem => ({ kind: "term", item })),
      ...results.groups.brands.map((item): FlatItem => ({ kind: "brand", item })),
      ...results.groups.products.map((item): FlatItem => ({ kind: "product", item })),
    ];
  }, [results]);

  const navigateToResult = useCallback(
    (flat: FlatItem, position: number) => {
      const href =
        flat.kind === "product" ? (flat.item as SuggestionProductItem).href : (flat.item as SuggestionTermItem).href;
      addRecentSearch(query);
      logExperienceEvent({
        type: "search_suggestion_click",
        path: `${window.location.pathname}${window.location.search}`,
        productId: flat.kind === "product" ? (flat.item as SuggestionProductItem).id : undefined,
        properties: {
          query,
          suggestionType: flat.kind,
          suggestionValue:
            flat.kind === "product" ? (flat.item as SuggestionProductItem).name : (flat.item as SuggestionTermItem).value,
          position,
        },
      });
      onClose();
      router.push(href);
    },
    [query, onClose, router],
  );

  const navigateToSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      addRecentSearch(trimmed);
      logExperienceEvent({
        type: "search_submit",
        path: `${window.location.pathname}${window.location.search}`,
        properties: { query: trimmed },
      });
      onClose();
      router.push(`/catalogo?q=${encodeURIComponent(trimmed)}`);
    },
    [onClose, router],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, -1));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && flatResults[activeIndex]) {
            navigateToResult(flatResults[activeIndex], activeIndex);
          } else {
            navigateToSearch(query);
          }
          break;
      }
    },
    [activeIndex, flatResults, navigateToResult, navigateToSearch, query],
  );

  const handleRemoveRecent = useCallback(
    (q: string) => {
      removeRecentSearch(q);
      setRecentSearches(getRecentSearches());
      logExperienceEvent({
        type: "search_recent_clear",
        properties: { query: q },
      });
    },
    [],
  );

  // Pre-compute offsets for each group in flatResults for keyboard nav
  const termOffset = 0;
  const brandOffset = results ? results.groups.terms.length : 0;
  const productOffset = results ? results.groups.terms.length + results.groups.brands.length : 0;

  if (!open) return null;

  const content = (
    <div className="flex flex-col gap-0">
      {/* Input area */}
      <div className="flex items-center gap-3 border-b border-[color:var(--oda-border)] px-5 py-4">
        {/* Search icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          className="shrink-0 text-[color:var(--oda-taupe)]"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Buscar productos, marcas, categorias..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-base text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults(null);
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-full p-1 text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
            aria-label="Limpiar busqueda"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {mode === "mobile" && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
          >
            Cerrar
          </button>
        )}
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-auto overscroll-contain px-5 py-4">
        {/* Loading indicator */}
        {isLoading && query.length >= 2 && (
          <div className="flex items-center gap-2 py-2">
            <div className="h-3 w-3 animate-spin rounded-full border border-[color:var(--oda-taupe)] border-t-transparent" />
            <span className="text-xs text-[color:var(--oda-taupe)]">Buscando...</span>
          </div>
        )}

        {/* Results groups */}
        {results && !isLoading && (
          <div className="flex flex-col gap-5">
            {/* Terms (categories, materials, etc.) */}
            {results.groups.terms.length > 0 && (
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Sugerencias
                </h3>
                <div className="flex flex-col">
                  {results.groups.terms.map((item, i) => {
                    const globalIdx = termOffset + i;
                    return (
                      <button
                        key={`${item.type}-${item.value}`}
                        type="button"
                        onClick={() => navigateToResult({ kind: "term", item }, globalIdx)}
                        data-active={activeIndex === globalIdx || undefined}
                        className="flex items-center justify-between rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[color:var(--oda-stone)] data-[active]:bg-[color:var(--oda-stone)]"
                      >
                        <span className="text-sm text-[color:var(--oda-ink)]">{item.label}</span>
                        <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
                          {TYPE_LABELS[item.type] ?? item.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Brands */}
            {results.groups.brands.length > 0 && (
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Marcas
                </h3>
                <div className="flex flex-col">
                  {results.groups.brands.map((item, i) => {
                    const globalIdx = brandOffset + i;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => navigateToResult({ kind: "brand", item }, globalIdx)}
                        data-active={activeIndex === globalIdx || undefined}
                        className="flex items-center justify-between rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[color:var(--oda-stone)] data-[active]:bg-[color:var(--oda-stone)]"
                      >
                        <span className="text-sm font-medium text-[color:var(--oda-ink)]">{item.label}</span>
                        {item.count != null && (
                          <span className="text-[10px] text-[color:var(--oda-taupe)]">
                            {item.count} productos
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Products */}
            {results.groups.products.length > 0 && (
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Productos
                </h3>
                <div className="flex flex-col gap-1">
                  {results.groups.products.map((item, i) => {
                    const globalIdx = productOffset + i;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateToResult({ kind: "product", item }, globalIdx)}
                        data-active={activeIndex === globalIdx || undefined}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[color:var(--oda-stone)] data-[active]:bg-[color:var(--oda-stone)]"
                      >
                        {item.imageCoverUrl ? (
                          <Image
                            src={item.imageCoverUrl}
                            alt=""
                            width={48}
                            height={48}
                            className="h-12 w-12 shrink-0 rounded-md bg-[color:var(--oda-stone)] object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded-md bg-[color:var(--oda-stone)]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-[color:var(--oda-ink)]">{item.name}</p>
                          <p className="truncate text-xs text-[color:var(--oda-taupe)]">{item.brandName}</p>
                        </div>
                        {formatPrice(item.minPrice) && (
                          <span className="shrink-0 text-sm font-medium text-[color:var(--oda-ink)]">
                            {formatPrice(item.minPrice)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No results */}
            {results.groups.terms.length === 0 &&
              results.groups.brands.length === 0 &&
              results.groups.products.length === 0 && (
                <p className="py-4 text-center text-sm text-[color:var(--oda-taupe)]">
                  No hay resultados para &ldquo;{results.query}&rdquo;
                </p>
              )}

            {/* Full search link */}
            {query.trim().length > 0 && (
              <button
                type="button"
                onClick={() => navigateToSearch(query)}
                className="mt-1 flex items-center justify-center gap-2 rounded-full border border-[color:var(--oda-border)] px-4 py-2.5 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              >
                Buscar &ldquo;{query.trim()}&rdquo; en todo el catalogo
              </button>
            )}
          </div>
        )}

        {/* Recent searches (shown when no query) */}
        {!results && !isLoading && recentSearches.length > 0 && (
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              Busquedas recientes
            </h3>
            <div className="flex flex-col">
              {recentSearches.map((q) => (
                <div key={q} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(q);
                      inputRef.current?.focus();
                    }}
                    className="flex-1 rounded-lg px-2 py-2.5 text-left text-sm text-[color:var(--oda-ink)] transition-colors hover:bg-[color:var(--oda-stone)]"
                  >
                    {q}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRecent(q)}
                    className="shrink-0 rounded-full p-1.5 text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
                    aria-label={`Eliminar busqueda ${q}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state when no query and no recents */}
        {!results && !isLoading && recentSearches.length === 0 && (
          <p className="py-4 text-center text-xs text-[color:var(--oda-taupe)]">
            Escribe para buscar productos, marcas o categorias
          </p>
        )}
      </div>
    </div>
  );

  // Desktop: dropdown below header
  if (mode === "desktop") {
    return createPortal(
      <div
        ref={panelRef}
        className="fixed inset-x-0 top-[var(--oda-header-h,72px)] z-50 mx-auto max-w-[1320px] px-6"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar"
      >
        <div className="oda-glass-noise overflow-hidden rounded-2xl border border-white/50 bg-white/90 shadow-[0_20px_60px_rgba(23,21,19,0.15)] backdrop-blur-2xl">
          <div className="max-h-[min(70vh,600px)] overflow-hidden flex flex-col">
            {content}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Mobile: fullscreen modal
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar"
    >
      <div className="flex flex-1 flex-col overflow-hidden">{content}</div>
    </div>,
    document.body,
  );
}
