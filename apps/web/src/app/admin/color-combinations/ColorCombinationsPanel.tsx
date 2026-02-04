"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PAGE_SIZE = 24;

type ColorItem = {
  id: string;
  position: number;
  role: string | null;
  hex: string;
  pantoneCode: string | null;
  pantoneName: string | null;
};

type CombinationItem = {
  id: string;
  imageFilename: string;
  detectedLayout: string;
  comboKey: string;
  season: string | null;
  temperature: string | null;
  contrast: string | null;
  mood: string | null;
  colors: ColorItem[];
};

type FilterOptions = {
  seasons: string[];
  temperatures: string[];
  contrasts: string[];
  moods: string[];
};

type ApiResponse = {
  items: CombinationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: FilterOptions;
};

type ProductMatch = {
  productId: string;
  variantId: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  distance: number;
  gender: string | null;
  category: string | null;
  subcategory: string | null;
};

type DetailResponse = {
  combinationId: string;
  colors: ColorItem[];
};

type ColorItemsResponse = {
  combinationId: string;
  color: ColorItem;
  totalProductCount: number;
  filteredProductCount: number;
  variantCount: number;
  filterOptions: {
    genders: string[];
    categories: string[];
    subcategories: string[];
  };
  items: ProductMatch[];
};

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const formatLabel = (value: string | null | undefined, fallback = "—") =>
  value && value.trim().length ? value : fallback;

type SelectOption = {
  value: string;
  label: string;
};

type FilterSelectProps = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
};

const FilterSelect = ({ label, value, options, onChange }: FilterSelectProps) => (
  <label className="block">
    <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
    >
      <option value="">Todos</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

type MultiSelectDropdownProps = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  onClear: () => void;
};

const MultiSelectDropdown = ({
  label,
  options,
  selected,
  onChange,
  onClear,
}: MultiSelectDropdownProps) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const toggleValue = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }
    onChange([...selected, value]);
  };

  return (
    <div className="relative space-y-2" ref={wrapperRef}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
        {selected.length ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-700"
          >
            Limpiar
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
      >
        <span>
          {selected.length ? `${selected.length} seleccionados` : `Selecciona ${label.toLowerCase()}`}
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-20 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {options.length ? (
            options.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                  checked={selected.includes(option)}
                  onChange={() => toggleValue(option)}
                />
                <span>{option}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-2 text-xs text-slate-400">Sin opciones disponibles.</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

type LazyImageProps = {
  src: string;
  alt: string;
  className?: string;
};

const LazyImage = ({ src, alt, className }: LazyImageProps) => {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isVisible) return;
    const node = holderRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div ref={holderRef} className="h-full w-full">
      {isVisible ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={className}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-slate-200" />
      )}
    </div>
  );
};

type ColorGroupSectionProps = {
  combinationId: string;
  color: ColorItem;
};

const PAGE_LIMIT = 24;

const ColorGroupSection = ({ combinationId, color }: ColorGroupSectionProps) => {
  const [genderFilter, setGenderFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string[]>([]);
  const [items, setItems] = useState<ProductMatch[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [variantCount, setVariantCount] = useState(0);
  const [filterOptions, setFilterOptions] = useState({
    genders: [] as string[],
    categories: [] as string[],
    subcategories: [] as string[],
  });
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const fetchItems = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("colorId", color.id);
        params.set("limit", String(PAGE_LIMIT));
        params.set("offset", String(reset ? 0 : page * PAGE_LIMIT));
        if (genderFilter.length) params.set("gender", genderFilter.join(","));
        if (categoryFilter.length) params.set("category", categoryFilter.join(","));
        if (subcategoryFilter.length) params.set("subcategory", subcategoryFilter.join(","));
        const res = await fetch(
          `/api/admin/color-combinations/${combinationId}/products?${params.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error("No se pudieron cargar los productos asociados");
        }
        const payload = (await res.json()) as ColorItemsResponse;
        setFilterOptions(payload.filterOptions);
        setTotalCount(payload.totalProductCount);
        setFilteredCount(payload.filteredProductCount);
        setVariantCount(payload.variantCount);
        if (reset) {
          setItems(payload.items ?? []);
          setPage(1);
        } else {
          setItems((prev) => [...prev, ...(payload.items ?? [])]);
          setPage((prev) => prev + 1);
        }
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado");
      } finally {
        setLoading(false);
      }
    },
    [
      color.id,
      combinationId,
      genderFilter,
      categoryFilter,
      subcategoryFilter,
      page,
    ],
  );

  useEffect(() => {
    if (loaded) return;
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          fetchItems(true);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchItems, loaded]);

  useEffect(() => {
    if (!loaded) return;
    setItems([]);
    setPage(0);
    fetchItems(true);
  }, [genderFilter, categoryFilter, subcategoryFilter]);

  const hasFilters = genderFilter.length + categoryFilter.length + subcategoryFilter.length > 0;
  const hasMore = items.length < filteredCount;

  const scrollBy = (delta: number) => {
    sliderRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (loading || !hasMore) return;
    const node = event.currentTarget;
    if (node.scrollLeft + node.clientWidth >= node.scrollWidth - 240) {
      fetchItems(false);
    }
  };

  return (
    <section className="space-y-4" ref={sectionRef}>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="h-12 w-12 rounded-xl border border-slate-200"
          style={{ backgroundColor: color.hex }}
        />
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {formatLabel(color.pantoneName)}
          </p>
          <p className="text-xs text-slate-500">
            {formatLabel(color.pantoneCode)} · {color.hex}
          </p>
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {loaded ? `${filteredCount} de ${totalCount} productos · ${variantCount} variantes` : "Cargando…"}
        </span>
      </div>

      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-3">
        <MultiSelectDropdown
          label="Género"
          options={filterOptions.genders}
          selected={genderFilter}
          onChange={(values) => setGenderFilter(values)}
          onClear={() => setGenderFilter([])}
        />
        <MultiSelectDropdown
          label="Categoría"
          options={filterOptions.categories}
          selected={categoryFilter}
          onChange={(values) => setCategoryFilter(values)}
          onClear={() => setCategoryFilter([])}
        />
        <MultiSelectDropdown
          label="Subcategoría"
          options={filterOptions.subcategories}
          selected={subcategoryFilter}
          onChange={(values) => setSubcategoryFilter(values)}
          onClear={() => setSubcategoryFilter([])}
        />
      </div>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => {
            setGenderFilter([]);
            setCategoryFilter([]);
            setSubcategoryFilter([]);
          }}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
        >
          Limpiar filtros del color
        </button>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : items.length ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Desliza para ver más productos o usa los botones.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollBy(-480)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => scrollBy(480)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
              >
                Siguiente
              </button>
            </div>
          </div>
          <div
            ref={sliderRef}
            onScroll={handleScroll}
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
          >
            {items.map((item) => (
              <div
                key={`${color.id}-${item.productId}`}
                className="min-w-[220px] max-w-[220px] snap-start overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <div className="aspect-[4/5] w-full bg-slate-100">
                  {item.imageUrl ? (
                    <LazyImage
                      src={item.imageUrl}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                      Sin imagen
                    </div>
                  )}
                </div>
                <div className="px-3 py-3">
                  <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">{formatLabel(item.brand)}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="min-w-[220px] max-w-[220px] animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
            )}
          </div>
          {hasMore && !loading ? (
            <button
              type="button"
              onClick={() => fetchItems(false)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
            >
              Cargar más
            </button>
          ) : null}
        </div>
      ) : loaded ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Sin productos asociados con estos filtros.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Cargando productos asociados…
        </div>
      )}
    </section>
  );
};

export default function ColorCombinationsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [season, setSeason] = useState(searchParams.get("season") ?? "");
  const [temperature, setTemperature] = useState(searchParams.get("temperature") ?? "");
  const [contrast, setContrast] = useState(searchParams.get("contrast") ?? "");
  const [mood, setMood] = useState(searchParams.get("mood") ?? "");
  const [page, setPage] = useState(parsePositiveInt(searchParams.get("page"), 1));
  const [items, setItems] = useState<CombinationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState<FilterOptions>({
    seasons: [],
    temperatures: [],
    contrasts: [],
    moods: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCombo, setActiveCombo] = useState<CombinationItem | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const suppressUrlRef = useRef(false);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (season) params.set("season", season);
    if (temperature) params.set("temperature", temperature);
    if (contrast) params.set("contrast", contrast);
    if (mood) params.set("mood", mood);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return params;
  }, [season, temperature, contrast, mood, page]);

  const fetchCombos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams();
      const res = await fetch(`/api/admin/color-combinations?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("No se pudieron cargar combinaciones");
      }
      const payload = (await res.json()) as ApiResponse;
      setItems(payload.items ?? []);
      setTotal(payload.total ?? 0);
      setTotalPages(payload.totalPages ?? 1);
      setFilters(
        payload.filters ?? { seasons: [], temperatures: [], contrasts: [], moods: [] },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchCombos();
  }, [fetchCombos]);

  useEffect(() => {
    if (suppressUrlRef.current) return;
    const params = buildParams();
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(`/admin/color-combinations?${next}`, { scroll: false });
    }
  }, [buildParams, router, searchParams]);

  useEffect(() => {
    setSeason((prev) =>
      prev === (searchParams.get("season") ?? "") ? prev : searchParams.get("season") ?? "",
    );
    setTemperature((prev) =>
      prev === (searchParams.get("temperature") ?? "")
        ? prev
        : searchParams.get("temperature") ?? "",
    );
    setContrast((prev) =>
      prev === (searchParams.get("contrast") ?? "")
        ? prev
        : searchParams.get("contrast") ?? "",
    );
    setMood((prev) =>
      prev === (searchParams.get("mood") ?? "") ? prev : searchParams.get("mood") ?? "",
    );
    setPage((prev) =>
      prev === parsePositiveInt(searchParams.get("page"), 1)
        ? prev
        : parsePositiveInt(searchParams.get("page"), 1),
    );
  }, [searchParams]);

  const clearFilters = () => {
    suppressUrlRef.current = true;
    setSeason("");
    setTemperature("");
    setContrast("");
    setMood("");
    setPage(1);
    suppressUrlRef.current = false;
  };

  const activeFilters = useMemo(
    () => [season, temperature, contrast, mood].filter(Boolean).length,
    [season, temperature, contrast, mood],
  );

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
  };

  const closeModal = () => {
    setActiveCombo(null);
    setDetail(null);
    setDetailError(null);
  };

  const openCombo = async (combo: CombinationItem) => {
    setActiveCombo(combo);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/color-combinations/${combo.id}/products`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("No se pudieron cargar los productos asociados");
      }
      const payload = (await res.json()) as DetailResponse;
      setDetail(payload);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Combinaciones de color</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Navega combinaciones de color con swatches y nombres Pantone. Usa los filtros para
            encontrar combinaciones por temporada, mood o temperatura.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total combos</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{total}</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Temporada"
            value={season}
            options={filters.seasons.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              setSeason(value);
              setPage(1);
            }}
          />
          <FilterSelect
            label="Temperatura"
            value={temperature}
            options={filters.temperatures.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              setTemperature(value);
              setPage(1);
            }}
          />
          <FilterSelect
            label="Contraste"
            value={contrast}
            options={filters.contrasts.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              setContrast(value);
              setPage(1);
            }}
          />
          <FilterSelect
            label="Mood"
            value={mood}
            options={filters.moods.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              setMood(value);
              setPage(1);
            }}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Filtros activos: {activeFilters}</span>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>
          Mostrando {items.length} de {total} combinaciones · página {page} de {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handlePageChange(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Cargando combinaciones…
        </div>
      ) : items.length ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((combo) => (
            <article
              key={combo.id}
              className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => openCombo(combo)}
            >
              <div className="grid gap-3">
                {combo.colors.map((color) => (
                  <div
                    key={color.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <div
                      className="h-14 w-full rounded-lg border border-slate-200"
                      style={{ backgroundColor: color.hex }}
                      title={color.hex}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {formatLabel(color.pantoneName)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                        {formatLabel(color.role, "sin rol")}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {formatLabel(color.pantoneCode)} · {color.hex}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No hay combinaciones para estos filtros.
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>
          Mostrando {items.length} de {total} combinaciones · página {page} de {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handlePageChange(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>

      {activeCombo && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
          onClick={closeModal}
        >
          <div
            className="mt-6 w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Combinación</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">Detalle de productos</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {formatLabel(activeCombo.season)} · {formatLabel(activeCombo.temperature)} · {formatLabel(activeCombo.contrast)} · {formatLabel(activeCombo.mood)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto px-6 py-6">
              {detailLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Cargando productos asociados…
                </div>
              ) : detailError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {detailError}
                </div>
              ) : detail ? (
                <div className="space-y-8">
                  {detail.colors.map((color) => (
                    <ColorGroupSection
                      key={color.id}
                      combinationId={detail.combinationId}
                      color={color}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Selecciona una combinación para ver detalles.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
