"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TaxonomyCategory = { key: string; label: string; isActive?: boolean };
type TaxonomyOptions = {
  data?: { categories?: TaxonomyCategory[] };
  categoryLabels?: Record<string, string>;
};

type RunSummary = {
  runId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  lastError?: string | null;
};

type RunMeta = {
  id: string;
  status: string;
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
  lastError?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  schemaVersion?: string | null;
  createdBy?: string | null;
  requestedItems?: number | null;
  selectedItems?: number | null;
  onlyMissing?: boolean;
  filters?: unknown;
};

type ItemCounts = Record<string, number>;

type RecentItem = {
  id: string;
  path: string;
  status: string;
  attempts: number;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
};

type CandidatePageRow = {
  path: string;
  genderSlug: string;
  categoryKey: string | null;
  subcategoryKey: string | null;
  productCount: number;
  status: "missing" | "ready" | "failed";
  page:
    | {
        updatedAt: string;
        provider: string | null;
        model: string | null;
      }
    | null;
  lastAttempt:
    | {
        status: string | null;
        updatedAt: string;
        error: string | null;
      }
    | null;
};

type PlpSeoPage = {
  path: string;
  genderSlug: string;
  categoryKey: string | null;
  subcategoryKey: string | null;
  metaTitle: string;
  metaDescription: string;
  subtitle: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  inputHash: string;
  updatedAt: string;
};

const GENDER_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "femenino", label: "Femenino" },
  { value: "masculino", label: "Masculino" },
  { value: "unisex", label: "Unisex" },
  { value: "infantil", label: "Infantil" },
] as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("es-CO");
  } catch {
    return value;
  }
}

function StatusPill({ status }: { status: CandidatePageRow["status"] }) {
  const style =
    status === "ready"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : status === "failed"
        ? "bg-rose-100 text-rose-800 border-rose-200"
        : "bg-slate-100 text-slate-700 border-slate-200";
  const label = status === "ready" ? "Ready" : status === "failed" ? "Failed" : "Missing";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

function ProgressBar({ summary }: { summary: RunSummary | null }) {
  if (!summary) return null;
  const total = summary.total ?? 0;
  const completed = summary.completed ?? 0;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {completed}/{total} completados ({percent}%)
        </span>
        <span className="font-mono">{summary.status}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-slate-900" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function PlpSeoPanel() {
  const [taxonomy, setTaxonomy] = useState<TaxonomyOptions | null>(null);
  const [genderSlug, setGenderSlug] = useState<string>("");
  const [categoryKey, setCategoryKey] = useState<string>("");
  const [onlyMissing, setOnlyMissing] = useState(true);

  const [pages, setPages] = useState<CandidatePageRow[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);

  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [itemCounts, setItemCounts] = useState<ItemCounts | null>(null);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [stateError, setStateError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [editing, setEditing] = useState<PlpSeoPage | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSavedAt, setEditSavedAt] = useState<string | null>(null);

  const categories = useMemo(() => {
    const list = taxonomy?.data?.categories ?? [];
    return list.filter((cat) => cat && cat.isActive !== false);
  }, [taxonomy]);

  const fetchTaxonomy = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/taxonomy/options", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setTaxonomy(payload.options ?? null);
    } catch {
      setTaxonomy(null);
    }
  }, []);

  const fetchPages = useCallback(async () => {
    setPagesLoading(true);
    setPagesError(null);
    try {
      const params = new URLSearchParams();
      if (genderSlug) params.set("genderSlug", genderSlug);
      if (categoryKey) params.set("categoryKey", categoryKey);
      params.set("onlyMissing", onlyMissing ? "true" : "false");
      params.set("limit", "240");
      const res = await fetch(`/api/admin/plp-seo/pages?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudieron cargar PLPs");
      }
      const payload = await res.json();
      setPages((payload.pages ?? []) as CandidatePageRow[]);
    } catch (err) {
      setPages([]);
      setPagesError(err instanceof Error ? err.message : "No se pudieron cargar PLPs");
    } finally {
      setPagesLoading(false);
    }
  }, [genderSlug, categoryKey, onlyMissing]);

  const fetchState = useCallback(async () => {
    setStateError(null);
    try {
      const res = await fetch("/api/admin/plp-seo/state", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setSummary(payload.summary ?? null);
      setRunMeta(payload.run ?? null);
      setItemCounts(payload.itemCounts ?? null);
      setRecentItems((payload.recentItems ?? []) as RecentItem[]);
    } catch (err) {
      setStateError(err instanceof Error ? err.message : "No se pudo cargar el estado");
    }
  }, []);

  const loadEditPage = useCallback(async (path: string) => {
    setEditLoading(true);
    setEditError(null);
    setEditSavedAt(null);
    try {
      const res = await fetch(`/api/admin/plp-seo/page?path=${encodeURIComponent(path)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo cargar la PLP");
      }
      const payload = await res.json();
      const page = payload.page as PlpSeoPage | null;
      setEditing(page);
      setEditTitle(page?.metaTitle ?? "");
      setEditDescription(page?.metaDescription ?? "");
      setEditSubtitle(page?.subtitle ?? "");
    } catch (err) {
      setEditing(null);
      setEditTitle("");
      setEditDescription("");
      setEditSubtitle("");
      setEditError(err instanceof Error ? err.message : "No se pudo cargar la PLP");
    } finally {
      setEditLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTaxonomy();
  }, [fetchTaxonomy]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    const queued = itemCounts?.queued ?? 0;
    const inProgress = itemCounts?.in_progress ?? 0;
    if (summary?.status !== "processing" && queued + inProgress === 0) return;
    const interval = window.setInterval(() => {
      fetchState();
      fetchPages();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [fetchPages, fetchState, itemCounts, summary?.status]);

  useEffect(() => {
    if (!selectedPath) return;
    loadEditPage(selectedPath);
  }, [loadEditPage, selectedPath]);

  const runBatch = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      const body = {
        genderSlug: genderSlug || null,
        categoryKey: categoryKey || null,
        onlyMissing,
        batchSize: 20,
      };
      const res = await fetch("/api/admin/plp-seo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo iniciar la corrida");
      }
      await fetchState();
      await fetchPages();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo iniciar la corrida");
    } finally {
      setActionLoading(false);
    }
  };

  const saveManual = async () => {
    if (!selectedPath) return;
    setEditLoading(true);
    setEditError(null);
    setEditSavedAt(null);
    try {
      const res = await fetch("/api/admin/plp-seo/page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedPath,
          metaTitle: editTitle,
          metaDescription: editDescription,
          subtitle: editSubtitle,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(payload.details) ? payload.details.join(", ") : "";
        throw new Error(details ? `${payload.error}: ${details}` : payload.error || "No se pudo guardar");
      }
      setEditing(payload.page ?? null);
      setEditSavedAt(new Date().toISOString());
      await fetchPages();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setEditLoading(false);
    }
  };

  const selectedRow = useMemo(() => pages.find((row) => row.path === selectedPath) ?? null, [pages, selectedPath]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Género</p>
            <select
              value={genderSlug}
              onChange={(e) => setGenderSlug(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
              disabled={actionLoading}
            >
              {GENDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Categoría</p>
            <select
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
              disabled={actionLoading}
            >
              <option value="">Todas</option>
              {categories.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch</p>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-700">Solo faltantes</span>
              <input
                type="checkbox"
                checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.target.checked)}
                className="h-4 w-4"
                disabled={actionLoading}
              />
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runBatch}
            disabled={actionLoading}
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionLoading ? "Generando…" : "Generar batch (20)"}
          </button>
          <button
            type="button"
            onClick={() => {
              fetchPages();
              fetchState();
            }}
            disabled={actionLoading}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Refrescar
          </button>
          {actionError ? <p className="text-sm text-rose-600">{actionError}</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Estado</p>
            <p className="mt-2 text-sm text-slate-700">
              Run: <span className="font-mono">{runMeta?.id ?? "—"}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Provider/model:{" "}
              <span className="font-mono">
                {runMeta?.provider ?? "—"}/{runMeta?.model ?? "—"}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Prompt/schema:{" "}
              <span className="font-mono">
                {runMeta?.promptVersion ?? "—"} / {runMeta?.schemaVersion ?? "—"}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Actualizado: {formatDateTime(runMeta?.updatedAt)}
            </p>
          </div>

          <div className="w-full max-w-sm">
            <ProgressBar summary={summary} />
            {summary?.lastError ? (
              <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {summary.lastError}
              </p>
            ) : null}
          </div>
        </div>

        {stateError ? <p className="mt-4 text-sm text-rose-600">{stateError}</p> : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">PLPs</p>
              <p className="mt-1 text-sm text-slate-700">
                {pagesLoading ? "Cargando…" : `${pages.length.toLocaleString("es-CO")} filas`}
              </p>
            </div>
            {pagesError ? <p className="text-sm text-rose-600">{pagesError}</p> : null}
          </div>

          <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Path</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Productos</th>
                  <th className="px-4 py-3">Últ. update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pages.map((row) => {
                  const selected = row.path === selectedPath;
                  return (
                    <tr
                      key={row.path}
                      className={selected ? "bg-slate-900/5" : "bg-white"}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedPath(row.path)}
                          className="max-w-[520px] truncate text-left font-mono text-xs text-slate-900 underline decoration-slate-300 underline-offset-2"
                          title={row.path}
                        >
                          {row.path}
                        </button>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {row.page ? (
                            <span className="font-mono">
                              {row.page.provider ?? "—"}/{row.page.model ?? "—"}
                            </span>
                          ) : row.lastAttempt ? (
                            <span className="font-mono">
                              last: {row.lastAttempt.status ?? "—"}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-4 py-3">{row.productCount.toLocaleString("es-CO")}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatDateTime(row.page?.updatedAt ?? row.lastAttempt?.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
                {!pagesLoading && pages.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                      No hay resultados con esos filtros.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Editor manual
          </p>

          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-mono text-xs">{selectedPath || "Selecciona una PLP"}</p>
            {selectedRow ? (
              <p className="mt-2 text-xs text-slate-500">
                Estado: <span className="font-mono">{selectedRow.status}</span> · Productos:{" "}
                <span className="font-mono">{selectedRow.productCount}</span>
              </p>
            ) : null}
          </div>

          {editError ? (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {editError}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3">
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Meta title (max 70)
              </span>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
                disabled={!selectedPath || editLoading}
              />
              <span className="text-[11px] text-slate-400">{editTitle.trim().length} chars</span>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Meta description (120-160)
              </span>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="min-h-[88px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
                disabled={!selectedPath || editLoading}
              />
              <span className="text-[11px] text-slate-400">{editDescription.trim().length} chars</span>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Subtitle visible (90-150)
              </span>
              <textarea
                value={editSubtitle}
                onChange={(e) => setEditSubtitle(e.target.value)}
                className="min-h-[88px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
                disabled={!selectedPath || editLoading}
              />
              <span className="text-[11px] text-slate-400">{editSubtitle.trim().length} chars</span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveManual}
                disabled={!selectedPath || editLoading}
                className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editLoading ? "Guardando…" : "Guardar override"}
              </button>
              {editSavedAt ? (
                <p className="text-xs text-slate-500">Guardado: {formatDateTime(editSavedAt)}</p>
              ) : null}
              {editing ? (
                <p className="text-xs text-slate-500">
                  Fuente: <span className="font-mono">{editing.provider}/{editing.model}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Ítems recientes
        </p>
        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {recentItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-mono text-xs">{item.path}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.status}</td>
                  <td className="px-4 py-3">{item.attempts}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{formatDateTime(item.updatedAt)}</td>
                  <td className="px-4 py-3">
                    {item.lastError ? (
                      <span className="block max-w-[420px] truncate font-mono text-xs text-rose-700" title={item.lastError}>
                        {item.lastError}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {recentItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    — sin ítems —
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
