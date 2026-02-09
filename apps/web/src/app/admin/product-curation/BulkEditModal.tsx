"use client";

import { useEffect, useMemo, useState } from "react";
import { GENDER_OPTIONS, SEASON_OPTIONS } from "@/lib/product-enrichment/constants";
import type { TaxonomyOptions, TaxonomyTerm } from "@/lib/taxonomy/types";

export type BulkOperation = "replace" | "add" | "remove" | "clear";
export type BulkField =
  | "category"
  | "subcategory"
  | "gender"
  | "season"
  | "stylePrimary"
  | "styleSecondary"
  | "styleTags"
  | "materialTags"
  | "patternTags"
  | "occasionTags"
  | "care"
  | "origin";

export type BulkChange = {
  field: BulkField;
  op: BulkOperation;
  value: string | string[] | null;
};

export type BulkResult = {
  ok: boolean;
  updatedCount: number;
  unchangedCount: number;
  missingCount: number;
  missingIds: string[];
};

type Props = {
  open: boolean;
  selectedCount: number;
  selectedIds: string[];
  categoriesFromFilters: string[];
  searchKey: string;
  taxonomyOptions: TaxonomyOptions | null;
  onClose: () => void;
  onApply: (payload: { productIds: string[]; changes: BulkChange[] }) => Promise<BulkResult>;
};

type Option = { value: string; label: string };
type Scope = "filtered" | "selected";
type Mode = "taxonomy" | "attributes" | "tags" | "notes";

const MAX_BULK_IDS = 1200;

const buildCategoryOptions = (taxonomy: TaxonomyOptions | null): Option[] =>
  (taxonomy?.data.categories ?? [])
    .filter((entry) => entry.isActive !== false)
    .map((entry) => ({ value: entry.key, label: entry.label ?? entry.key }));

const buildSubcategoryOptionsForCategory = (taxonomy: TaxonomyOptions | null, categoryKey: string): Option[] => {
  const key = categoryKey.trim();
  if (!key) return [];
  const category = (taxonomy?.data.categories ?? []).find((entry) => entry.key === key);
  const subs = category?.subcategories ?? [];
  return subs
    .filter((entry) => entry.isActive !== false)
    .map((entry) => ({ value: entry.key, label: entry.label ?? entry.key }));
};

const buildGenderOptions = (): Option[] => GENDER_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));
const buildSeasonOptions = (): Option[] => SEASON_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));
const buildStyleProfileOptions = (taxonomy: TaxonomyOptions | null): Option[] =>
  (taxonomy?.styleProfiles ?? []).map((profile) => ({ value: profile.key, label: profile.label ?? profile.key }));

const buildTagOptionsFromTerms = (terms: TaxonomyTerm[] | undefined, onlyActive = true): Option[] => {
  const list = Array.isArray(terms) ? terms : [];
  return list
    .filter((entry) => (onlyActive ? entry.isActive !== false : true))
    .map((entry) => ({ value: entry.key, label: entry.label ?? entry.key }));
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeUnique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function buildValuePreview(change: BulkChange, taxonomy: TaxonomyOptions | null): string {
  if (change.op === "clear") return "Se limpiará el campo.";
  if (Array.isArray(change.value)) {
    return change.value.length ? `${change.value.length} valor(es)` : "—";
  }
  const raw = typeof change.value === "string" ? change.value : "";
  if (!raw) return "—";
  if (change.field === "category") return taxonomy?.categoryLabels?.[raw] ?? raw;
  if (change.field === "subcategory") return taxonomy?.subcategoryLabels?.[raw] ?? raw;
  if (change.field === "stylePrimary" || change.field === "styleSecondary") return taxonomy?.styleProfileLabels?.[raw] ?? raw;
  return raw;
}

function CheckboxList({
  options,
  selected,
  onChange,
  emptyLabel,
}: {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tags-search">
            Buscar opciones
          </label>
          <input
            id="bulk-tags-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Escribe para filtrar…"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600"
          >
            Limpiar selección
          </button>
          <button
            type="button"
            onClick={() => {
              const visible = filtered.map((item) => item.value);
              onChange(normalizeUnique([...selected, ...visible]));
            }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600"
          >
            Seleccionar visibles
          </button>
        </div>
      </div>

      {selected.length ? (
        <div className="flex flex-wrap gap-2">
          {selected.slice(0, 16).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(selected.filter((item) => item !== value))}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
              title="Quitar"
            >
              {value}
            </button>
          ))}
          {selected.length > 16 ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
              +{selected.length - 16} más
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      )}

      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option.value)}
                onChange={() => {
                  const next = new Set(selectedSet);
                  if (next.has(option.value)) next.delete(option.value);
                  else next.add(option.value);
                  onChange(normalizeUnique(Array.from(next)));
                }}
                className="h-4 w-4 accent-slate-900"
              />
              <span className="min-w-0">{option.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BulkEditModal({
  open,
  selectedCount,
  selectedIds,
  categoriesFromFilters,
  searchKey,
  taxonomyOptions,
  onClose,
  onApply,
}: Props) {
  const [scope, setScope] = useState<Scope>("selected");
  const [mode, setMode] = useState<Mode>("taxonomy");
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const [filteredIds, setFilteredIds] = useState<string[]>([]);
  const [filteredHasMore, setFilteredHasMore] = useState(false);
  const [filteredLoading, setFilteredLoading] = useState(false);
  const [filteredError, setFilteredError] = useState<string | null>(null);

  const cleanedFilterCategories = useMemo(() => {
    const cleaned = categoriesFromFilters.map((value) => value.trim()).filter(Boolean);
    return Array.from(new Set(cleaned));
  }, [categoriesFromFilters]);

  const singleFilterCategory = cleanedFilterCategories.length === 1 ? cleanedFilterCategories[0] : "";

  // --- Taxonomy form state ---
  const [taxCategoryOp, setTaxCategoryOp] = useState<"replace" | "clear">("replace");
  const [taxCategory, setTaxCategory] = useState<string>("");
  const [taxSubOp, setTaxSubOp] = useState<"none" | "replace" | "clear">("none");
  const [taxSubcategory, setTaxSubcategory] = useState<string>("");

  // --- Attributes form state ---
  const [attrField, setAttrField] = useState<"gender" | "season" | "stylePrimary" | "styleSecondary">("gender");
  const [attrOp, setAttrOp] = useState<"replace" | "clear">("replace");
  const [attrValue, setAttrValue] = useState<string>("");

  // --- Tags form state ---
  const [tagField, setTagField] = useState<"styleTags" | "materialTags" | "patternTags" | "occasionTags">("styleTags");
  const [tagOp, setTagOp] = useState<BulkOperation>("add");
  const [tagValues, setTagValues] = useState<string[]>([]);

  // --- Notes form state ---
  const [noteField, setNoteField] = useState<"care" | "origin">("care");
  const [noteOp, setNoteOp] = useState<"replace" | "clear">("replace");
  const [noteValue, setNoteValue] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setConfirming(false);
    setScope(selectedIds.length > 0 ? "selected" : "filtered");
    setMode("taxonomy");
  }, [open, selectedIds.length]);

  useEffect(() => {
    if (!open) return;
    // Initialize taxonomy defaults from filters (common case: filter a single category and bulk assign subcategory).
    setTaxCategoryOp("replace");
    setTaxCategory(singleFilterCategory);
    setTaxSubOp("none");
    setTaxSubcategory("");

    setAttrField("gender");
    setAttrOp("replace");
    setAttrValue("");

    setTagField("styleTags");
    setTagOp("add");
    setTagValues([]);

    setNoteField("care");
    setNoteOp("replace");
    setNoteValue("");
  }, [open, singleFilterCategory]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const fetchFilteredIds = async () => {
    setFilteredLoading(true);
    setFilteredError(null);
    try {
      const params = new URLSearchParams(searchKey);
      params.set("limit", String(MAX_BULK_IDS));
      const url = `/api/admin/product-curation/ids?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ?? "No se pudieron cargar IDs del filtro");
      }
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id: unknown) => typeof id === "string") : [];
      setFilteredIds(ids);
      setFilteredHasMore(Boolean(payload?.hasMore));
    } catch (err) {
      console.warn(err);
      setFilteredIds([]);
      setFilteredHasMore(false);
      setFilteredError(err instanceof Error ? err.message : "No se pudieron cargar IDs del filtro");
    } finally {
      setFilteredLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (scope !== "filtered") return;
    fetchFilteredIds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, searchKey]);

  const targetIds = useMemo(() => (scope === "selected" ? selectedIds : filteredIds), [filteredIds, scope, selectedIds]);
  const targetCount = targetIds.length;
  const overLimit = targetCount > MAX_BULK_IDS;

  const categoryOptions = useMemo(() => buildCategoryOptions(taxonomyOptions), [taxonomyOptions]);
  const subcategoryOptions = useMemo(
    () => buildSubcategoryOptionsForCategory(taxonomyOptions, taxCategoryOp === "replace" ? taxCategory : ""),
    [taxCategory, taxCategoryOp, taxonomyOptions],
  );

  const attributeValueOptions = useMemo(() => {
    if (attrField === "gender") return buildGenderOptions();
    if (attrField === "season") return buildSeasonOptions();
    if (attrField === "stylePrimary" || attrField === "styleSecondary") return buildStyleProfileOptions(taxonomyOptions);
    return [];
  }, [attrField, taxonomyOptions]);

  const tagOptions = useMemo(() => {
    if (tagField === "styleTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.styleTags);
    if (tagField === "materialTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.materials);
    if (tagField === "patternTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.patterns);
    if (tagField === "occasionTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.occasions);
    return [];
  }, [tagField, taxonomyOptions]);

  const changes = useMemo((): BulkChange[] => {
    if (mode === "taxonomy") {
      const out: BulkChange[] = [];
      if (taxCategoryOp === "clear") {
        out.push({ field: "category", op: "clear", value: null });
      } else if (taxCategory.trim()) {
        out.push({ field: "category", op: "replace", value: taxCategory.trim() });
      }

      if (taxSubOp === "clear") {
        out.push({ field: "subcategory", op: "clear", value: null });
      } else if (taxSubOp === "replace" && taxSubcategory.trim()) {
        out.push({ field: "subcategory", op: "replace", value: taxSubcategory.trim() });
      }
      return out;
    }

    if (mode === "attributes") {
      if (attrOp === "clear") return [{ field: attrField, op: "clear", value: null }];
      return [{ field: attrField, op: "replace", value: attrValue.trim() }];
    }

    if (mode === "tags") {
      if (tagOp === "clear") return [{ field: tagField, op: "clear", value: null }];
      return [{ field: tagField, op: tagOp, value: tagValues }];
    }

    // notes
    if (noteOp === "clear") return [{ field: noteField, op: "clear", value: null }];
    return [{ field: noteField, op: "replace", value: noteValue.trim() }];
  }, [
    attrField,
    attrOp,
    attrValue,
    mode,
    noteField,
    noteOp,
    noteValue,
    tagField,
    tagOp,
    tagValues,
    taxCategory,
    taxCategoryOp,
    taxSubOp,
    taxSubcategory,
  ]);

  const validationError = useMemo(() => {
    if (!open) return null;
    if (!taxonomyOptions) return "Cargando opciones de taxonomía…";
    if (targetCount <= 0) return "No hay productos objetivo para aplicar cambios.";
    if (overLimit) return `La selección excede el límite (${MAX_BULK_IDS.toLocaleString("es-CO")}).`;
    if (scope === "filtered" && filteredLoading) return "Cargando IDs del filtro…";
    if (scope === "filtered" && filteredError) return filteredError;

    if (mode === "taxonomy") {
      if (taxCategoryOp === "replace" && !taxCategory.trim()) {
        return "Selecciona una categoría (o usa Limpiar).";
      }
      if (taxSubOp === "replace") {
        if (taxCategoryOp !== "replace" || !taxCategory.trim()) return "Para asignar subcategoría, primero define una categoría.";
        if (!taxSubcategory.trim()) return "Selecciona una subcategoría (o usa No tocar/Limpiar).";
      }
    }

    if (mode === "attributes") {
      if (attrOp === "replace" && !attrValue.trim()) return "Selecciona un valor para el atributo.";
    }

    if (mode === "tags") {
      if (tagOp !== "clear" && tagValues.length === 0) return "Selecciona uno o más tags (o usa Limpiar).";
    }

    if (mode === "notes") {
      if (noteOp === "replace" && !noteValue.trim()) return "Escribe un valor (o usa Limpiar).";
    }

    if (changes.length === 0) return "Define al menos un cambio.";

    return null;
  }, [
    attrOp,
    attrValue,
    changes.length,
    filteredError,
    filteredLoading,
    mode,
    noteOp,
    noteValue,
    open,
    overLimit,
    scope,
    tagOp,
    tagValues.length,
    targetCount,
    taxCategory,
    taxCategoryOp,
    taxSubOp,
    taxSubcategory,
    taxonomyOptions,
  ]);

  const applyDisabled = Boolean(validationError) || applying;

  const scopeLabel = useMemo(() => {
    if (scope === "selected") return `Selección (${selectedCount.toLocaleString("es-CO")})`;
    const suffix = filteredLoading ? "…" : `(${targetCount.toLocaleString("es-CO")})`;
    return `Filtro actual ${suffix}`;
  }, [filteredLoading, scope, selectedCount, targetCount]);

  const handleApply = async () => {
    if (applyDisabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setApplying(true);
    setError(null);
    try {
      const response = await onApply({ productIds: targetIds, changes });
      setResult(response);
      if (!response.ok) {
        setError("No se pudo aplicar el bulk edit.");
        return;
      }
      setConfirming(false);
      onClose();
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Curación</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Editar en bloque</h3>
            <p className="mt-1 text-xs text-slate-500">Aplicar a: {scopeLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-6 py-6">
          <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
            <section className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Objetivo</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setScope("filtered")}
                    className={classNames(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      scope === "filtered" ? "border-slate-900 bg-white text-slate-900" : "border-slate-200 bg-white text-slate-600",
                    )}
                  >
                    Filtro actual
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope("selected")}
                    disabled={selectedIds.length === 0}
                    className={classNames(
                      "rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50",
                      scope === "selected" ? "border-slate-900 bg-white text-slate-900" : "border-slate-200 bg-white text-slate-600",
                    )}
                  >
                    Selección
                  </button>
                  {scope === "filtered" ? (
                    <button
                      type="button"
                      onClick={fetchFilteredIds}
                      disabled={filteredLoading}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
                      title="Recargar IDs del filtro"
                    >
                      {filteredLoading ? "Cargando…" : "Actualizar"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-800">Productos objetivo:</span>{" "}
                    {scope === "filtered" && filteredLoading ? "…" : targetCount.toLocaleString("es-CO")}
                    <span className="ml-2 text-xs text-slate-500">(máx {MAX_BULK_IDS.toLocaleString("es-CO")})</span>
                  </p>
                  {scope === "filtered" && filteredHasMore ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                      Hay más resultados que el límite. Este bulk edit aplica solo a los primeros {MAX_BULK_IDS.toLocaleString("es-CO")} (según el sort actual).
                    </p>
                  ) : null}
                  {scope === "selected" && selectedIds.length > 0 ? (
                    <p className="text-xs text-slate-500">
                      Tip: si quieres editar todo el filtro, usa la pestaña <span className="font-semibold">Filtro actual</span> (sin seleccionar manualmente).
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Qué quieres cambiar</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(
                    [
                      { key: "taxonomy", label: "Taxonomía" },
                      { key: "attributes", label: "Atributos" },
                      { key: "tags", label: "Tags" },
                      { key: "notes", label: "Notas" },
                    ] as const
                  ).map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => setMode(entry.key)}
                      className={classNames(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        mode === entry.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vista previa</p>
                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {changes.length ? (
                    <div className="space-y-1 text-xs text-slate-600">
                      {changes.map((change) => (
                        <p key={change.field}>
                          <span className="font-semibold text-slate-800">{change.field}:</span> {change.op} ·{" "}
                          {buildValuePreview(change, taxonomyOptions)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">—</p>
                  )}
                </div>

                {validationError ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {validationError}
                  </div>
                ) : null}
                {error ? (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}
                {result?.ok ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Aplicado. Actualizados: {result.updatedCount}. Sin cambios: {result.unchangedCount}.
                    {result.missingCount ? ` Faltantes: ${result.missingCount}.` : ""}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="space-y-5">
              {mode === "taxonomy" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Taxonomía (categoría + subcategoría)</p>

                  {singleFilterCategory && taxCategoryOp === "replace" && taxCategory === singleFilterCategory ? (
                    <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                      Detectado desde filtro:{" "}
                      <span className="font-semibold text-slate-800">
                        {taxonomyOptions?.categoryLabels?.[singleFilterCategory] ?? singleFilterCategory}
                      </span>
                      . Subcategorías se acotan automáticamente.
                    </p>
                  ) : null}

                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tax-cat-op">
                        Acción categoría
                      </label>
                      <select
                        id="bulk-tax-cat-op"
                        value={taxCategoryOp}
                        onChange={(event) => setTaxCategoryOp(event.target.value as any)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="replace">Reemplazar</option>
                        <option value="clear">Limpiar</option>
                      </select>
                    </div>

                    {taxCategoryOp === "replace" ? (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tax-category">
                          Categoría
                        </label>
                        <select
                          id="bulk-tax-category"
                          value={taxCategory}
                          onChange={(event) => {
                            const next = event.target.value;
                            setTaxCategory(next);
                            setTaxSubcategory("");
                            if (taxSubOp === "replace") setTaxSubOp("none");
                          }}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="">Selecciona…</option>
                          {categoryOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tax-sub-op">
                        Acción subcategoría
                      </label>
                      <select
                        id="bulk-tax-sub-op"
                        value={taxSubOp}
                        onChange={(event) => setTaxSubOp(event.target.value as any)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="none">No tocar</option>
                        <option value="replace">Reemplazar</option>
                        <option value="clear">Limpiar</option>
                      </select>
                      <p className="mt-2 text-xs text-slate-500">
                        Recomendación: si estás asignando subcategoría, mantén categoría en “Reemplazar” para que quede consistente.
                      </p>
                    </div>

                    {taxSubOp === "replace" ? (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tax-subcategory">
                          Subcategoría
                        </label>
                        <select
                          id="bulk-tax-subcategory"
                          value={taxSubcategory}
                          onChange={(event) => setTaxSubcategory(event.target.value)}
                          disabled={taxCategoryOp !== "replace" || !taxCategory.trim()}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
                        >
                          <option value="">
                            {taxCategoryOp !== "replace" || !taxCategory.trim()
                              ? "Selecciona categoría primero…"
                              : "Selecciona…"}
                          </option>
                          {subcategoryOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {mode === "attributes" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Atributos (scalar)</p>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-attr-field">
                        Campo
                      </label>
                      <select
                        id="bulk-attr-field"
                        value={attrField}
                        onChange={(event) => {
                          const next = event.target.value as any;
                          setAttrField(next);
                          setAttrOp("replace");
                          setAttrValue("");
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="gender">Género</option>
                        <option value="season">Temporada</option>
                        <option value="stylePrimary">Perfil de estilo (principal)</option>
                        <option value="styleSecondary">Perfil de estilo (secundario)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-attr-op">
                        Operación
                      </label>
                      <select
                        id="bulk-attr-op"
                        value={attrOp}
                        onChange={(event) => setAttrOp(event.target.value as any)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="replace">Reemplazar</option>
                        <option value="clear">Limpiar</option>
                      </select>
                    </div>

                    {attrOp === "replace" ? (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-attr-value">
                          Valor
                        </label>
                        <select
                          id="bulk-attr-value"
                          value={attrValue}
                          onChange={(event) => setAttrValue(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="">Selecciona…</option>
                          {attributeValueOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {mode === "tags" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tags (arrays)</p>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tag-field">
                        Campo
                      </label>
                      <select
                        id="bulk-tag-field"
                        value={tagField}
                        onChange={(event) => {
                          const next = event.target.value as any;
                          setTagField(next);
                          setTagValues([]);
                          setTagOp("add");
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="styleTags">Tags de estilo</option>
                        <option value="materialTags">Materiales</option>
                        <option value="patternTags">Patrones</option>
                        <option value="occasionTags">Ocasiones</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-tag-op">
                        Operación
                      </label>
                      <select
                        id="bulk-tag-op"
                        value={tagOp}
                        onChange={(event) => setTagOp(event.target.value as any)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="add">Agregar</option>
                        <option value="remove">Quitar</option>
                        <option value="replace">Reemplazar</option>
                        <option value="clear">Limpiar</option>
                      </select>
                    </div>

                    {tagOp === "clear" ? (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Esta operación limpiará el array completo.
                      </p>
                    ) : (
                      <CheckboxList
                        options={tagOptions}
                        selected={tagValues}
                        onChange={setTagValues}
                        emptyLabel="Selecciona uno o más valores."
                      />
                    )}
                  </div>
                </div>
              ) : null}

              {mode === "notes" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notas (texto)</p>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-note-field">
                        Campo
                      </label>
                      <select
                        id="bulk-note-field"
                        value={noteField}
                        onChange={(event) => {
                          const next = event.target.value as any;
                          setNoteField(next);
                          setNoteOp("replace");
                          setNoteValue("");
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="care">Cuidado</option>
                        <option value="origin">Origen</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-note-op">
                        Operación
                      </label>
                      <select
                        id="bulk-note-op"
                        value={noteOp}
                        onChange={(event) => setNoteOp(event.target.value as any)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="replace">Reemplazar</option>
                        <option value="clear">Limpiar</option>
                      </select>
                    </div>

                    {noteOp === "replace" ? (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-note-value">
                          Valor
                        </label>
                        <input
                          id="bulk-note-value"
                          value={noteValue}
                          onChange={(event) => setNoteValue(event.target.value)}
                          placeholder="Escribe el valor…"
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                        <p className="mt-2 text-xs text-slate-500">Campo libre. Útil para notas estables.</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <p className="text-xs text-slate-500">
            No permite editar descripción ni campos SEO. Guarda trazabilidad en{" "}
            <code className="text-slate-700">metadata.enrichment_human</code>.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applyDisabled}
              className={classNames(
                "rounded-full px-4 py-2 text-sm font-semibold",
                confirming ? "bg-rose-600 text-white" : "bg-slate-900 text-white",
                applyDisabled && "opacity-50",
              )}
              title={validationError ?? undefined}
            >
              {applying ? "Aplicando…" : confirming ? "Confirmar cambios" : "Aplicar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

