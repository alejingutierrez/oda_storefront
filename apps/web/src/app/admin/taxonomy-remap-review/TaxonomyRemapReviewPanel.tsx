"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type BrandOption = {
  id: string;
  name: string;
  productCount: number;
};

type ReviewItem = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  source: string | null;
  runKey: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decisionError: string | null;
  fromCategory: string | null;
  fromSubcategory: string | null;
  fromGender: string | null;
  toCategory: string | null;
  toSubcategory: string | null;
  toGender: string | null;
  confidence: number | null;
  reasons: string[];
  seoCategoryHints: string[];
  sourceCount: number | null;
  scoreSupport: number | null;
  marginRatio: number | null;
  imageCoverUrl: string | null;
  sourceUrl: string | null;
  productId: string;
  productName: string;
  brandId: string;
  brandName: string | null;
};

type StatusFilter = "pending" | "accepted" | "rejected" | "all";

type ReviewsResponse = {
  items: ReviewItem[];
  summary: {
    pending: number;
    accepted: number;
    rejected: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pendientes" },
  { value: "accepted", label: "Aceptadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "all", label: "Todas" },
];

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO");
};

const formatNullable = (value: string | null | undefined) => {
  if (!value || !String(value).trim()) return "—";
  return value;
};

const formatScore = (value: number | null | undefined, digits = 3) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
};

export default function TaxonomyRemapReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [summary, setSummary] = useState({ pending: 0, accepted: 0, rejected: 0 });
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [brandId, setBrandId] = useState("");
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionById, setActionById] = useState<Record<string, "accept" | "reject">>({});
  const [error, setError] = useState<string | null>(null);

  const hasFilters = useMemo(() => {
    return Boolean(search.trim()) || Boolean(brandId) || status !== "pending";
  }, [search, brandId, status]);

  const fetchBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/products/brands", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));
      setBrands(Array.isArray(payload.brands) ? payload.brands : []);
    } catch {
      setBrands([]);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("page", String(page));
      params.set("limit", "40");
      if (search.trim()) params.set("search", search.trim());
      if (brandId) params.set("brandId", brandId);
      const res = await fetch(`/api/admin/taxonomy-remap/reviews?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo cargar la cola de revisión");
      }
      const payload = (await res.json()) as ReviewsResponse;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setSummary(payload.summary ?? { pending: 0, accepted: 0, rejected: 0 });
      setTotal(payload.pagination?.total ?? 0);
      setTotalPages(Math.max(1, payload.pagination?.totalPages ?? 1));
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "No se pudo cargar la cola de revisión");
    } finally {
      setLoading(false);
    }
  }, [status, page, search, brandId]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleAccept = useCallback(async (item: ReviewItem) => {
    const ok = window.confirm(
      `¿Aceptar remapeo para \"${item.productName}\"?\n\nSe aplicará categoría/subcategoría y género propuestos.`,
    );
    if (!ok) return;

    setActionById((prev) => ({ ...prev, [item.id]: "accept" }));
    setError(null);
    try {
      const res = await fetch(`/api/admin/taxonomy-remap/reviews/${item.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo aceptar la propuesta");
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aceptar la propuesta");
    } finally {
      setActionById((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  }, [fetchItems]);

  const handleReject = useCallback(async (item: ReviewItem) => {
    const note = window.prompt("Motivo del rechazo (opcional):", "") ?? "";
    const ok = window.confirm(`¿Rechazar propuesta para \"${item.productName}\"?`);
    if (!ok) return;

    setActionById((prev) => ({ ...prev, [item.id]: "reject" }));
    setError(null);
    try {
      const res = await fetch(`/api/admin/taxonomy-remap/reviews/${item.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo rechazar la propuesta");
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo rechazar la propuesta");
    } finally {
      setActionById((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  }, [fetchItems]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Revisión manual de remapeo</h2>
          <p className="text-sm text-slate-500">
            Acepta o rechaza propuestas antes de tocar catálogo. La aceptación aplica categoría,
            subcategoría y género.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700">
            Pendientes: {summary.pending}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">
            Aceptadas: {summary.accepted}
          </span>
          <span className="rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-700">
            Rechazadas: {summary.rejected}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Estado
          </label>
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-3">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Marca
          </label>
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={brandId}
            onChange={(event) => {
              setBrandId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name} ({brand.productCount})
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Buscar
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            placeholder="Producto, marca o categoría propuesta"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              setSearch(searchInput.trim());
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-end gap-2 lg:col-span-2">
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setSearch(searchInput.trim());
              setPage(1);
            }}
          >
            Filtrar
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setStatus("pending");
              setBrandId("");
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
            disabled={!hasFilters}
          >
            Limpiar
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span>Total: {total}</span>
        <span>Página {page} / {totalPages}</span>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Cargando revisiones...</p>
      ) : null}

      {!loading && !items.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          No hay propuestas para los filtros seleccionados.
        </p>
      ) : null}

      {items.length ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[1280px] divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Actual</th>
                <th className="px-3 py-2 text-left">Propuesto</th>
                <th className="px-3 py-2 text-left">Señales</th>
                <th className="px-3 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white align-top">
              {items.map((item) => {
                const action = actionById[item.id];
                const busy = Boolean(action);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-3">
                      <div className="flex gap-3">
                        <div className="relative h-20 w-20 overflow-hidden rounded-lg bg-slate-100">
                          {item.imageCoverUrl ? (
                            <Image
                              src={item.imageCoverUrl}
                              alt={item.productName}
                              fill
                              className="object-cover"
                              unoptimized={item.imageCoverUrl.startsWith("/api/")}
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">
                              Sin imagen
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">{item.productName}</p>
                          <p className="text-xs text-slate-500">{item.brandName ?? "Sin marca"}</p>
                          <p className="text-[11px] text-slate-500">{formatDateTime(item.createdAt)}</p>
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            <a
                              href={`/admin/products?productId=${item.productId}`}
                              className="font-semibold text-indigo-600 hover:text-indigo-500"
                            >
                              Abrir producto
                            </a>
                            {item.sourceUrl ? (
                              <a
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-slate-600 hover:text-slate-900"
                              >
                                Ver fuente
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700">
                      <p><span className="font-semibold">Cat:</span> {formatNullable(item.fromCategory)}</p>
                      <p><span className="font-semibold">Sub:</span> {formatNullable(item.fromSubcategory)}</p>
                      <p><span className="font-semibold">Género:</span> {formatNullable(item.fromGender)}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700">
                      <p><span className="font-semibold">Cat:</span> {formatNullable(item.toCategory)}</p>
                      <p><span className="font-semibold">Sub:</span> {formatNullable(item.toSubcategory)}</p>
                      <p><span className="font-semibold">Género:</span> {formatNullable(item.toGender)}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700">
                      <p><span className="font-semibold">Confianza:</span> {formatScore(item.confidence)}</p>
                      <p><span className="font-semibold">Sources:</span> {formatNullable(String(item.sourceCount ?? ""))}</p>
                      <p><span className="font-semibold">Support:</span> {formatScore(item.scoreSupport, 4)}</p>
                      <p><span className="font-semibold">Margin:</span> {formatScore(item.marginRatio, 4)}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {item.reasons.length ? item.reasons.join(" · ") : "Sin razones"}
                      </p>
                      {item.seoCategoryHints.length ? (
                        <p className="mt-1 text-[11px] text-amber-700">
                          SEO hints: {item.seoCategoryHints.join(", ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {item.status === "pending" ? (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => handleAccept(item)}
                            disabled={busy}
                          >
                            {action === "accept" ? "Aceptando..." : "Aceptar"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => handleReject(item)}
                            disabled={busy}
                          >
                            {action === "reject" ? "Rechazando..." : "Rechazar"}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1 text-xs text-slate-600">
                          <p className="font-semibold">
                            {item.status === "accepted" ? "Aceptada" : "Rechazada"}
                          </p>
                          <p>{formatDateTime(item.decidedAt)}</p>
                          {item.decisionNote ? <p className="text-[11px]">{item.decisionNote}</p> : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          disabled={page <= 1 || loading}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Anterior
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}
