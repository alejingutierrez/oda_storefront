"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { proxiedImageUrl } from "@/lib/image-proxy";

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
  ecommercePlatform?: string | null;
  manualReview?: boolean | null;
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
  unprocessedQueued?: number;
  unprocessedFailed?: number;
  unprocessedNoJobs?: number;
  unprocessedManualReview?: number;
  unprocessedCloudflare?: number;
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
  categories?: string[];
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
  ecommercePlatform: string | null;
  manualReview: boolean;
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
  productStats?: {
    productCount: number;
    avgPrice: number | string | null;
    avgPriceCurrency: string | null;
  } | null;
  previewProducts?: Array<{
    id: string;
    name: string;
    imageCoverUrl: string | null;
    sourceUrl: string | null;
    category: string | null;
    subcategory: string | null;
    updatedAt: string;
    minPrice: number | string | null;
    maxPrice: number | string | null;
    currency: string | null;
  }>;
};

type OnboardingStepKey =
  | "brand_enrich"
  | "tech_profile"
  | "catalog_extract"
  | "product_enrich";

type OnboardingStepStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "blocked";

type OnboardingStatus =
  | "idle"
  | "processing"
  | "completed"
  | "failed"
  | "blocked";

type OnboardingStepInfo = {
  status: OnboardingStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  jobId?: string | null;
  runId?: string | null;
  detail?: Record<string, unknown> | null;
};

type OnboardingState = {
  status: OnboardingStatus;
  step: OnboardingStepKey | null;
  steps: Record<OnboardingStepKey, OnboardingStepInfo>;
  updatedAt: string;
};

type OnboardingProgress = {
  brandEnrich?: {
    jobStatus?: string | null;
    changes?: number;
    jobId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  };
  techProfile?: {
    platform?: string | null;
    confidence?: number | null;
    risks?: string[];
  };
  catalog?: {
    runId: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    pending: number;
    lastError?: string | null;
    blockReason?: string | null;
    lastUrl?: string | null;
    lastStage?: string | null;
    consecutiveErrors?: number;
  } | null;
  productEnrichment?: {
    summary?: {
      runId: string;
      status: string;
      total: number;
      completed: number;
      failed: number;
      pending: number;
      lastError?: string | null;
      blockReason?: string | null;
      lastProductId?: string | null;
      lastStage?: string | null;
      consecutiveErrors?: number;
    } | null;
    counts?: {
      total: number;
      enriched: number;
      remaining: number;
    };
  };
};

type OnboardingResponse = {
  onboarding: OnboardingState;
  progress: OnboardingProgress;
  brand: {
    id: string;
    name: string;
    ecommercePlatform: string | null;
    manualReview: boolean;
  };
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
  ecommercePlatform: string;
  manualReview: boolean;
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

const ONBOARDING_STEPS: Array<{ key: OnboardingStepKey; label: string }> = [
  { key: "brand_enrich", label: "Enriquecimiento de marca" },
  { key: "tech_profile", label: "Tech profiler" },
  { key: "catalog_extract", label: "Extracción de catálogo" },
  { key: "product_enrich", label: "Enriquecimiento de productos" },
];

const STATUS_LABELS: Record<OnboardingStepStatus, string> = {
  pending: "Pendiente",
  processing: "En progreso",
  completed: "Listo",
  failed: "Falló",
  blocked: "Bloqueado",
};

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
  ecommercePlatform: "",
  manualReview: false,
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

const toPriceNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPriceRange = (min: number | string | null, max: number | string | null) => {
  const minValue = toPriceNumber(min);
  const maxValue = toPriceNumber(max);
  if (minValue === null && maxValue === null) return "—";
  if (minValue !== null && (maxValue === null || maxValue === minValue)) return formatMoney(minValue);
  if (minValue === null && maxValue !== null) return formatMoney(maxValue);
  return `${formatMoney(minValue)} - ${formatMoney(maxValue)}`;
};

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const normalizeFilterParam = (value: string | null) => {
  if (value === "processed" || value === "unprocessed" || value === "all") return value;
  return null;
};

const normalizeCategories = (values: string[]) => {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
};

const parseCategoryParams = (params: URLSearchParams) =>
  normalizeCategories(params.getAll("category").flatMap((value) => value.split(",")));

const parseProductSortParam = (params: URLSearchParams) => {
  if (params.get("sort") !== "productCount") return "none";
  const order = params.get("order");
  if (order === "asc" || order === "desc") return order;
  return "desc";
};

const isSameStringArray = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const formatPlatform = (value: string | null) => {
  if (!value) return "—";
  if (value === "unknown") return "Desconocida";
  if (value === "custom") return "Custom";
  if (value === "tiendanube") return "Tiendanube";
  if (value === "wix") return "Wix";
  return value;
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

const shouldSkipOptimization = (src: string | null | undefined) =>
  !!src && src.startsWith("/api/image-proxy");

function BrandAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [error, setError] = useState(false);
  const proxiedLogo = proxiedImageUrl(logoUrl);
  if (proxiedLogo && !error) {
    return (
      <img
        src={proxiedLogo}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = parsePositiveInt(searchParams.get("page"), 1);
  const initialFilter = normalizeFilterParam(searchParams.get("filter")) ?? "processed";
  const initialCategories = parseCategoryParams(searchParams);
  const initialProductSort = parseProductSortParam(searchParams);
  const [brandData, setBrandData] = useState<BrandListResponse | null>(null);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [page, setPage] = useState(initialPage);
  const [filter, setFilter] = useState<"processed" | "unprocessed" | "all">(initialFilter);
  const [categoryFilters, setCategoryFilters] = useState<string[]>(initialCategories);
  const [productSort, setProductSort] = useState<"none" | "asc" | "desc">(initialProductSort);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"detail" | "edit" | "create">("detail");
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrandDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formState, setFormState] = useState<BrandFormState>({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [onboardingProgress, setOnboardingProgress] = useState<OnboardingProgress | null>(null);
  const [onboardingBrandId, setOnboardingBrandId] = useState<string | null>(null);
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [manualReviewLoading, setManualReviewLoading] = useState(false);
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
      categoryFilters.forEach((category) => {
        params.append("category", category);
      });
      if (productSort !== "none") {
        params.set("sort", "productCount");
        params.set("order", productSort);
      }
      const res = await fetch(`/api/admin/brands?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el directorio de marcas");
      const payload = (await res.json()) as BrandListResponse;
      setBrandData(payload);
      if (payload.totalPages && page > payload.totalPages) {
        setPage(payload.totalPages);
      }
    } catch (err) {
      console.warn(err);
    } finally {
      setBrandsLoading(false);
    }
  }, [categoryFilters, filter, page, productSort]);

  useEffect(() => {
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextFilter = normalizeFilterParam(searchParams.get("filter")) ?? "processed";
    const nextCategories = parseCategoryParams(searchParams);
    const nextProductSort = parseProductSortParam(searchParams);
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setFilter((prev) => (prev === nextFilter ? prev : nextFilter));
    setCategoryFilters((prev) =>
      isSameStringArray(prev, nextCategories) ? prev : nextCategories,
    );
    setProductSort((prev) => (prev === nextProductSort ? prev : nextProductSort));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    params.set("filter", filter);
    params.delete("category");
    categoryFilters.forEach((category) => {
      params.append("category", category);
    });
    if (productSort === "none") {
      params.delete("sort");
      params.delete("order");
    } else {
      params.set("sort", "productCount");
      params.set("order", productSort);
    }
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(`/admin/brands?${next}`, { scroll: false });
    }
  }, [categoryFilters, filter, page, productSort, router, searchParams]);

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
  const pendingQueued = summary?.unprocessedQueued ?? 0;
  const pendingFailed = summary?.unprocessedFailed ?? 0;
  const pendingNoJobs = summary?.unprocessedNoJobs ?? 0;
  const pendingManualReview = summary?.unprocessedManualReview ?? 0;
  const pendingCloudflare = summary?.unprocessedCloudflare ?? 0;
  const totalPages = brandData?.totalPages ?? 1;
  const availableCategories = brandData?.categories ?? [];
  const categoryLabel = useMemo(() => {
    if (categoryFilters.length === 0) return "Todas";
    const visible = categoryFilters.slice(0, 2).join(", ");
    const extra = categoryFilters.length > 2 ? ` +${categoryFilters.length - 2}` : "";
    return `${visible}${extra}`;
  }, [categoryFilters]);

  const toggleCategory = useCallback((value: string) => {
    setPage(1);
    setCategoryFilters((prev) => {
      const next = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];
      return normalizeCategories(next);
    });
  }, []);

  const clearCategories = useCallback(() => {
    setPage(1);
    setCategoryFilters([]);
  }, []);

  const handleSortChange = useCallback((value: "none" | "asc" | "desc") => {
    setPage(1);
    setProductSort(value);
  }, []);

  const pageNumbers = useMemo(() => {
    const total = totalPages;
    const current = page;
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    const numbers = [];
    for (let i = start; i <= end; i += 1) numbers.push(i);
    return numbers;
  }, [page, totalPages]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !categoryMenuRef.current) return;
      if (!categoryMenuRef.current.contains(target)) {
        setCategoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [categoryMenuOpen]);

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
    setOnboardingState(null);
    setOnboardingProgress(null);
    setOnboardingBrandId(null);
    setOnboardingMessage(null);
    setOnboardingLoading(false);
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
          ecommercePlatform: payload.brand.ecommercePlatform ?? "",
          manualReview: payload.brand.manualReview ?? false,
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
    setOnboardingState(null);
    setOnboardingProgress(null);
    setOnboardingBrandId(null);
    setOnboardingMessage(null);
    setOnboardingLoading(false);
    openModal();
  }, [openModal]);

  const shouldPollOnboarding =
    modalOpen &&
    modalMode === "create" &&
    !!onboardingBrandId &&
    onboardingState?.status === "processing";

  useEffect(() => {
    if (!shouldPollOnboarding || !onboardingBrandId) return;
    const interval = window.setInterval(() => {
      refreshOnboardingState(onboardingBrandId, { silent: true });
    }, 8000);
    return () => window.clearInterval(interval);
  }, [shouldPollOnboarding, onboardingBrandId, refreshOnboardingState]);

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
      ecommercePlatform: formState.ecommercePlatform.trim() || null,
      avgPrice: parseNumber(formState.avgPrice),
      manualReview: formState.manualReview,
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

  const applyOnboardingPayload = useCallback((payload: OnboardingResponse) => {
    setOnboardingState(payload.onboarding);
    setOnboardingProgress(payload.progress);
    setOnboardingBrandId(payload.brand.id);
    setActiveBrandId(payload.brand.id);
  }, []);

  const refreshOnboardingState = useCallback(
    async (brandId: string, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setOnboardingLoading(true);
      }
      try {
        const res = await fetch(`/api/admin/brands/${brandId}/onboard/state`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const errorPayload = await res.json().catch(() => null);
          throw new Error(errorPayload?.error ?? "No se pudo consultar el estado de onboarding");
        }
        const payload = (await res.json()) as OnboardingResponse;
        applyOnboardingPayload(payload);
        setOnboardingMessage(null);
      } catch (err) {
        setOnboardingMessage(
          err instanceof Error ? err.message : "Error al actualizar el onboarding",
        );
      } finally {
        if (!options?.silent) {
          setOnboardingLoading(false);
        }
      }
    },
    [applyOnboardingPayload],
  );

  const handleCreateAndOnboard = async () => {
    setFormError(null);
    setOnboardingMessage(null);
    const payload = buildPayload();
    if (!payload) return;

    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, skipTechProfile: true }),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "No se pudo crear la marca");
      }
      const created = (await res.json()) as { brand: BrandDetail };
      if (!created?.brand?.id) {
        throw new Error("Respuesta inválida al crear la marca");
      }
      setOnboardingBrandId(created.brand.id);
      setActiveBrandId(created.brand.id);

      const onboardRes = await fetch(`/api/admin/brands/${created.brand.id}/onboard/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!onboardRes.ok) {
        const errorPayload = await onboardRes.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "No se pudo iniciar el onboarding");
      }
      const onboardPayload = (await onboardRes.json()) as OnboardingResponse;
      applyOnboardingPayload(onboardPayload);
      await fetchBrands();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error inesperado al crear la marca");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestartOnboarding = async () => {
    if (!onboardingBrandId) return;
    setOnboardingLoading(true);
    setOnboardingMessage(null);
    try {
      const res = await fetch(`/api/admin/brands/${onboardingBrandId}/onboard/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "No se pudo reintentar el onboarding");
      }
      const payload = (await res.json()) as OnboardingResponse;
      applyOnboardingPayload(payload);
    } catch (err) {
      setOnboardingMessage(
        err instanceof Error ? err.message : "Error al reintentar el onboarding",
      );
    } finally {
      setOnboardingLoading(false);
    }
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
    const confirmed = window.confirm(
      "¿Seguro quieres eliminar esta marca? Esto borrará marca, productos, variantes, historiales y runs asociados.",
    );
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

  const toggleManualReview = async () => {
    if (!activeBrandId || !detail?.brand) return;
    const nextValue = !detail.brand.manualReview;
    setManualReviewLoading(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/admin/brands/${activeBrandId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualReview: nextValue }),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "No se pudo actualizar la revisión manual");
      }
      const payload = await res.json();
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              brand: {
                ...prev.brand,
                manualReview: payload.brand?.manualReview ?? nextValue,
              },
            }
          : prev,
      );
      await fetchBrands();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setManualReviewLoading(false);
    }
  };

  const onboardingPercent = useMemo(() => {
    if (!onboardingState) return 0;
    const completed = ONBOARDING_STEPS.filter(
      (step) => onboardingState.steps?.[step.key]?.status === "completed",
    ).length;
    return Math.round((completed / ONBOARDING_STEPS.length) * 100);
  }, [onboardingState]);

  const overallStatusLabel = useMemo(() => {
    if (!onboardingState) return "Sin iniciar";
    if (onboardingState.status === "idle") return "Pendiente";
    if (onboardingState.status === "processing") return "En progreso";
    if (onboardingState.status === "completed") return "Completado";
    if (onboardingState.status === "blocked") return "Bloqueado";
    return "Fallido";
  }, [onboardingState]);

  const blockedStep = useMemo(() => {
    if (!onboardingState) return null;
    return ONBOARDING_STEPS.find(
      (step) => onboardingState.steps?.[step.key]?.status === "blocked",
    );
  }, [onboardingState]);

  const renderStepDetail = (stepKey: OnboardingStepKey, step: OnboardingStepInfo) => {
    const started = step.startedAt ? formatDate(step.startedAt) : null;
    const finished = step.finishedAt ? formatDate(step.finishedAt) : null;

    if (stepKey === "brand_enrich") {
      return (
        <div className="mt-2 space-y-1 text-xs text-slate-500">
          <p>
            Job: {onboardingProgress?.brandEnrich?.jobStatus ?? "—"} · Cambios detectados:{" "}
            {onboardingProgress?.brandEnrich?.changes ?? 0}
          </p>
          {started && <p>Inicio: {started}</p>}
          {finished && <p>Fin: {finished}</p>}
        </div>
      );
    }
    if (stepKey === "tech_profile") {
      const tech = onboardingProgress?.techProfile;
      const risks = tech?.risks ?? [];
      return (
        <div className="mt-2 space-y-1 text-xs text-slate-500">
          <p>Plataforma: {tech?.platform ?? "—"}</p>
          <p>Confianza: {typeof tech?.confidence === "number" ? tech.confidence : "—"}</p>
          <p>Riesgos: {risks.length ? risks.join(", ") : "—"}</p>
          {started && <p>Inicio: {started}</p>}
          {finished && <p>Fin: {finished}</p>}
        </div>
      );
    }
    if (stepKey === "catalog_extract") {
      const summary = onboardingProgress?.catalog;
      return (
        <div className="mt-2 space-y-1 text-xs text-slate-500">
          <p>
            Items: {summary?.completed ?? 0}/{summary?.total ?? 0} · Pendientes:{" "}
            {summary?.pending ?? 0} · Fallas: {summary?.failed ?? 0}
          </p>
          {summary?.lastStage && <p>Última etapa: {summary.lastStage}</p>}
          {summary?.lastError && <p>Error: {summary.lastError}</p>}
          {summary?.blockReason && <p>Bloqueo: {summary.blockReason}</p>}
          {started && <p>Inicio: {started}</p>}
          {finished && <p>Fin: {finished}</p>}
        </div>
      );
    }
    if (stepKey === "product_enrich") {
      const summary = onboardingProgress?.productEnrichment?.summary;
      const counts = onboardingProgress?.productEnrichment?.counts;
      return (
        <div className="mt-2 space-y-1 text-xs text-slate-500">
          <p>
            Productos enriquecidos: {counts?.enriched ?? 0}/{counts?.total ?? 0} · Pendientes:{" "}
            {counts?.remaining ?? 0}
          </p>
          {summary && (
            <p>
              Items: {summary.completed}/{summary.total} · Pendientes: {summary.pending} ·
              Fallas: {summary.failed}
            </p>
          )}
          {summary?.lastError && <p>Error: {summary.lastError}</p>}
          {summary?.blockReason && <p>Bloqueo: {summary.blockReason}</p>}
          {started && <p>Inicio: {started}</p>}
          {finished && <p>Fin: {finished}</p>}
        </div>
      );
    }
    return null;
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
          <p className="mt-1 text-[11px] text-slate-500">
            En cola: {pendingQueued} · sin job: {pendingNoJobs} · fallidas: {pendingFailed}
          </p>
          {(pendingManualReview > 0 || pendingCloudflare > 0) && (
            <p className="mt-1 text-[11px] text-slate-400">
              Manual review: {pendingManualReview} · Cloudflare: {pendingCloudflare}
            </p>
          )}
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

      <div className="mt-4 grid gap-4 text-sm text-slate-600 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Categorias</p>
          <div ref={categoryMenuRef} className="relative mt-2">
            <button
              type="button"
              onClick={() => setCategoryMenuOpen((prev) => !prev)}
              aria-expanded={categoryMenuOpen}
              aria-haspopup="listbox"
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <span>{categoryLabel}</span>
              <span className="text-xs text-slate-400">{categoryMenuOpen ? "▲" : "▼"}</span>
            </button>
            {categoryMenuOpen && (
              <div className="absolute left-0 right-0 z-30 mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    clearCategories();
                    setCategoryMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold ${
                    categoryFilters.length === 0
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>Todas</span>
                  {categoryFilters.length === 0 && <span>✓</span>}
                </button>
                <div className="my-2 h-px bg-slate-200" />
                {availableCategories.length ? (
                  availableCategories.map((category) => {
                    const selected = categoryFilters.includes(category);
                    return (
                      <label
                        key={category}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleCategory(category)}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                          />
                          {category}
                        </span>
                        {selected && <span className="text-indigo-600">✓</span>}
                      </label>
                    );
                  })
                ) : (
                  <span className="block px-3 py-2 text-xs text-slate-400">
                    Sin categorias registradas.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Orden por productos</p>
          <select
            value={productSort}
            onChange={(event) => handleSortChange(event.target.value as "none" | "asc" | "desc")}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="none">Nombre (A-Z)</option>
            <option value="desc">Productos: mayor a menor</option>
            <option value="asc">Productos: menor a mayor</option>
          </select>
        </div>
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
                  <div className="flex items-center gap-2">
                    {brand.manualReview && (
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600"
                        title="Revisada manualmente"
                      >
                        <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                          <path d="M8.1 13.4 4.7 10l1.4-1.4 2 2 5.7-5.7 1.4 1.4-7.1 7.1Z" />
                        </svg>
                      </span>
                    )}
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
                    {(() => {
                      const stats = detail.productStats ?? null;
                      const preview = detail.previewProducts ?? [];
                      const productCount = stats?.productCount ?? 0;
                      const avgPriceValue = stats?.avgPrice ?? detail.brand.avgPrice;
                      return (
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Productos</p>
                            <p className="mt-1 text-lg font-semibold text-slate-900">
                              {productCount.toLocaleString("es-CO")}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Precio promedio (real)
                            </p>
                            <p className="mt-1 text-lg font-semibold text-slate-900">
                              {formatMoney(avgPriceValue)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Calculado con precios de productos scrapeados.
                            </p>
                          </div>
                          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                Preview de productos (10)
                              </p>
                              <a
                                href="/admin/products"
                                className="text-xs font-semibold text-indigo-600 hover:underline"
                              >
                                Ver directorio completo
                              </a>
                            </div>
                            {preview.length ? (
                              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                                {preview.map((product) => {
                                  const coverSrc = proxiedImageUrl(product.imageCoverUrl, {
                                    productId: product.id,
                                    kind: "cover",
                                  });
                                  const unoptimized = shouldSkipOptimization(coverSrc);
                                  return (
                                    <a
                                      key={product.id}
                                      href={`/admin/products?productId=${product.id}`}
                                      className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
                                      title={`Ver detalle de ${product.name}`}
                                    >
                                      <div className="relative aspect-[4/5] w-full bg-slate-100">
                                        {coverSrc ? (
                                          <Image
                                            src={coverSrc}
                                            alt={product.name}
                                            fill
                                            unoptimized={unoptimized}
                                            sizes="(min-width: 1024px) 12vw, (min-width: 768px) 20vw, 45vw"
                                            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                          />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">
                                            Sin foto
                                          </div>
                                        )}
                                      </div>
                                      <div className="space-y-1 px-2 py-2">
                                        <p className="line-clamp-2 text-xs font-semibold text-slate-800">
                                          {product.name}
                                        </p>
                                        <p className="text-[11px] text-slate-500">
                                          {formatPriceRange(product.minPrice, product.maxPrice)}
                                        </p>
                                      </div>
                                    </a>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="mt-3 text-sm text-slate-500">
                                Esta marca aún no tiene productos scrapeados.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
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
                            <span className="font-semibold text-slate-800">Tecnología ecommerce:</span>{" "}
                            {formatPlatform(detail.brand.ecommercePlatform)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Productos:</span>{" "}
                            {(detail.productStats?.productCount ?? 0).toLocaleString("es-CO")}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Precio promedio:</span>{" "}
                            {formatMoney(detail.productStats?.avgPrice ?? detail.brand.avgPrice)}
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
                        <p className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800">Revisión manual:</span>{" "}
                          {detail.brand.manualReview ? "Sí" : "No"}
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
                        <div className="md:col-span-2">
                          <button
                            type="button"
                            onClick={toggleManualReview}
                            disabled={manualReviewLoading}
                            className={`rounded-full px-4 py-2 text-xs font-semibold ${
                              detail.brand.manualReview
                                ? "border border-slate-200 bg-white text-slate-600"
                                : "bg-blue-600 text-white"
                            } disabled:opacity-60`}
                          >
                            {manualReviewLoading
                              ? "Actualizando..."
                              : detail.brand.manualReview
                                ? "Quitar revisión manual"
                                : "Marcar revisada manualmente"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No se encontró la marca.</p>
                )
              ) : (
                <div className="space-y-4">
                  {modalMode === "create" && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            Onboarding de marca
                          </p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            Estado general: {overallStatusLabel}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {onboardingBrandId
                              ? "El flujo se actualiza automáticamente cada pocos segundos."
                              : "Completa el formulario y pulsa \"Crear y enriquecer\" para iniciar el flujo completo."}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {onboardingBrandId && (
                            <button
                              type="button"
                              onClick={() =>
                                onboardingBrandId &&
                                refreshOnboardingState(onboardingBrandId, { silent: false })
                              }
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
                            >
                              {onboardingLoading ? "Actualizando..." : "Refrescar"}
                            </button>
                          )}
                          {(onboardingState?.status === "blocked" ||
                            onboardingState?.status === "failed") && (
                            <button
                              type="button"
                              onClick={handleRestartOnboarding}
                              className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Reintentar
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="h-2 w-full rounded-full bg-white">
                          <div
                            className="h-2 rounded-full bg-indigo-500 transition-all"
                            style={{ width: `${onboardingPercent}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{onboardingPercent}% completado</span>
                          {onboardingBrandId && <span>ID: {onboardingBrandId}</span>}
                        </div>
                      </div>

                      {onboardingMessage && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          {onboardingMessage}
                        </div>
                      )}

                      {blockedStep && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          El flujo se bloqueó en: {blockedStep.label}. Revisa la causa y reintenta o
                          corrige la marca.
                        </div>
                      )}

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {ONBOARDING_STEPS.map((step) => {
                          const info = onboardingState?.steps?.[step.key];
                          const status = info?.status ?? "pending";
                          const pillClass =
                            status === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : status === "failed"
                                ? "bg-rose-100 text-rose-700"
                                : status === "blocked"
                                  ? "bg-amber-100 text-amber-700"
                                  : status === "processing"
                                    ? "bg-indigo-100 text-indigo-700"
                                    : "bg-slate-200 text-slate-600";
                          return (
                            <div key={step.key} className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${pillClass}`}>
                                  {STATUS_LABELS[status]}
                                </span>
                              </div>
                              {info?.error && (
                                <p className="mt-2 text-xs text-rose-600">Detalle: {info.error}</p>
                              )}
                              {info ? renderStepDetail(step.key, info) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                      <label className="text-xs uppercase tracking-wide text-slate-500">
                        Tecnología ecommerce
                      </label>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={formState.ecommercePlatform}
                        onChange={(event) => handleFormChange("ecommercePlatform", event.target.value)}
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
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        id="manualReview"
                        type="checkbox"
                        checked={formState.manualReview}
                        onChange={(event) => handleFormChange("manualReview", event.target.checked)}
                      />
                      <label htmlFor="manualReview" className="text-sm text-slate-600">
                        Revisión manual
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
                <>
                  {modalMode === "create" ? (
                    <button
                      type="button"
                      onClick={handleCreateAndOnboard}
                      disabled={actionLoading || Boolean(onboardingBrandId)}
                      className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {actionLoading ? "Creando..." : "Crear y enriquecer"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={actionLoading}
                      className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {actionLoading ? "Guardando..." : "Guardar"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
