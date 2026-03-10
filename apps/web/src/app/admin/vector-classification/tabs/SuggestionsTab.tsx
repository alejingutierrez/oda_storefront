"use client";

import { useCallback, useEffect, useState } from "react";

/* ── Types ── */

type SuggestionStatus = "pending" | "accepted" | "rejected";
type ModelTypeFilter = "category" | "subcategory" | "gender" | "all";

type Suggestion = {
  id: string;
  status: SuggestionStatus;
  modelType: "category" | "subcategory" | "gender";
  productId: string;
  productName: string;
  brandName: string | null;
  imageCoverUrl: string | null;
  fromCategory: string | null;
  fromSubcategory: string | null;
  fromGender: string | null;
  toCategory: string | null;
  toSubcategory: string | null;
  toGender: string | null;
  confidence: number | null;
  distance: number | null;
  margin: number | null;
  createdAt: string;
};

/** Shape returned by the API (nested product, flat pagination) */
type ApiSuggestion = Omit<Suggestion, "productName" | "brandName" | "imageCoverUrl" | "distance"> & {
  product: {
    name: string;
    imageCoverUrl: string | null;
    brand: { name: string } | null;
  };
  vectorDistance: number | null;
};

type ApiSuggestionsResponse = {
  suggestions: ApiSuggestion[];
  total: number;
  page: number;
  hasMore: boolean;
  counts: {
    pending: number;
    accepted: number;
    rejected: number;
  };
};

const PAGE_LIMIT = 25;

/* ── Helpers ── */

const formatScore = (v: number | null | undefined, digits = 2) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return v.toFixed(digits);
};

const formatPercent = (v: number | null | undefined) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return `${Math.round(v * 100)}%`;
};

/* ── Component ── */

export default function SuggestionsTab() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [counts, setCounts] = useState({ pending: 0, accepted: 0, rejected: 0, total: 0 });
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | "all">("pending");
  const [modelTypeFilter, setModelTypeFilter] = useState<ModelTypeFilter>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionById, setActionById] = useState<Record<string, "accept" | "reject">>({});
  const [addToGtById, setAddToGtById] = useState<Record<string, boolean>>({});
  const [rejectNoteById, setRejectNoteById] = useState<Record<string, string>>({});
  const [showRejectInputId, setShowRejectInputId] = useState<string | null>(null);
  const [bulkAccepting, setBulkAccepting] = useState<number | null>(null);

  /* ── Fetch suggestions ── */
  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (modelTypeFilter !== "all") params.set("modelType", modelTypeFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(
        `/api/admin/vector-classification/reclassification/suggestions?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) throw new Error("No se pudieron cargar las sugerencias");
      const data = (await res.json()) as ApiSuggestionsResponse;
      const mapped: Suggestion[] = data.suggestions.map((s) => ({
        id: s.id,
        status: s.status,
        modelType: s.modelType,
        productId: s.productId,
        productName: s.product?.name ?? "Sin nombre",
        brandName: s.product?.brand?.name ?? null,
        imageCoverUrl: s.product?.imageCoverUrl ?? null,
        fromCategory: s.fromCategory,
        fromSubcategory: s.fromSubcategory,
        fromGender: s.fromGender,
        toCategory: s.toCategory,
        toSubcategory: s.toSubcategory,
        toGender: s.toGender,
        confidence: s.confidence,
        distance: s.vectorDistance,
        margin: s.margin,
        createdAt: s.createdAt,
      }));
      setSuggestions(mapped);
      const totalCount = data.counts.pending + data.counts.accepted + data.counts.rejected;
      setCounts({ ...data.counts, total: totalCount });
      setTotalPages(Math.max(1, Math.ceil(data.total / PAGE_LIMIT)));
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar sugerencias");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, modelTypeFilter, search]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  /* ── Accept ── */
  const handleAccept = useCallback(
    async (suggestion: Suggestion) => {
      if (actionById[suggestion.id]) return;
      setActionById((prev) => ({ ...prev, [suggestion.id]: "accept" }));
      setError(null);

      const addToGroundTruth = addToGtById[suggestion.id] !== false; // default true

      // Optimistic remove
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCounts((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        accepted: prev.accepted + 1,
      }));
      setTotal((prev) => Math.max(0, prev - 1));

      try {
        const res = await fetch(
          `/api/admin/vector-classification/reclassification/suggestions/${suggestion.id}/accept`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addToGroundTruth }),
          },
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "No se pudo aceptar la sugerencia");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al aceptar sugerencia");
        // Re-fetch to restore state
        await fetchSuggestions();
      } finally {
        setActionById((prev) => {
          const next = { ...prev };
          delete next[suggestion.id];
          return next;
        });
      }
    },
    [actionById, addToGtById, fetchSuggestions],
  );

  /* ── Reject ── */
  const handleReject = useCallback(
    async (suggestion: Suggestion) => {
      if (actionById[suggestion.id]) return;
      setActionById((prev) => ({ ...prev, [suggestion.id]: "reject" }));
      setError(null);

      const note = rejectNoteById[suggestion.id] || "";

      // Optimistic remove
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCounts((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        rejected: prev.rejected + 1,
      }));
      setTotal((prev) => Math.max(0, prev - 1));

      try {
        const res = await fetch(
          `/api/admin/vector-classification/reclassification/suggestions/${suggestion.id}/reject`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note }),
          },
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "No se pudo rechazar la sugerencia");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al rechazar sugerencia");
        await fetchSuggestions();
      } finally {
        setActionById((prev) => {
          const next = { ...prev };
          delete next[suggestion.id];
          return next;
        });
        setShowRejectInputId(null);
        setRejectNoteById((prev) => {
          const next = { ...prev };
          delete next[suggestion.id];
          return next;
        });
      }
    },
    [actionById, rejectNoteById, fetchSuggestions],
  );

  /* ── Bulk accept ── */
  const handleBulkAccept = useCallback(
    async (minConfidence: number) => {
      if (bulkAccepting !== null) return;
      setBulkAccepting(minConfidence);
      setError(null);

      try {
        const res = await fetch(
          "/api/admin/vector-classification/reclassification/suggestions/bulk-accept",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ minConfidence: minConfidence / 100 }),
          },
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "Error en auto-aceptar");
        }
        const data = (await res.json()) as { accepted: number; failed: number };
        setError(
          data.accepted > 0
            ? null
            : "No se encontraron sugerencias pendientes con esa confianza",
        );
        await fetchSuggestions();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error en auto-aceptar");
      } finally {
        setBulkAccepting(null);
      }
    },
    [bulkAccepting, fetchSuggestions],
  );

  /* ── Status pill buttons ── */
  const statusPills: Array<{
    value: SuggestionStatus | "all";
    label: string;
    count: number;
    color: string;
    activeColor: string;
  }> = [
    {
      value: "pending",
      label: "Pendientes",
      count: counts.pending,
      color: "text-amber-700 bg-amber-50 border-amber-200",
      activeColor: "text-white bg-amber-600 border-amber-600",
    },
    {
      value: "accepted",
      label: "Aceptadas",
      count: counts.accepted,
      color: "text-emerald-700 bg-emerald-50 border-emerald-200",
      activeColor: "text-white bg-emerald-600 border-emerald-600",
    },
    {
      value: "rejected",
      label: "Rechazadas",
      count: counts.rejected,
      color: "text-rose-700 bg-rose-50 border-rose-200",
      activeColor: "text-white bg-rose-600 border-rose-600",
    },
    {
      value: "all",
      label: "Todas",
      count: counts.total,
      color: "text-slate-700 bg-slate-50 border-slate-200",
      activeColor: "text-white bg-slate-700 border-slate-700",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Status pills */}
          <div className="flex flex-wrap gap-2">
            {statusPills.map((pill) => (
              <button
                key={pill.value}
                type="button"
                onClick={() => {
                  setStatusFilter(pill.value);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === pill.value ? pill.activeColor : pill.color
                }`}
              >
                {pill.label} ({pill.count})
              </button>
            ))}

            {/* Bulk auto-accept buttons */}
            <div className="ml-2 flex items-center gap-1.5 border-l border-slate-200 pl-3">
              {[80, 75, 70].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleBulkAccept(pct)}
                  disabled={bulkAccepting !== null}
                  className="rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={`Auto-aceptar todas las pendientes con confianza >= ${pct}%`}
                >
                  {bulkAccepting === pct ? "..." : `AA ${pct}`}
                </button>
              ))}
            </div>
          </div>

          {/* Model type + Search */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {(
                [
                  { value: "all", label: "Todos" },
                  { value: "category", label: "Categoria" },
                  { value: "subcategory", label: "Subcategoria" },
                  { value: "gender", label: "Genero" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setModelTypeFilter(opt.value);
                    setPage(1);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    modelTypeFilter === opt.value
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                className="w-48 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                placeholder="Buscar nombre o marca"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSearch(searchInput.trim());
                    setPage(1);
                  }
                }}
              />
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setSearch(searchInput.trim());
                  setPage(1);
                }}
              >
                Buscar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-slate-500">Cargando sugerencias...</p>}

      {/* Empty */}
      {!loading && suggestions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">
            No hay sugerencias para los filtros seleccionados.
          </p>
        </div>
      )}

      {/* Suggestion cards */}
      {suggestions.length > 0 && (
        <div className="space-y-3">
          {suggestions.map((suggestion) => {
            const busy = !!actionById[suggestion.id];
            const isCategory = suggestion.modelType === "category";
            const isSubcat = suggestion.modelType === "subcategory";
            const showRejectInput = showRejectInputId === suggestion.id;

            return (
              <div
                key={suggestion.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center"
              >
                {/* Image + Name */}
                <div className="flex shrink-0 items-center gap-3 lg:w-56">
                  {suggestion.imageCoverUrl ? (
                    <img
                      src={suggestion.imageCoverUrl}
                      alt={suggestion.productName}
                      className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-[9px] text-slate-400">
                      Sin img
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {suggestion.productName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {suggestion.brandName || "Sin marca"}
                    </p>
                  </div>
                </div>

                {/* Change diff */}
                <div className="flex-1 space-y-1.5">
                  {isCategory ? (
                    <DiffRow
                      label="Categoria"
                      from={suggestion.fromCategory}
                      to={suggestion.toCategory}
                    />
                  ) : isSubcat ? (
                    <>
                      <DiffRow
                        label="Categoria"
                        from={suggestion.fromCategory}
                        to={suggestion.toCategory}
                      />
                      <DiffRow
                        label="Subcategoria"
                        from={suggestion.fromSubcategory}
                        to={suggestion.toSubcategory}
                      />
                    </>
                  ) : (
                    <DiffRow
                      label="Genero"
                      from={suggestion.fromGender}
                      to={suggestion.toGender}
                    />
                  )}
                </div>

                {/* Metrics */}
                <div className="flex shrink-0 items-center gap-3 text-xs lg:w-48">
                  <div className="space-y-0.5 text-center">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Confianza
                    </p>
                    <p className="font-bold text-slate-800">
                      {formatPercent(suggestion.confidence)}
                    </p>
                  </div>
                  <div className="space-y-0.5 text-center">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Distancia
                    </p>
                    <p className="font-bold text-slate-800">
                      {formatScore(suggestion.distance)}
                    </p>
                  </div>
                  <div className="space-y-0.5 text-center">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Margen
                    </p>
                    <p className="font-bold text-slate-800">
                      {formatScore(suggestion.margin)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-col gap-2 lg:w-44">
                  {suggestion.status === "pending" ? (
                    <>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleAccept(suggestion)}
                          disabled={busy}
                        >
                          {actionById[suggestion.id] === "accept"
                            ? "Aceptando..."
                            : "Aceptar"}
                        </button>
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            if (showRejectInput) {
                              handleReject(suggestion);
                            } else {
                              setShowRejectInputId(suggestion.id);
                            }
                          }}
                          disabled={busy}
                        >
                          {actionById[suggestion.id] === "reject"
                            ? "Rechazando..."
                            : "Rechazar"}
                        </button>
                      </div>

                      {/* Add to ground truth checkbox */}
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={addToGtById[suggestion.id] !== false}
                          onChange={(e) =>
                            setAddToGtById((prev) => ({
                              ...prev,
                              [suggestion.id]: e.target.checked,
                            }))
                          }
                          className="rounded border-slate-300"
                        />
                        Agregar a ground truth
                      </label>

                      {/* Reject note */}
                      {showRejectInput && (
                        <input
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          placeholder="Nota (opcional)"
                          value={rejectNoteById[suggestion.id] || ""}
                          onChange={(e) =>
                            setRejectNoteById((prev) => ({
                              ...prev,
                              [suggestion.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleReject(suggestion);
                          }}
                          autoFocus
                        />
                      )}
                    </>
                  ) : (
                    <span
                      className={`rounded-full px-3 py-1 text-center text-xs font-semibold ${
                        suggestion.status === "accepted"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {suggestion.status === "accepted" ? "Aceptada" : "Rechazada"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-xs text-slate-500">
            Pagina {page} de {totalPages} ({total} sugerencias)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── DiffRow sub-component ── */

function DiffRow({
  label,
  from,
  to,
}: {
  label: string;
  from: string | null;
  to: string | null;
}) {
  const changed =
    (from ?? "").trim().toLowerCase() !== (to ?? "").trim().toLowerCase();

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 ${
          changed
            ? "bg-rose-100 font-medium text-rose-700 line-through"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {from || "--"}
      </span>
      <span className={changed ? "font-semibold text-amber-600" : "text-slate-400"}>
        {changed ? "->" : "="}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 ${
          changed
            ? "bg-emerald-100 font-semibold text-emerald-700"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {to || "--"}
      </span>
    </div>
  );
}
