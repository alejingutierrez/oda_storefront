"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GENDER_OPTIONS,
  SEASON_OPTIONS,
} from "@/lib/product-enrichment/constants";
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
  taxonomyOptions: TaxonomyOptions | null;
  onClose: () => void;
  onApply: (payload: { changes: BulkChange[] }) => Promise<BulkResult>;
};

type Option = { value: string; label: string };

type ChangeDraft = {
  key: string;
  field: BulkField;
  op: BulkOperation;
  scalarValue: string;
  tagValues: string[];
};

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

const FIELD_LABELS = Object.fromEntries(FIELD_OPTIONS.map((entry) => [entry.value, entry.label])) as Record<
  BulkField,
  string
>;

const FIELD_KIND = Object.fromEntries(FIELD_OPTIONS.map((entry) => [entry.value, entry.kind])) as Record<
  BulkField,
  "scalar" | "array"
>;

const OP_LABELS: Record<BulkOperation, string> = {
  replace: "Reemplazar",
  add: "Agregar",
  remove: "Quitar",
  clear: "Limpiar",
};

const buildCategoryOptions = (taxonomy: TaxonomyOptions | null): Option[] =>
  (taxonomy?.data.categories ?? [])
    .filter((entry) => entry.isActive !== false)
    .map((entry) => ({ value: entry.key, label: entry.label ?? entry.key }));

const buildGenderOptions = (): Option[] => GENDER_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));

const buildSeasonOptions = (): Option[] => SEASON_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }));

const buildSubcategoryOptions = (taxonomy: TaxonomyOptions | null): Option[] =>
  (() => {
    const options = new Map<string, string>();
    for (const category of taxonomy?.data.categories ?? []) {
      for (const entry of category.subcategories ?? []) {
        if (entry.isActive === false) continue;
        const key = entry.key;
        if (!key) continue;
        if (!options.has(key)) options.set(key, entry.label ?? key);
      }
    }
    return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
  })();

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

function makeKey() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `chg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getAllowedOps(field: BulkField): BulkOperation[] {
  return FIELD_KIND[field] === "array" ? ["replace", "add", "remove", "clear"] : ["replace", "clear"];
}

function buildValuePreview(change: ChangeDraft, taxonomy: TaxonomyOptions | null): string {
  if (change.op === "clear") return "Se limpiará el campo.";
  if (FIELD_KIND[change.field] === "array") {
    if (!change.tagValues.length) return "—";
    return `${change.tagValues.length} valor(es)`;
  }

  const raw = change.scalarValue.trim();
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

export default function BulkEditModal({ open, selectedCount, taxonomyOptions, onClose, onApply }: Props) {
  const initialKey = useMemo(() => makeKey(), []);
  const [changes, setChanges] = useState<ChangeDraft[]>(() => [
    { key: initialKey, field: "category", op: "replace", scalarValue: "", tagValues: [] },
  ]);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const usedFields = useMemo(() => new Set(changes.map((change) => change.field)), [changes]);

  const duplicateFields = useMemo(() => {
    const counts = new Map<BulkField, number>();
    for (const change of changes) {
      counts.set(change.field, (counts.get(change.field) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([field]) => field);
  }, [changes]);

  const activeIndex = useMemo(() => {
    const found = changes.findIndex((change) => change.key === activeKey);
    return found >= 0 ? found : 0;
  }, [activeKey, changes]);

  const active = changes[activeIndex] ?? changes[0];

  const usedByOthers = useMemo(() => {
    const next = new Set<BulkField>();
    for (const change of changes) {
      if (change.key === active?.key) continue;
      next.add(change.field);
    }
    return next;
  }, [active?.key, changes]);

  const fieldMeta = useMemo(() => {
    const label = FIELD_LABELS[active.field] ?? active.field;
    const kind = FIELD_KIND[active.field];
    return { label, kind };
  }, [active.field]);

  const allowedOps = useMemo(() => getAllowedOps(active.field), [active.field]);
  const isArray = fieldMeta.kind === "array";

  useEffect(() => {
    if (!allowedOps.includes(active.op)) {
      setChanges((prev) =>
        prev.map((change) => (change.key === active.key ? { ...change, op: allowedOps[0] ?? "replace" } : change)),
      );
    }
  }, [active.key, active.op, allowedOps]);

  const changeSignature = useMemo(
    () =>
      changes
        .map((change) => `${change.field}:${change.op}:${change.scalarValue}:${change.tagValues.join(",")}`)
        .join("|"),
    [changes],
  );

  useEffect(() => {
    setError(null);
    setConfirming(false);
    setResult(null);
  }, [changeSignature, selectedCount]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const scalarOptions: Option[] | null = useMemo(() => {
    if (active.field === "category") return buildCategoryOptions(taxonomyOptions);
    if (active.field === "subcategory") return buildSubcategoryOptions(taxonomyOptions);
    if (active.field === "gender") return buildGenderOptions();
    if (active.field === "season") return buildSeasonOptions();
    if (active.field === "stylePrimary" || active.field === "styleSecondary") return buildStyleProfileOptions(taxonomyOptions);
    return null;
  }, [active.field, taxonomyOptions]);

  const tagOptions: Option[] | null = useMemo(() => {
    if (active.field === "styleTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.styleTags);
    if (active.field === "materialTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.materials);
    if (active.field === "patternTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.patterns);
    if (active.field === "occasionTags") return buildTagOptionsFromTerms(taxonomyOptions?.data.occasions);
    return null;
  }, [active.field, taxonomyOptions]);

  const addDisabled = useMemo(() => {
    const editableFields = FIELD_OPTIONS.filter((entry) => entry.editable).map((entry) => entry.value);
    return editableFields.every((field) => usedFields.has(field));
  }, [usedFields]);

  const applyDisabled = useMemo(() => {
    if (selectedCount <= 0) return true;
    if (!taxonomyOptions) return true;
    if (!changes.length) return true;
    if (duplicateFields.length > 0) return true;
    for (const change of changes) {
      if (change.op === "clear") continue;
      if (FIELD_KIND[change.field] === "array") {
        if (!change.tagValues.length) return true;
      } else {
        if (!change.scalarValue.trim().length) return true;
      }
    }
    return false;
  }, [changes, duplicateFields.length, selectedCount, taxonomyOptions]);

  const updateChange = (key: string, patch: Partial<ChangeDraft>) => {
    setChanges((prev) => prev.map((change) => (change.key === key ? { ...change, ...patch } : change)));
  };

  const handleAddChange = () => {
    const editableFields = FIELD_OPTIONS.filter((entry) => entry.editable).map((entry) => entry.value);
    const nextField = editableFields.find((field) => !usedFields.has(field));
    if (!nextField) return;
    const nextKey = makeKey();
    const next: ChangeDraft = { key: nextKey, field: nextField, op: "replace", scalarValue: "", tagValues: [] };
    setChanges((prev) => [...prev, next]);
    setActiveKey(nextKey);
  };

  const handleRemoveChange = (key: string) => {
    setChanges((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((change) => change.key !== key);
      if (activeKey === key) {
        setActiveKey(next[0]?.key ?? prev[0].key);
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (applyDisabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setApplying(true);
    setError(null);
    try {
      const payloadChanges: BulkChange[] = changes.map((change) => {
        const value =
          change.op === "clear"
            ? null
            : FIELD_KIND[change.field] === "array"
              ? change.tagValues
              : change.scalarValue.trim();
        return { field: change.field, op: change.op, value };
      });

      const response = await onApply({ changes: payloadChanges });
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
        className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Curación</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Editar en bloque (multi-cambios)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-6 py-6">
          <div className="grid gap-5 lg:grid-cols-[0.95fr,1.05fr]">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cambios</p>
                <button
                  type="button"
                  onClick={handleAddChange}
                  disabled={addDisabled}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  Agregar cambio
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {changes.map((change, index) => {
                  const activeItem = change.key === active.key;
                  const preview = buildValuePreview(change, taxonomyOptions);
                  return (
                    <div key={change.key} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveKey(change.key)}
                        className={classNames(
                          "flex-1 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                          activeItem ? "border-slate-900 bg-white text-slate-900" : "border-slate-200 bg-white text-slate-700",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0">
                            {index + 1}. {FIELD_LABELS[change.field] ?? change.field}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                            {OP_LABELS[change.op]}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs font-normal text-slate-500">{preview}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveChange(change.key)}
                        disabled={changes.length <= 1}
                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
                        title="Quitar cambio"
                      >
                        Quitar
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Previsualización</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-800">Productos:</span> {selectedCount}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Cambios:</span> {changes.length}
                  </p>
                  <div className="space-y-1 text-xs text-slate-600">
                    {changes.map((change) => (
                      <p key={change.key} className="truncate">
                        <span className="font-semibold text-slate-800">{FIELD_LABELS[change.field] ?? change.field}:</span>{" "}
                        {OP_LABELS[change.op]} · {buildValuePreview(change, taxonomyOptions)}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {!taxonomyOptions ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Cargando opciones de taxonomía… Si esto no termina, recarga la página o revisa sesión admin.
                </div>
              ) : null}

              {duplicateFields.length ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Hay cambios duplicados para:{" "}
                  <span className="font-semibold">
                    {duplicateFields.map((field) => FIELD_LABELS[field] ?? field).join(", ")}
                  </span>
                  . Deja cada característica solo una vez.
                </div>
              ) : null}

              {error ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
              ) : null}

              {result?.ok ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                  Aplicado. Actualizados: {result.updatedCount}. Sin cambios: {result.unchangedCount}.
                  {result.missingCount ? ` Faltantes: ${result.missingCount}.` : ""}
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Editar cambio</p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-field">
                    Característica
                  </label>
                  <select
                    id="bulk-field"
                    value={active.field}
                    onChange={(event) => {
                      const nextField = event.target.value as BulkField;
                      const nextAllowedOps = getAllowedOps(nextField);
                      updateChange(active.key, {
                        field: nextField,
                        op: nextAllowedOps.includes(active.op) ? active.op : nextAllowedOps[0] ?? "replace",
                        scalarValue: "",
                        tagValues: [],
                      });
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {FIELD_OPTIONS.filter((item) => item.editable).map((item) => (
                      <option key={item.value} value={item.value} disabled={usedByOthers.has(item.value)}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {usedByOthers.has(active.field) ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Esta característica ya está usada en otro cambio. Selecciona una diferente.
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-op">
                    Operación
                  </label>
                  <select
                    id="bulk-op"
                    value={active.op}
                    onChange={(event) => updateChange(active.key, { op: event.target.value as BulkOperation })}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {allowedOps.map((value) => (
                      <option key={value} value={value}>
                        {OP_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Valor</p>
                  <div className="mt-3">
                    {active.op === "clear" ? (
                      <p className="text-sm text-slate-600">
                        Esta operación dejará el campo vacío en los productos seleccionados.
                      </p>
                    ) : isArray && tagOptions ? (
                      <CheckboxList
                        options={tagOptions}
                        selected={active.tagValues}
                        onChange={(next) => updateChange(active.key, { tagValues: next })}
                        emptyLabel="Selecciona uno o más valores."
                      />
                    ) : scalarOptions ? (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-scalar">
                          Valor
                        </label>
                        <select
                          id="bulk-scalar"
                          value={active.scalarValue}
                          onChange={(event) => updateChange(active.key, { scalarValue: event.target.value })}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="">Selecciona…</option>
                          {scalarOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {active.field === "subcategory" && active.op === "replace" && !usedFields.has("category") ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Nota: si reemplazas subcategoría sin incluir categoría, se validará contra la categoría actual del producto.
                            Si estás mezclando categorías, agrega también un cambio de <code>category</code>.
                          </p>
                        ) : null}
                        {active.field === "category" && active.op === "replace" && !usedFields.has("subcategory") ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Nota: si un producto tiene una subcategoría incompatible, se limpiará automáticamente.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="bulk-text">
                          Valor
                        </label>
                        <input
                          id="bulk-text"
                          value={active.scalarValue}
                          onChange={(event) => updateChange(active.key, { scalarValue: event.target.value })}
                          placeholder="Escribe el valor…"
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          Campo libre. Se recomienda usarlo para notas estables (cuidado/origen).
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Resumen del cambio activo</p>
                  <div className="mt-3 space-y-1">
                    <p>
                      <span className="font-semibold text-slate-800">Acción:</span> {fieldMeta.label} · {OP_LABELS[active.op]}
                    </p>
                    <p className="truncate">
                      <span className="font-semibold text-slate-800">Valor:</span> {buildValuePreview(active, taxonomyOptions)}
                    </p>
                  </div>
                </div>
              </div>
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
              disabled={applyDisabled || applying}
              className={classNames(
                "rounded-full px-4 py-2 text-sm font-semibold",
                confirming ? "bg-rose-600 text-white" : "bg-slate-900 text-white",
                (applyDisabled || applying) && "opacity-50",
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
