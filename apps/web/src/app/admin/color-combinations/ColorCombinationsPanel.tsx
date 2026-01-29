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
  layouts: string[];
  contrasts: string[];
};

type ApiResponse = {
  items: CombinationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: FilterOptions;
};

const parseCsv = (value: string | null) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length)
    : [];

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const toggleValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

const formatLabel = (value: string | null | undefined, fallback = "—") =>
  value && value.trim().length ? value : fallback;

export default function ColorCombinationsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialSeasons = parseCsv(searchParams.get("season"));
  const initialTemps = parseCsv(searchParams.get("temperature"));
  const initialLayouts = parseCsv(searchParams.get("layout"));
  const initialContrasts = parseCsv(searchParams.get("contrast"));
  const initialColorsCount = searchParams.get("colorsCount") ?? "";
  const initialPage = parsePositiveInt(searchParams.get("page"), 1);

  const [query, setQuery] = useState(initialQuery);
  const [seasons, setSeasons] = useState<string[]>(initialSeasons);
  const [temperatures, setTemperatures] = useState<string[]>(initialTemps);
  const [layouts, setLayouts] = useState<string[]>(initialLayouts);
  const [contrasts, setContrasts] = useState<string[]>(initialContrasts);
  const [colorsCount, setColorsCount] = useState(initialColorsCount);
  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState<CombinationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState<FilterOptions>({
    seasons: [],
    temperatures: [],
    layouts: [],
    contrasts: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suppressUrlRef = useRef(false);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim().length) params.set("q", query.trim());
    if (seasons.length) params.set("season", seasons.join(","));
    if (temperatures.length) params.set("temperature", temperatures.join(","));
    if (layouts.length) params.set("layout", layouts.join(","));
    if (contrasts.length) params.set("contrast", contrasts.join(","));
    if (colorsCount) params.set("colorsCount", colorsCount);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return params;
  }, [query, seasons, temperatures, layouts, contrasts, colorsCount, page]);

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
      setFilters(payload.filters ?? { seasons: [], temperatures: [], layouts: [], contrasts: [] });
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
    const nextQuery = searchParams.get("q") ?? "";
    const nextSeasons = parseCsv(searchParams.get("season"));
    const nextTemps = parseCsv(searchParams.get("temperature"));
    const nextLayouts = parseCsv(searchParams.get("layout"));
    const nextContrasts = parseCsv(searchParams.get("contrast"));
    const nextColorsCount = searchParams.get("colorsCount") ?? "";
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);

    setQuery((prev) => (prev === nextQuery ? prev : nextQuery));
    setSeasons((prev) => (prev.join(",") === nextSeasons.join(",") ? prev : nextSeasons));
    setTemperatures((prev) =>
      prev.join(",") === nextTemps.join(",") ? prev : nextTemps,
    );
    setLayouts((prev) => (prev.join(",") === nextLayouts.join(",") ? prev : nextLayouts));
    setContrasts((prev) =>
      prev.join(",") === nextContrasts.join(",") ? prev : nextContrasts,
    );
    setColorsCount((prev) => (prev === nextColorsCount ? prev : nextColorsCount));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
  }, [searchParams]);

  const clearFilters = () => {
    suppressUrlRef.current = true;
    setQuery("");
    setSeasons([]);
    setTemperatures([]);
    setLayouts([]);
    setContrasts([]);
    setColorsCount("");
    setPage(1);
    suppressUrlRef.current = false;
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
  };

  const colorCountOptions = [
    { value: "2", label: "Dúos (2)" },
    { value: "4", label: "Cuartetos (4)" },
  ];

  const activeFilters = useMemo(
    () => seasons.length + temperatures.length + layouts.length + contrasts.length + (colorsCount ? 1 : 0),
    [seasons, temperatures, layouts, contrasts, colorsCount],
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Combinaciones de color</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Explora combinaciones Pantone/HEX detectadas con Claude. Filtra por temporada,
            temperatura, layout o busca por nombre Pantone, código o hex.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total combos</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{total}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Buscar</label>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Pantone, nombre, hex o archivo"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
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

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Layout</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {filters.layouts.map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() => {
                  setLayouts((prev) => toggleValue(prev, layout));
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  layouts.includes(layout)
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {layout}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temporada</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {filters.seasons.map((season) => (
              <button
                key={season}
                type="button"
                onClick={() => {
                  setSeasons((prev) => toggleValue(prev, season));
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  seasons.includes(season)
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {season}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperatura</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {filters.temperatures.map((temp) => (
                <button
                  key={temp}
                  type="button"
                  onClick={() => {
                    setTemperatures((prev) => toggleValue(prev, temp));
                    setPage(1);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    temperatures.includes(temp)
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {temp}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Contraste</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {filters.contrasts.map((contrast) => (
                <button
                  key={contrast}
                  type="button"
                  onClick={() => {
                    setContrasts((prev) => toggleValue(prev, contrast));
                    setPage(1);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    contrasts.includes(contrast)
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {contrast}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cantidad de colores</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {colorCountOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setColorsCount((prev) => (prev === option.value ? "" : option.value));
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  colorsCount === option.value
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
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
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{combo.imageFilename}</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">
                    Combo {combo.comboKey} · {combo.colors.length} colores
                  </h3>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {combo.detectedLayout}
                </span>
              </header>

              <div className="mt-4 grid gap-3">
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

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600">
                  {formatLabel(combo.season)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600">
                  {formatLabel(combo.temperature)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600">
                  Contraste {formatLabel(combo.contrast)}
                </span>
                {combo.mood && (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600">
                    {combo.mood}
                  </span>
                )}
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
    </section>
  );
}
