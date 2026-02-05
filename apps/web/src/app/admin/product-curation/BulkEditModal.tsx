"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_OPTIONS,
  CATEGORY_LABELS,
  SUBCATEGORY_LABELS,
  SUBCATEGORY_VALUES,
  GENDER_OPTIONS,
  SEASON_OPTIONS,
  STYLE_TAGS,
  STYLE_TAG_FRIENDLY,
  MATERIAL_TAGS,
  MATERIAL_TAG_FRIENDLY,
  PATTERN_TAGS,
  PATTERN_TAG_FRIENDLY,
  OCCASION_TAGS,
  OCCASION_TAG_FRIENDLY,
} from "@/lib/product-enrichment/constants";
import { STYLE_PROFILES, STYLE_PROFILE_LABELS } from "@/lib/product-enrichment/style-profiles";

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
  onClose: () => void;
  onApply: (payload: {
    field: BulkField;
    op: BulkOperation;
    value: string | string[] | null;
  }) => Promise<BulkResult>;
};

type Option = { value: string; label: string };

const FIELD_OPTIONS: Array<{ value: BulkField; label: string; kind: "scalar" | "array"; editable: boolean }> = [
  { value: "category", label: "Categoría", kind: "scalar", editable: true },
  { value: "subcategory", label: "Subcategoría", kind: "scalar", editable: true },
  { value: "gender", label: "Género", kind: "scalar", editable: true },
  { value: "season", label: "Temporada", kind: "scalar", editable: true },
  { value: "stylePrimary", label: "Perfil de estilo (principal)", kind: "scalar", editable: true },
  { value: "styleSecondary", label: "Perfil de estilo (secundario)", kind: "scalar", editable: true },
  { value: "styleTags", label: "Tags de estilo", kind: "array", editable: true },
  { value: "materialTags", label: "Materiales", kind: "array", editable: true },
  { value: "patternTags", label: "Patrones", kind: "array", editable: true },
  { value: "occasionTags", label: "Ocasiones", kind: "array", editable: true },
  { value: "care", label: "Cuidado", kind: "scalar", editable: true },
  { value: "origin", label: "Origen", kind: "scalar", editable: true },
];

const OP_LABELS: Record<BulkOperation, string> = {
  replace: "Reemplazar",
  add: "Agregar",
  remove: "Quitar",
  clear: "Limpiar",
};

const buildCategoryOptions = (): Option[] =>
  CATEGORY_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));

const buildSubcategoryOptions = (): Option[] =>
  SUBCATEGORY_VALUES.map((value) => ({ value, label: SUBCATEGORY_LABELS[value] ?? value }));

const buildGenderOptions = (): Option[] => GENDER_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));

const buildSeasonOptions = (): Option[] => SEASON_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));

const buildStyleProfileOptions = (): Option[] =>
  STYLE_PROFILES.map((profile) => ({ value: profile.key, label: profile.label }));

const buildTagOptions = (values: string[], friendly: Record<string, string>): Option[] =>
  values.map((value) => ({ value, label: friendly[value] ?? value }));

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeUnique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
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

export default function BulkEditModal({ open, selectedCount, onClose, onApply }: Props) {
  const [field, setField] = useState<BulkField>("category");
  const [op, setOp] = useState<BulkOperation>("replace");
  const [scalarValue, setScalarValue] = useState<string>("");
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const fieldMeta = useMemo(() => FIELD_OPTIONS.find((item) => item.value === field), [field]);
  const isArray = fieldMeta?.kind === "array";

  const allowedOps = useMemo(() => {
    if (isArray) return (["replace", "add", "remove", "clear"] as BulkOperation[]);
    return (["replace", "clear"] as BulkOperation[]);
  }, [isArray]);

  useEffect(() => {
    if (!allowedOps.includes(op)) {
      setOp(allowedOps[0] ?? "replace");
    }
  }, [allowedOps, op]);

  useEffect(() => {
    setError(null);
    setConfirming(false);
    setResult(null);
  }, [field, op, scalarValue, tagValues]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const scalarOptions: Option[] | null = useMemo(() => {
    if (field === "category") return buildCategoryOptions();
    if (field === "subcategory") return buildSubcategoryOptions();
    if (field === "gender") return buildGenderOptions();
    if (field === "season") return buildSeasonOptions();
    if (field === "stylePrimary" || field === "styleSecondary") return buildStyleProfileOptions();
    return null;
  }, [field]);

  const tagOptions: Option[] | null = useMemo(() => {
    if (field === "styleTags") return buildTagOptions(STYLE_TAGS, STYLE_TAG_FRIENDLY);
    if (field === "materialTags") return buildTagOptions(MATERIAL_TAGS, MATERIAL_TAG_FRIENDLY);
    if (field === "patternTags") return buildTagOptions(PATTERN_TAGS, PATTERN_TAG_FRIENDLY);
    if (field === "occasionTags") return buildTagOptions(OCCASION_TAGS, OCCASION_TAG_FRIENDLY);
    return null;
  }, [field]);

  const isValid = useMemo(() => {
    if (selectedCount <= 0) return false;
    if (op === "clear") return true;
    if (isArray) return tagValues.length > 0;
    if (scalarOptions) return scalarValue.trim().length > 0;
    return scalarValue.trim().length > 0;
  }, [isArray, op, scalarOptions, scalarValue, selectedCount, tagValues.length]);

  const previewValue = useMemo(() => {
    if (op === "clear") return "Se limpiará el campo.";
    if (isArray) {
      if (!tagValues.length) return "—";
      return `${tagValues.length} valor(es)`;
    }
    if (!scalarValue.trim()) return "—";
    if (field === "category") return CATEGORY_LABELS[scalarValue] ?? scalarValue;
    if (field === "subcategory") return SUBCATEGORY_LABELS[scalarValue] ?? scalarValue;
    if (field === "stylePrimary" || field === "styleSecondary") return STYLE_PROFILE_LABELS[scalarValue] ?? scalarValue;
    return scalarValue;
  }, [field, isArray, op, scalarValue, tagValues.length]);

  const handleApply = async () => {
    if (!isValid) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setApplying(true);
    setError(null);
    try {
      const value =
        op === "clear" ? null : isArray ? tagValues : scalarValue.trim();
      const payload = { field, op, value };
      const response = await onApply(payload);
      setResult(response);
      if (!response.ok) {
        setError("No se pudo aplicar el bulk edit.");
      } else {
        setConfirming(false);
        onClose();
      }
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
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Curación</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Editar en bloque</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
          <div className="grid gap-5 lg:grid-cols-[0.9fr,1.1fr]">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Configuración</p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-field">
                    Característica
                  </label>
                  <select
                    id="bulk-field"
                    value={field}
                    onChange={(event) => setField(event.target.value as BulkField)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {FIELD_OPTIONS.filter((item) => item.editable).map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-op">
                    Operación
                  </label>
                  <select
                    id="bulk-op"
                    value={op}
                    onChange={(event) => setOp(event.target.value as BulkOperation)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {allowedOps.map((value) => (
                      <option key={value} value={value}>
                        {OP_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Previsualización</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold text-slate-800">Productos:</span> {selectedCount}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">Acción:</span>{" "}
                      {fieldMeta?.label ?? field} · {OP_LABELS[op]}
                    </p>
                    <p className="truncate">
                      <span className="font-semibold text-slate-800">Valor:</span> {previewValue}
                    </p>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                {result?.ok ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    Aplicado. Actualizados: {result.updatedCount}. Sin cambios: {result.unchangedCount}.
                    {result.missingCount ? ` Faltantes: ${result.missingCount}.` : ""}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Valores</p>

              <div className="mt-4">
                {op === "clear" ? (
                  <p className="text-sm text-slate-600">
                    Esta operación dejará el campo vacío en los productos seleccionados.
                  </p>
                ) : isArray && tagOptions ? (
                  <CheckboxList
                    options={tagOptions}
                    selected={tagValues}
                    onChange={setTagValues}
                    emptyLabel="Selecciona uno o más valores."
                  />
                ) : scalarOptions ? (
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-scalar">
                      Valor
                    </label>
                    <select
                      id="bulk-scalar"
                      value={scalarValue}
                      onChange={(event) => setScalarValue(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="">Selecciona…</option>
                      {scalarOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-text">
                      Valor
                    </label>
                    <input
                      id="bulk-text"
                      value={scalarValue}
                      onChange={(event) => setScalarValue(event.target.value)}
                      placeholder="Escribe el valor…"
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Campo libre. Se recomienda usarlo para notas estables (cuidado/origen).
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <p className="text-xs text-slate-500">
            No permite editar descripción ni campos SEO. Guarda trazabilidad en <code className="text-slate-700">metadata.enrichment_human</code>.
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
              disabled={!isValid || applying}
              className={classNames(
                "rounded-full px-4 py-2 text-sm font-semibold",
                confirming ? "bg-rose-600 text-white" : "bg-slate-900 text-white",
                (!isValid || applying) && "opacity-50",
              )}
            >
              {applying ? "Aplicando…" : confirming ? "Confirmar cambios" : "Aplicar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
