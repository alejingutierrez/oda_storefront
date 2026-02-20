"use client";

import { useMemo } from "react";
import type { TaxonomyOptions } from "@/lib/taxonomy/types";

type QueueItemStatus = "pending" | "applying" | "applied" | "failed" | "cancelled";
export type QueueStatusFilter = "all" | QueueItemStatus;

export type CurationQueueItem = {
  id: string;
  status: QueueItemStatus;
  orderIndex: number;
  note: string | null;
  source: string | null;
  targetScope: string | null;
  targetCount: number;
  targetIds: string[];
  searchKeySnapshot: string | null;
  changesJson: unknown;
  createdByEmail: string | null;
  lastError: string | null;
  createdAt: string;
  appliedAt: string | null;
};

type QueueSummary = {
  pending: number;
  applying: number;
  applied: number;
  failed: number;
  cancelled: number;
};

type QueueConflictInfo = {
  withIds: string[];
  overlapCount: number;
};

type Props = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  message: string | null;
  items: CurationQueueItem[];
  summary: QueueSummary;
  filter: QueueStatusFilter;
  selectedIds: string[];
  conflictsById: Record<string, QueueConflictInfo>;
  taxonomyOptions: TaxonomyOptions | null;
  onRefresh: () => void;
  onFilterChange: (next: QueueStatusFilter) => void;
  onToggleSelect: (id: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onApplyAll: () => void;
  onApplySelected: () => void;
  onApplySingle: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDeleteSingle: (id: string) => void;
  onDeleteSelected: () => void;
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const STATUS_LABELS: Record<QueueItemStatus, string> = {
  pending: "Pendiente",
  applying: "Aplicando",
  applied: "Aplicado",
  failed: "Falló",
  cancelled: "Cancelado",
};

const STATUS_BADGES: Record<QueueItemStatus, string> = {
  pending: "border-slate-200 bg-slate-50 text-slate-700",
  applying: "border-sky-200 bg-sky-50 text-sky-700",
  applied: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-amber-200 bg-amber-50 text-amber-800",
};

function normalizeChanges(changesJson: unknown): Array<{ field: string; op: string; value: unknown }> {
  if (!Array.isArray(changesJson)) return [];
  return changesJson
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      field: typeof entry.field === "string" ? entry.field : "unknown",
      op: typeof entry.op === "string" ? entry.op : "replace",
      value: entry.value,
    }));
}

function changeLabel(change: { field: string; op: string; value: unknown }, taxonomyOptions: TaxonomyOptions | null) {
  const fieldMap: Record<string, string> = {
    category: "Categoría",
    subcategory: "Subcategoría",
    gender: "Género",
    season: "Temporada",
    stylePrimary: "Estilo principal",
    styleSecondary: "Estilo secundario",
    styleTags: "Tags estilo",
    materialTags: "Materiales",
    patternTags: "Patrones",
    occasionTags: "Ocasiones",
    care: "Cuidado",
    origin: "Origen",
    editorialBadge: "Editorial",
  };

  if (change.field === "editorialBadge") {
    if (change.op === "clear") return "Editorial · limpiar";
    const value = change.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const kind = (value as { kind?: unknown }).kind;
      if (kind === "favorite") return "Editorial · ❤️ favorito";
      if (kind === "top_pick") return "Editorial · 👑 top pick";
    }
    return "Editorial";
  }

  const fieldLabel = fieldMap[change.field] ?? change.field;
  if (change.op === "clear") return `${fieldLabel} · limpiar`;

  if (change.field === "category" && typeof change.value === "string") {
    const label = taxonomyOptions?.categoryLabels?.[change.value] ?? change.value;
    return `${fieldLabel} · ${label}`;
  }

  if (change.field === "subcategory" && typeof change.value === "string") {
    const label = taxonomyOptions?.subcategoryLabels?.[change.value] ?? change.value;
    return `${fieldLabel} · ${label}`;
  }

  if ((change.field === "stylePrimary" || change.field === "styleSecondary") && typeof change.value === "string") {
    const label = taxonomyOptions?.styleProfileLabels?.[change.value] ?? change.value;
    return `${fieldLabel} · ${label}`;
  }

  if (Array.isArray(change.value)) {
    return `${fieldLabel} · ${change.op} (${change.value.length})`;
  }

  if (typeof change.value === "string") {
    return `${fieldLabel} · ${change.op} · ${change.value}`;
  }

  return `${fieldLabel} · ${change.op}`;
}

export default function CurationQueuePanel({
  loading,
  busy,
  error,
  message,
  items,
  summary,
  filter,
  selectedIds,
  conflictsById,
  taxonomyOptions,
  onRefresh,
  onFilterChange,
  onToggleSelect,
  onSelectAllVisible,
  onClearSelection,
  onApplyAll,
  onApplySelected,
  onApplySingle,
  onDuplicate,
  onDeleteSingle,
  onDeleteSelected,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pendingVisibleCount = useMemo(
    () => items.filter((item) => item.status === "pending").length,
    [items],
  );

  const selectedPendingCount = useMemo(
    () => items.filter((item) => selectedSet.has(item.id) && item.status === "pending").length,
    [items, selectedSet],
  );

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-24">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cola programada</p>
          <p className="mt-1 text-xs text-slate-600">Pendientes: {summary.pending.toLocaleString("es-CO")}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || busy}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["all", "Todos"],
            ["pending", `Pend (${summary.pending})`],
            ["failed", `Fallos (${summary.failed})`],
            ["applied", `Aplicados (${summary.applied})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={classNames(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              filter === key
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={onApplyAll}
          disabled={busy || summary.pending === 0}
          className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Aplicar todos
        </button>
        <button
          type="button"
          onClick={onApplySelected}
          disabled={busy || selectedPendingCount === 0}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          Aplicar seleccionados
        </button>
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={busy || selectedIds.length === 0}
          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
        >
          Eliminar seleccionados
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>{items.length.toLocaleString("es-CO")} operación(es) en vista</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAllVisible}
            disabled={items.length === 0 || busy}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600 disabled:opacity-50"
          >
            Seleccionar
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={selectedIds.length === 0 || busy}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600 disabled:opacity-50"
          >
            Limpiar
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
          No hay operaciones en esta vista.
        </div>
      ) : (
        <div className="mt-3 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {items.map((item) => {
            const conflict = conflictsById[item.id];
            const selected = selectedSet.has(item.id);
            const changes = normalizeChanges(item.changesJson);
            const canApplySingle = item.status === "pending";
            return (
              <article
                key={item.id}
                className={classNames(
                  "rounded-xl border bg-white p-3",
                  selected ? "border-slate-900 ring-1 ring-slate-900/20" : "border-slate-200",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSelect(item.id)}
                      className="mt-[2px] h-4 w-4 accent-slate-900"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-800">#{item.orderIndex} · {item.targetCount.toLocaleString("es-CO")} productos</span>
                      <span className="block text-[11px] text-slate-500">{item.source ?? "manual"}</span>
                    </span>
                  </label>
                  <span className={classNames("rounded-full border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em]", STATUS_BADGES[item.status])}>
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>

                {item.note ? <p className="mt-2 text-xs text-slate-700">{item.note}</p> : null}

                {changes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {changes.slice(0, 4).map((change, index) => (
                      <span
                        key={`${item.id}_${change.field}_${index}`}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700"
                      >
                        {changeLabel(change, taxonomyOptions)}
                      </span>
                    ))}
                    {changes.length > 4 ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">
                        +{changes.length - 4} más
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {conflict ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    Conflicto potencial con {conflict.withIds.length} operación(es) previa(s) sobre {conflict.overlapCount.toLocaleString("es-CO")} producto(s).
                  </p>
                ) : null}

                {item.lastError ? (
                  <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                    Error: {item.lastError}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  {canApplySingle ? (
                    <button
                      type="button"
                      onClick={() => onApplySingle(item.id)}
                      disabled={busy}
                      className="rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
                    >
                      Aplicar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDuplicate(item.id)}
                    disabled={busy}
                    className="rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSingle(item.id)}
                    disabled={busy}
                    className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                  <span className="ml-auto text-[10px] text-slate-400">
                    {new Date(item.createdAt).toLocaleString("es-CO", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingVisibleCount === 0 && filter === "pending" ? (
        <p className="mt-3 text-[11px] text-slate-500">No hay pendientes con este filtro.</p>
      ) : null}
    </aside>
  );
}
