"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  allImages: string[];
  materialTags: string[];
  occasionTags: string[];
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
type ApiSuggestion = Omit<
  Suggestion,
  "productName" | "brandName" | "imageCoverUrl" | "allImages" | "distance" | "materialTags" | "occasionTags"
> & {
  product: {
    name: string;
    imageCoverUrl: string | null;
    brand: { name: string } | null;
    materialTags: string[];
    occasionTags: string[];
    variants: { images: string[] }[];
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
  const [subcategoryFilter, setSubcategoryFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [occasionFilter, setOccasionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionById, setActionById] = useState<Record<string, "accept" | "reject">>({});
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [bulkAccepting, setBulkAccepting] = useState(false);
  const [bulkRejecting, setBulkRejecting] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  /* ── Fetch suggestions (page 1 = reset, page > 1 = append) ── */
  const fetchSuggestions = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: String(PAGE_LIMIT),
        });
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (modelTypeFilter !== "all") params.set("modelType", modelTypeFilter);
        if (subcategoryFilter) params.set("toSubcategory", subcategoryFilter);
        if (materialFilter.trim()) params.set("material", materialFilter.trim());
        if (occasionFilter.trim()) params.set("occasion", occasionFilter.trim());
        if (search.trim()) params.set("search", search.trim());

        const res = await fetch(
          `/api/admin/vector-classification/reclassification/suggestions?${params.toString()}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) throw new Error("No se pudieron cargar las sugerencias");
        const data = (await res.json()) as ApiSuggestionsResponse;
        const mapped: Suggestion[] = data.suggestions.map((s) => {
          const variantImages = (s.product?.variants ?? []).flatMap((v) => v.images);
          const cover = s.product?.imageCoverUrl;
          const uniqueImages = Array.from(new Set([...(cover ? [cover] : []), ...variantImages]));
          return {
            id: s.id,
            status: s.status,
            modelType: s.modelType,
            productId: s.productId,
            productName: s.product?.name ?? "Sin nombre",
            brandName: s.product?.brand?.name ?? null,
            imageCoverUrl: cover ?? null,
            allImages: uniqueImages,
            materialTags: s.product?.materialTags ?? [],
            occasionTags: s.product?.occasionTags ?? [],
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
          };
        });
        if (append) {
          setSuggestions((prev) => [...prev, ...mapped]);
        } else {
          setSuggestions(mapped);
        }
        const totalCount = data.counts.pending + data.counts.accepted + data.counts.rejected;
        setCounts({ ...data.counts, total: totalCount });
        setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar sugerencias");
        if (!append) setSuggestions([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [statusFilter, modelTypeFilter, subcategoryFilter, materialFilter, occasionFilter, search],
  );

  /* ── Reset on filter change ── */
  useEffect(() => {
    setPage(1);
    fetchSuggestions(1, false);
  }, [fetchSuggestions]);

  /* ── Load more when page increments ── */
  useEffect(() => {
    if (page > 1) {
      fetchSuggestions(page, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  /* ── Infinite scroll observer ── */
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "400px" },
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, loadingMore]);

  /* ── Accept (always adds to ground truth) ── */
  const handleAccept = useCallback(
    async (suggestion: Suggestion) => {
      if (actionById[suggestion.id]) return;
      setActionById((prev) => ({ ...prev, [suggestion.id]: "accept" }));
      setError(null);

      // Optimistic remove
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCounts((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        accepted: prev.accepted + 1,
      }));

      try {
        const res = await fetch(
          `/api/admin/vector-classification/reclassification/suggestions/${suggestion.id}/accept`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addToGroundTruth: true }),
          },
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "No se pudo aceptar la sugerencia");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al aceptar sugerencia");
        setPage(1);
        await fetchSuggestions(1, false);
      } finally {
        setActionById((prev) => {
          const next = { ...prev };
          delete next[suggestion.id];
          return next;
        });
      }
    },
    [actionById, fetchSuggestions],
  );

  /* ── Reject (single click, no note) ── */
  const handleReject = useCallback(
    async (suggestion: Suggestion) => {
      if (actionById[suggestion.id]) return;
      setActionById((prev) => ({ ...prev, [suggestion.id]: "reject" }));
      setError(null);

      // Optimistic remove
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCounts((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        rejected: prev.rejected + 1,
      }));

      try {
        const res = await fetch(
          `/api/admin/vector-classification/reclassification/suggestions/${suggestion.id}/reject`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "No se pudo rechazar la sugerencia");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al rechazar sugerencia");
        setPage(1);
        await fetchSuggestions(1, false);
      } finally {
        setActionById((prev) => {
          const next = { ...prev };
          delete next[suggestion.id];
          return next;
        });
      }
    },
    [actionById, fetchSuggestions],
  );

  /* ── Bulk accept all filtered ── */
  const handleBulkAccept = useCallback(async () => {
    if (bulkAccepting) return;
    setBulkAccepting(true);
    setError(null);

    try {
      const bodyPayload: Record<string, string> = {};
      if (modelTypeFilter !== "all") bodyPayload.modelType = modelTypeFilter;
      if (subcategoryFilter) bodyPayload.toSubcategory = subcategoryFilter;
      if (materialFilter.trim()) bodyPayload.material = materialFilter.trim();
      if (occasionFilter.trim()) bodyPayload.occasion = occasionFilter.trim();
      if (search.trim()) bodyPayload.search = search.trim();

      const res = await fetch(
        "/api/admin/vector-classification/reclassification/suggestions/bulk-accept",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
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
          : "No se encontraron sugerencias pendientes para los filtros actuales",
      );
      setPage(1);
      await fetchSuggestions(1, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en auto-aceptar");
    } finally {
      setBulkAccepting(false);
    }
  }, [bulkAccepting, modelTypeFilter, subcategoryFilter, materialFilter, occasionFilter, search, fetchSuggestions]);

  /* ── Bulk reject all filtered ── */
  const handleBulkReject = useCallback(async () => {
    if (bulkRejecting) return;
    setBulkRejecting(true);
    setError(null);

    try {
      const bodyPayload: Record<string, string> = {};
      if (modelTypeFilter !== "all") bodyPayload.modelType = modelTypeFilter;
      if (subcategoryFilter) bodyPayload.toSubcategory = subcategoryFilter;
      if (materialFilter.trim()) bodyPayload.material = materialFilter.trim();
      if (occasionFilter.trim()) bodyPayload.occasion = occasionFilter.trim();
      if (search.trim()) bodyPayload.search = search.trim();

      const res = await fetch(
        "/api/admin/vector-classification/reclassification/suggestions/bulk-reject",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Error en rechazar");
      }
      const data = (await res.json()) as { rejected: number; failed: number };
      setError(
        data.rejected > 0
          ? null
          : "No se encontraron sugerencias pendientes para los filtros actuales",
      );
      setPage(1);
      await fetchSuggestions(1, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en rechazar");
    } finally {
      setBulkRejecting(false);
    }
  }, [bulkRejecting, modelTypeFilter, subcategoryFilter, materialFilter, occasionFilter, search, fetchSuggestions]);

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

            {/* Bulk accept / reject all filtered */}
            <div className="ml-2 flex items-center gap-1.5 border-l border-slate-200 pl-3">
              <button
                type="button"
                onClick={handleBulkAccept}
                disabled={bulkAccepting || bulkRejecting}
                className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Aceptar todas las pendientes con los filtros actuales"
              >
                {bulkAccepting ? "..." : "AA"}
              </button>
              <button
                type="button"
                onClick={handleBulkReject}
                disabled={bulkAccepting || bulkRejecting}
                className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Rechazar todas las pendientes con los filtros actuales"
              >
                {bulkRejecting ? "..." : "RA"}
              </button>
            </div>
          </div>

          {/* Model type + Filters + Search */}
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

            <input
              className="w-40 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Subcategoria sugerida"
              value={subcategoryFilter}
              onChange={(e) => setSubcategoryFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setPage(1);
              }}
            />

            <input
              className="w-32 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Material"
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setPage(1);
              }}
            />

            <input
              className="w-32 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Ocasion"
              value={occasionFilter}
              onChange={(e) => setOccasionFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setPage(1);
              }}
            />

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

            return (
              <div key={suggestion.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-stretch">
                  {/* Image */}
                  <button
                    type="button"
                    className="shrink-0 overflow-hidden rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    onClick={() => {
                      if (suggestion.allImages.length > 0) {
                        setLightbox({ images: suggestion.allImages, index: 0 });
                      }
                    }}
                    title={`Ver galeria (${suggestion.allImages.length} fotos)`}
                  >
                    {suggestion.imageCoverUrl ? (
                      <img
                        src={suggestion.imageCoverUrl}
                        alt={suggestion.productName}
                        className="h-24 w-24 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center bg-slate-100 text-[10px] text-slate-400">
                        Sin img
                      </div>
                    )}
                  </button>

                  {/* Name + Brand + Tags */}
                  <div className="flex min-w-0 shrink-0 flex-col justify-center lg:w-64">
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900">
                      {suggestion.productName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {suggestion.brandName || "Sin marca"}
                    </p>
                    {(suggestion.materialTags.length > 0 || suggestion.occasionTags.length > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {suggestion.materialTags.slice(0, 2).map((t) => (
                          <span
                            key={`m-${t}`}
                            className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600"
                          >
                            {t}
                          </span>
                        ))}
                        {suggestion.occasionTags.slice(0, 2).map((t) => (
                          <span
                            key={`o-${t}`}
                            className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Change diff */}
                  <div className="flex flex-1 flex-col justify-center space-y-1.5">
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
                  <div className="flex shrink-0 items-center gap-2 text-xs lg:w-36">
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

                  {/* Actions: A / R square buttons */}
                  {suggestion.status === "pending" ? (
                    <div className="flex shrink-0 items-stretch gap-1.5 self-stretch">
                      <button
                        type="button"
                        className="flex w-14 items-center justify-center rounded-lg bg-emerald-600 text-xl font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleAccept(suggestion)}
                        disabled={busy}
                        title="Aceptar"
                      >
                        {actionById[suggestion.id] === "accept" ? "..." : "A"}
                      </button>
                      <button
                        type="button"
                        className="flex w-14 items-center justify-center rounded-lg bg-rose-600 text-xl font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleReject(suggestion)}
                        disabled={busy}
                        title="Rechazar"
                      >
                        {actionById[suggestion.id] === "reject" ? "..." : "R"}
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`shrink-0 self-center rounded-full px-3 py-1 text-center text-xs font-semibold ${
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

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />

      {/* Loading more indicator */}
      {loadingMore && (
        <p className="py-4 text-center text-sm text-slate-500">Cargando mas sugerencias...</p>
      )}

      {/* Lightbox gallery */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

/* ── ImageLightbox sub-component ── */

function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, images.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  // Prevent body scroll while lightbox is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/20 p-2 text-white backdrop-blur transition hover:bg-white/40"
        onClick={onClose}
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Counter */}
      <div className="absolute left-4 top-4 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
        {index + 1} / {images.length}
      </div>

      {/* Previous */}
      {index > 0 && (
        <button
          type="button"
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur transition hover:bg-white/40"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i - 1); }}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Next */}
      {index < images.length - 1 && (
        <button
          type="button"
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur transition hover:bg-white/40"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i + 1); }}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Main image */}
      <img
        src={images[index]}
        alt={`Foto ${index + 1} de ${images.length}`}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 overflow-x-auto rounded-xl bg-black/50 p-2 backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={`shrink-0 overflow-hidden rounded-md border-2 transition ${
                i === index ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <img src={src} alt="" className="h-14 w-14 object-cover" loading="lazy" />
            </button>
          ))}
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
