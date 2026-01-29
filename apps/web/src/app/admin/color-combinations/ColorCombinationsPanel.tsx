"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

type ColorGroup = {
  color: ColorItem;
  productCount: number;
  variantCount: number;
  items: ProductMatch[];
};

type DetailResponse = {
  combinationId: string;
  colors: ColorItem[];
  groups: ColorGroup[];
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
                  {detail.groups.map((group) => (
                    <section key={group.color.id} className="space-y-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <div
                          className="h-12 w-12 rounded-xl border border-slate-200"
                          style={{ backgroundColor: group.color.hex }}
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {formatLabel(group.color.pantoneName)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatLabel(group.color.pantoneCode)} · {group.color.hex}
                          </p>
                        </div>
                        <span className="ml-auto text-xs text-slate-500">
                          {group.productCount} productos · {group.variantCount} variantes
                        </span>
                      </div>

                      {group.items.length ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {group.items.map((item) => (
                            <div
                              key={`${group.color.id}-${item.productId}`}
                              className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                            >
                              <div className="aspect-[4/5] w-full bg-slate-100">
                                {item.imageUrl ? (
                                  <img
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
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                          Sin productos asociados.
                        </div>
                      )}
                    </section>
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
