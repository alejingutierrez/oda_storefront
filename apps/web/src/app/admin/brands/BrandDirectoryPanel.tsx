"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  siteUrl: string | null;
  instagram: string | null;
  description: string | null;
  logoUrl: string | null;
  category: string | null;
  productCategory: string | null;
  market: string | null;
  style: string | null;
  scale: string | null;
  avgPrice: number | string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isActive: boolean;
  productCount: number;
  lastStatus: string | null;
  lastCreatedAt: string | null;
  lastFinishedAt: string | null;
  lastResult: {
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
  } | null;
  hasCompleted: boolean | null;
};

type BrandSummary = {
  total: number;
  unprocessed: number;
  processed: number;
  queuedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
};

type BrandListResponse = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  summary: BrandSummary;
  brands: BrandRow[];
};

type BrandDetail = {
  id: string;
  name: string;
  slug: string;
  siteUrl: string | null;
  category: string | null;
  productCategory: string | null;
  market: string | null;
  style: string | null;
  scale: string | null;
  avgPrice: number | string | null;
  reviewed: string | null;
  ratingStars: string | null;
  ratingScore: number | string | null;
  sourceSheet: string | null;
  sourceFile: string | null;
  description: string | null;
  logoUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  instagram: string | null;
  tiktok: string | null;
  facebook: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  lat: number | string | null;
  lng: number | string | null;
  openingHours: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type BrandDetailResponse = {
  brand: BrandDetail;
  lastJob?: {
    status: string;
    createdAt: string;
    finishedAt: string | null;
    result?: {
      changes?: Array<{ field: string; before: unknown; after: unknown }>;
    } | null;
  } | null;
};

type BrandFormState = {
  name: string;
  slug: string;
  siteUrl: string;
  category: string;
  productCategory: string;
  market: string;
  style: string;
  scale: string;
  avgPrice: string;
  reviewed: string;
  ratingStars: string;
  ratingScore: string;
  sourceSheet: string;
  sourceFile: string;
  description: string;
  logoUrl: string;
  contactPhone: string;
  contactEmail: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  whatsapp: string;
  address: string;
  city: string;
  lat: string;
  lng: string;
  openingHours: string;
  metadata: string;
  isActive: boolean;
};

const PAGE_SIZE = 15;

const EMPTY_FORM: BrandFormState = {
  name: "",
  slug: "",
  siteUrl: "",
  category: "",
  productCategory: "",
  market: "",
  style: "",
  scale: "",
  avgPrice: "",
  reviewed: "",
  ratingStars: "",
  ratingScore: "",
  sourceSheet: "",
  sourceFile: "",
  description: "",
  logoUrl: "",
  contactPhone: "",
  contactEmail: "",
  instagram: "",
  tiktok: "",
  facebook: "",
  whatsapp: "",
  address: "",
  city: "",
  lat: "",
  lng: "",
  openingHours: "",
  metadata: "",
  isActive: true,
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO");
};

const normalizeLink = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
};

const renderLink = (value: string | null, label?: string) => {
  const href = normalizeLink(value);
  if (!href) return "—";
  const text = label ?? value ?? href;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
      {text}
    </a>
  );
};

const formatMoney = (value: number | string | null) => {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return `$ ${new Intl.NumberFormat("es-CO").format(parsed)}`;
};

const jsonToText = (value: unknown) => {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
};

const safeParseJson = (value: string) => {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

const toText = (value: string | null) => value ?? "—";

function BrandAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [error, setError] = useState(false);
  if (logoUrl && !error) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className="h-12 w-12 rounded-2xl border border-slate-200 object-cover"
        onError={() => setError(true)}
      />
    );
  }
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
      {getInitials(name)}
    </div>
  );
}

export default function BrandDirectoryPanel() {
  const [brandData, setBrandData] = useState<BrandListResponse | null>(null);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"processed" | "unprocessed" | "all">("processed");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"detail" | "edit" | "create">("detail");
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrandDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formState, setFormState] = useState<BrandFormState>({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reEnrichState, setReEnrichState] = useState<
    Record<string, { status: "processing" | "completed" | "failed"; message?: string }>
  >({});

  const fetchBrands = useCallback(async () => {
    setBrandsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        filter,
      });
      const res = await fetch(`/api/admin/brands?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el directorio de marcas");
      const payload = (await res.json()) as BrandListResponse;
      setBrandData(payload);
    } catch (err) {
      console.warn(err);
    } finally {
      setBrandsLoading(false);
    }
  }, [page, filter]);

  const fetchBrandDetail = useCallback(async (brandId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/brands/${brandId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar la marca");
      const payload = (await res.json()) as BrandDetailResponse;
      setDetail(payload);
      return payload;
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const setReEnrichStatus = useCallback(
    (brandId: string, status: "processing" | "completed" | "failed", message?: string) => {
      setReEnrichState((prev) => ({
        ...prev,
        [brandId]: { status, message },
      }));
    },
    [],
  );

  const clearReEnrichStatus = useCallback((brandId: string, delayMs = 5000) => {
    window.setTimeout(() => {
      setReEnrichState((prev) => {
        const next = { ...prev };
        delete next[brandId];
        return next;
      });
    }, delayMs);
  }, []);

  const triggerReEnrich = useCallback(
    async (brandId: string) => {
      setReEnrichStatus(brandId, "processing");
      try {
        const res = await fetch(`/api/admin/brands/${brandId}/re-enrich`, { method: "POST" });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error ?? "No se pudo re-enriquecer");
        }
        setReEnrichStatus(brandId, "completed");
        clearReEnrichStatus(brandId);
        await fetchBrands();
      } catch (err) {
        setReEnrichStatus(
          brandId,
          "failed",
          err instanceof Error ? err.message : "Error inesperado",
        );
        clearReEnrichStatus(brandId, 7000);
      }
    },
    [clearReEnrichStatus, fetchBrands, setReEnrichStatus],
  );

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  const summary = brandData?.summary;
  const totalPages = brandData?.totalPages ?? 1;

  const pageNumbers = useMemo(() => {
    const total = totalPages;
    const current = page;
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    const numbers = [];
    for (let i = start; i <= end; i += 1) numbers.push(i);
    return numbers;
  }, [page, totalPages]);

  const openModal = useCallback(() => {
    setModalOpen(true);
    setFormError(null);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setDetail(null);
    setActiveBrandId(null);
    setDetailLoading(false);
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, closeModal]);

  const openDetail = useCallback(
    async (brandId: string) => {
      setModalMode("detail");
      setActiveBrandId(brandId);
      openModal();
      await fetchBrandDetail(brandId);
    },
    [fetchBrandDetail, openModal],
  );

  const openEdit = useCallback(
    async (brandId: string) => {
      setModalMode("edit");
      setActiveBrandId(brandId);
      openModal();
      const payload = await fetchBrandDetail(brandId);
      if (payload?.brand) {
        setFormState({
          name: payload.brand.name ?? "",
          slug: payload.brand.slug ?? "",
          siteUrl: payload.brand.siteUrl ?? "",
          category: payload.brand.category ?? "",
          productCategory: payload.brand.productCategory ?? "",
          market: payload.brand.market ?? "",
          style: payload.brand.style ?? "",
          scale: payload.brand.scale ?? "",
          avgPrice: payload.brand.avgPrice ? String(payload.brand.avgPrice) : "",
          reviewed: payload.brand.reviewed ?? "",
          ratingStars: payload.brand.ratingStars ?? "",
          ratingScore: payload.brand.ratingScore ? String(payload.brand.ratingScore) : "",
          sourceSheet: payload.brand.sourceSheet ?? "",
          sourceFile: payload.brand.sourceFile ?? "",
          description: payload.brand.description ?? "",
          logoUrl: payload.brand.logoUrl ?? "",
          contactPhone: payload.brand.contactPhone ?? "",
          contactEmail: payload.brand.contactEmail ?? "",
          instagram: payload.brand.instagram ?? "",
          tiktok: payload.brand.tiktok ?? "",
          facebook: payload.brand.facebook ?? "",
          whatsapp: payload.brand.whatsapp ?? "",
          address: payload.brand.address ?? "",
          city: payload.brand.city ?? "",
          lat: payload.brand.lat ? String(payload.brand.lat) : "",
          lng: payload.brand.lng ? String(payload.brand.lng) : "",
          openingHours: jsonToText(payload.brand.openingHours),
          metadata: jsonToText(payload.brand.metadata),
          isActive: payload.brand.isActive,
        });
      }
    },
    [fetchBrandDetail, openModal],
  );

  const openCreate = useCallback(() => {
    setModalMode("create");
    setActiveBrandId(null);
    setFormState({ ...EMPTY_FORM });
    openModal();
  }, [openModal]);

  const handleFormChange = (field: keyof BrandFormState, value: string | boolean) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const buildPayload = () => {
    if (!formState.name.trim()) {
      setFormError("El nombre de la marca es obligatorio.");
      return null;
    }

    const openingHours = formState.openingHours.trim()
      ? safeParseJson(formState.openingHours)
      : null;
    if (formState.openingHours.trim() && openingHours === null) {
      setFormError("El JSON de horarios no es válido.");
      return null;
    }

    const metadata = formState.metadata.trim() ? safeParseJson(formState.metadata) : null;
    if (formState.metadata.trim() && metadata === null) {
      setFormError("El JSON de metadata no es válido.");
      return null;
    }

    const parseNumber = (value: string) => {
      if (!value.trim()) return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      return parsed;
    };

    return {
      name: formState.name.trim(),
      slug: formState.slug.trim() || null,
      siteUrl: formState.siteUrl.trim() || null,
      category: formState.category.trim() || null,
      productCategory: formState.productCategory.trim() || null,
      market: formState.market.trim() || null,
      style: formState.style.trim() || null,
      scale: formState.scale.trim() || null,
      avgPrice: parseNumber(formState.avgPrice),
      reviewed: formState.reviewed.trim() || null,
      ratingStars: formState.ratingStars.trim() || null,
      ratingScore: parseNumber(formState.ratingScore),
      sourceSheet: formState.sourceSheet.trim() || null,
      sourceFile: formState.sourceFile.trim() || null,
      description: formState.description.trim() || null,
      logoUrl: formState.logoUrl.trim() || null,
      contactPhone: formState.contactPhone.trim() || null,
      contactEmail: formState.contactEmail.trim() || null,
      instagram: formState.instagram.trim() || null,
      tiktok: formState.tiktok.trim() || null,
      facebook: formState.facebook.trim() || null,
      whatsapp: formState.whatsapp.trim() || null,
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      lat: parseNumber(formState.lat),
      lng: parseNumber(formState.lng),
      openingHours,
      metadata,
      isActive: formState.isActive,
    };
  };

  const handleSave = async () => {
    setFormError(null);
    const payload = buildPayload();
    if (!payload) return;

    setActionLoading(true);
    try {
      const endpoint =
        modalMode === "create"
          ? "/api/admin/brands"
          : `/api/admin/brands/${activeBrandId}`;
      const method = modalMode === "create" ? "POST" : "PATCH";
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "No se pudo guardar la marca");
      }
      await fetchBrands();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!activeBrandId) return;
    const confirmed = window.confirm("¿Seguro quieres eliminar esta marca? (Se desactiva).");
    if (!confirmed) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/brands/${activeBrandId}`, { method: "DELETE" });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "No se pudo eliminar la marca");
      }
      await fetchBrands();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Directorio de marcas</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Marcas enriquecidas con scraping y detalle completo para revisar calidad, editar o crear nuevas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCreate}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Nueva marca
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total activas</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{summary?.total ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Enriquecidas</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{summary?.processed ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pendientes</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {summary?.unprocessed ?? 0}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        {[
          { label: "Enriquecidas", value: "processed" },
          { label: "Pendientes", value: "unprocessed" },
          { label: "Todas", value: "all" },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setPage(1);
              setFilter(item.value as typeof filter);
            }}
            className={`rounded-full border px-4 py-2 text-xs font-semibold ${
              filter === item.value
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            {item.label}
          </button>
        ))}
        <span className="text-xs text-slate-500">Mostrando {PAGE_SIZE} marcas por página.</span>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {brandsLoading ? (
          <div className="col-span-full rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Cargando marcas...
          </div>
        ) : brandData?.brands?.length ? (
          brandData.brands.map((brand) => {
            const statusLabel = brand.lastStatus ?? (brand.hasCompleted ? "completed" : "pending");
            const isEnriched = brand.hasCompleted ?? false;
            const statusCopy: Record<string, string> = {
              completed: "Enriquecida",
              pending: "Pendiente",
              queued: "En cola",
              processing: "Procesando",
              failed: "Fallida",
            };
            const displayStatus = statusCopy[statusLabel] ?? statusLabel;
            const qualityFields = [
              brand.description,
              brand.logoUrl,
              brand.siteUrl,
              brand.instagram,
              brand.category,
              brand.market,
              brand.style,
              brand.scale,
              brand.city,
              brand.contactEmail,
              brand.contactPhone,
              brand.productCategory,
            ];
            const filled = qualityFields.filter((item) => item && String(item).trim()).length;
            const totalFields = qualityFields.length;
            const reEnrich = reEnrichState[brand.id];
            const reEnrichLabel =
              reEnrich?.status === "processing"
                ? "Re-enriqueciendo..."
                : reEnrich?.status === "completed"
                  ? "Re-enriquecida"
                  : reEnrich?.status === "failed"
                    ? "Error al re-enriquecer"
                    : null;
            return (
              <article key={brand.id} className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <BrandAvatar name={brand.name} logoUrl={brand.logoUrl} />
                    <div>
                      <p className="text-base font-semibold text-slate-900">{brand.name}</p>
                      <p className="text-xs text-slate-500">{brand.slug}</p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      statusLabel === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : statusLabel === "failed"
                          ? "bg-rose-100 text-rose-700"
                          : statusLabel === "processing"
                            ? "bg-amber-100 text-amber-700"
                            : statusLabel === "queued"
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {isEnriched ? "Enriquecida" : displayStatus}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-800">Categoría:</span>{" "}
                    {toText(brand.category)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Mercado:</span>{" "}
                    {toText(brand.market)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Estilo:</span> {toText(brand.style)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Ciudad:</span> {toText(brand.city)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Productos:</span>{" "}
                    {brand.productCount}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Precio promedio:</span>{" "}
                    {formatMoney(brand.avgPrice)}
                  </p>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Calidad</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {filled}/{totalFields} campos clave
                  </p>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Última ejecución: {formatDate(brand.lastFinishedAt)}
                </div>

                {(brand.siteUrl || brand.instagram) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {brand.siteUrl && (
                      <a
                        href={brand.siteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600"
                      >
                        Sitio
                      </a>
                    )}
                    {brand.instagram && (
                      <a
                        href={brand.instagram}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600"
                      >
                        Instagram
                      </a>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openDetail(brand.id)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
                  >
                    Ver más
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerReEnrich(brand.id)}
                    disabled={reEnrich?.status === "processing"}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-60"
                  >
                    Re-enriquecer
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(brand.id)}
                    className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                  >
                    Editar
                  </button>
                </div>

                {(reEnrichLabel || brand.lastStatus === "processing") && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        reEnrich?.status === "failed"
                          ? "bg-rose-500"
                          : reEnrich?.status === "completed"
                            ? "bg-emerald-500"
                            : "animate-pulse bg-amber-500"
                      }`}
                    />
                    <span>{reEnrichLabel ?? "Procesando..."}</span>
                  </div>
                )}

                {reEnrich?.status === "failed" && reEnrich.message && (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {reEnrich.message}
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <div className="col-span-full rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            No hay marcas para mostrar.
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span>
          Página {brandData?.page ?? page} de {totalPages} · {brandData?.totalCount ?? 0} marcas
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Anterior
          </button>
          {pageNumbers.map((number) => (
            <button
              key={`page-${number}`}
              type="button"
              onClick={() => setPage(number)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                number === page
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              {number}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {modalMode === "create" ? "Nueva marca" : "Detalle de marca"}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">
                  {modalMode === "create"
                    ? "Crear marca"
                    : detail?.brand?.name ?? "Marca"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
              {detailLoading && modalMode !== "create" ? (
                <p className="text-sm text-slate-500">Cargando detalle...</p>
              ) : modalMode === "detail" ? (
                detail?.brand ? (
                  <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Identidad</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <p>
                            <span className="font-semibold text-slate-800">Nombre:</span>{" "}
                            {detail.brand.name}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Slug:</span>{" "}
                            {detail.brand.slug}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Descripción:</span>{" "}
                            {toText(detail.brand.description)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Logo:</span>{" "}
                            {renderLink(detail.brand.logoUrl, "Ver logo")}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Clasificación</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <p>
                            <span className="font-semibold text-slate-800">Categoría:</span>{" "}
                            {toText(detail.brand.category)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Subcategoría:</span>{" "}
                            {toText(detail.brand.productCategory)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Mercado:</span>{" "}
                            {toText(detail.brand.market)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Estilo:</span>{" "}
                            {toText(detail.brand.style)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Escala:</span>{" "}
                            {toText(detail.brand.scale)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Precio promedio:</span>{" "}
                            {formatMoney(detail.brand.avgPrice)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Contacto</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <p>
                            <span className="font-semibold text-slate-800">Sitio:</span>{" "}
                            {renderLink(detail.brand.siteUrl)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Email:</span>{" "}
                            {toText(detail.brand.contactEmail)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Teléfono:</span>{" "}
                            {toText(detail.brand.contactPhone)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Instagram:</span>{" "}
                            {renderLink(detail.brand.instagram)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">TikTok:</span>{" "}
                            {renderLink(detail.brand.tiktok)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Facebook:</span>{" "}
                            {renderLink(detail.brand.facebook)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">WhatsApp:</span>{" "}
                            {renderLink(detail.brand.whatsapp)}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Ubicación</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <p>
                            <span className="font-semibold text-slate-800">Dirección:</span>{" "}
                            {toText(detail.brand.address)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Ciudad:</span>{" "}
                            {toText(detail.brand.city)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Lat/Lng:</span>{" "}
                            {detail.brand.lat && detail.brand.lng
                              ? `${detail.brand.lat}, ${detail.brand.lng}`
                              : "—"}
                          </p>
                          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                              Ver horarios (JSON)
                            </summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                              {formatValue(detail.brand.openingHours)}
                            </pre>
                          </details>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Metadatos</p>
                        <details className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                            Ver metadata (JSON)
                          </summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                            {formatValue(detail.brand.metadata)}
                          </pre>
                        </details>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scraping</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <p>
                            <span className="font-semibold text-slate-800">Última ejecución:</span>{" "}
                            {formatDate(detail.lastJob?.finishedAt ?? detail.lastJob?.createdAt)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Estado:</span>{" "}
                            {detail.lastJob?.status ?? "—"}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Cambios:</span>{" "}
                            {detail.lastJob?.result?.changes?.length ?? 0}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Estado</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <p>
                          <span className="font-semibold text-slate-800">Activo:</span>{" "}
                          {detail.brand.isActive ? "Sí" : "No"}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Actualizado:</span>{" "}
                          {formatDate(detail.brand.updatedAt)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Creado:</span>{" "}
                          {formatDate(detail.brand.createdAt)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Revisión:</span>{" "}
                          {toText(detail.brand.reviewed)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No se encontró la marca.</p>
                )
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Nombre</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.name}
                        onChange={(event) => handleFormChange("name", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Slug</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.slug}
                        onChange={(event) => handleFormChange("slug", event.target.value)}
                        placeholder="auto"
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Sitio web</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.siteUrl}
                        onChange={(event) => handleFormChange("siteUrl", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Logo URL</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.logoUrl}
                        onChange={(event) => handleFormChange("logoUrl", event.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs uppercase tracking-wide text-slate-500">Descripción</label>
                      <textarea
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        rows={4}
                        value={formState.description}
                        onChange={(event) => handleFormChange("description", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Categoría</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.category}
                        onChange={(event) => handleFormChange("category", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Subcategoría</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.productCategory}
                        onChange={(event) => handleFormChange("productCategory", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Mercado</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.market}
                        onChange={(event) => handleFormChange("market", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Estilo</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.style}
                        onChange={(event) => handleFormChange("style", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Escala</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.scale}
                        onChange={(event) => handleFormChange("scale", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Precio promedio</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.avgPrice}
                        onChange={(event) => handleFormChange("avgPrice", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Email</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.contactEmail}
                        onChange={(event) => handleFormChange("contactEmail", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Teléfono</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.contactPhone}
                        onChange={(event) => handleFormChange("contactPhone", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Instagram</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.instagram}
                        onChange={(event) => handleFormChange("instagram", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">TikTok</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.tiktok}
                        onChange={(event) => handleFormChange("tiktok", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Facebook</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.facebook}
                        onChange={(event) => handleFormChange("facebook", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">WhatsApp</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.whatsapp}
                        onChange={(event) => handleFormChange("whatsapp", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Dirección</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.address}
                        onChange={(event) => handleFormChange("address", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Ciudad</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.city}
                        onChange={(event) => handleFormChange("city", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Latitud</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.lat}
                        onChange={(event) => handleFormChange("lat", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Longitud</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.lng}
                        onChange={(event) => handleFormChange("lng", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Horarios (JSON)</label>
                      <textarea
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        rows={6}
                        value={formState.openingHours}
                        onChange={(event) => handleFormChange("openingHours", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Metadata (JSON)</label>
                      <textarea
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        rows={6}
                        value={formState.metadata}
                        onChange={(event) => handleFormChange("metadata", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Reviewed</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.reviewed}
                        onChange={(event) => handleFormChange("reviewed", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Rating Stars</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.ratingStars}
                        onChange={(event) => handleFormChange("ratingStars", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Rating Score</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.ratingScore}
                        onChange={(event) => handleFormChange("ratingScore", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Source Sheet</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.sourceSheet}
                        onChange={(event) => handleFormChange("sourceSheet", event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-slate-500">Source File</label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.sourceFile}
                        onChange={(event) => handleFormChange("sourceFile", event.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        id="isActive"
                        type="checkbox"
                        checked={formState.isActive}
                        onChange={(event) => handleFormChange("isActive", event.target.checked)}
                      />
                      <label htmlFor="isActive" className="text-sm text-slate-600">
                        Marca activa
                      </label>
                    </div>
                  </div>

                  {formError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {formError}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
              <div className="flex flex-wrap gap-2">
                {modalMode === "detail" && (
                  <>
                    <button
                      type="button"
                      onClick={() => activeBrandId && openEdit(activeBrandId)}
                      className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="rounded-full border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700"
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
              {modalMode !== "detail" && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={actionLoading}
                  className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {actionLoading ? "Guardando..." : "Guardar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
