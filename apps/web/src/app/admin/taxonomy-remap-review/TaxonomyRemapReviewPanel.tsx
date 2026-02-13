"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/image-proxy";

type BrandOption = {
  id: string;
  name: string;
  productCount: number;
};

type ChangeTypeFilter = "all" | "taxonomy" | "gender_only";

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
  changeType: ChangeTypeFilter | "none";
};

type StatusFilter = "pending" | "accepted" | "rejected" | "all";

type ReviewsResponse = {
  items: ReviewItem[];
  summary: {
    pending: number;
    accepted: number;
    rejected: number;
  };
  changeSummary?: {
    taxonomy: number;
    gender_only: number;
    none: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  phase?: {
    enabled: boolean;
    running: boolean;
    runningExecutionId: string | null;
    runningTrigger: string | null;
    runningSince: string | null;
    pendingThreshold: number;
    autoLimit: number;
    cooldownMinutes: number;
    pendingCount: number;
    remainingForPhase: number;
    remainingToTrigger: number;
    readyToTrigger: boolean;
    lastAutoReseedAt: string | null;
    lastAutoReseedSource: string | null;
    lastAutoReseedRunKey: string | null;
    lastAutoReseedCreated: number;
    lastAutoReseedPendingNow: number;
    reviewedSinceLastAuto: number;
    lastRunStatus: string | null;
    lastRunReason: string | null;
  };
  catalog?: {
    totalProducts: number;
    reviewedProducts: number;
    pendingProducts: number;
    remainingProducts: number;
    eligibleProducts: number;
    eligibleReviewedProducts: number;
    eligiblePendingProducts: number;
    eligibleRemainingProducts: number;
  };
};

type AutoReseedResult = {
  triggered: boolean;
  reason:
    | "triggered"
    | "disabled"
    | "pending_above_threshold"
    | "cooldown_active"
    | "already_running"
    | "no_candidates"
    | "error";
  pendingCount: number;
  pendingThreshold: number;
  scanned: number;
  proposed: number;
  enqueued: number;
  executionId: string | null;
  source: string | null;
  runKey: string | null;
  learningAcceptedSamples: number;
  learningRejectedSamples: number;
  error?: string;
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pendientes" },
  { value: "accepted", label: "Aceptadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "all", label: "Todas" },
];
const CHANGE_TYPE_OPTIONS: Array<{ value: ChangeTypeFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "taxonomy", label: "Categoría/Subcategoría" },
  { value: "gender_only", label: "Solo género" },
];

const PAGE_LIMIT = 40;
const OPTIMISTIC_TTL_MS = 15_000;

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

const AUTO_RESEED_REASON_LABEL: Record<AutoReseedResult["reason"], string> = {
  triggered: "Batch creado",
  disabled: "Desactivado por configuración",
  pending_above_threshold: "Pendientes por encima del umbral",
  cooldown_active: "Cooldown activo",
  already_running: "Ya hay una ejecución en curso",
  no_candidates: "Sin candidatos elegibles",
  error: "Error en ejecución",
};

const normalizeComparable = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const hasChanged = (from: string | null | undefined, to: string | null | undefined) =>
  normalizeComparable(from) !== normalizeComparable(to);

function DiffField({
  label,
  from,
  to,
  changed,
}: {
  label: string;
  from: string | null | undefined;
  to: string | null | undefined;
  changed: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        changed ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
          changed ? "text-amber-700" : "text-slate-500"
        }`}
      >
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        <span
          className={`rounded-md px-2 py-1 ${
            changed
              ? "bg-rose-100 font-medium text-rose-700"
              : "bg-slate-200 text-slate-600"
          }`}
        >
          {formatNullable(from)}
        </span>
        <span className={changed ? "font-semibold text-amber-700" : "text-slate-400"}>
          {changed ? "→" : "="}
        </span>
        <span
          className={`rounded-md px-2 py-1 ${
            changed
              ? "bg-emerald-100 font-semibold text-emerald-700"
              : "bg-slate-200 text-slate-700"
          }`}
        >
          {formatNullable(to)}
        </span>
      </div>
    </div>
  );
}

export default function TaxonomyRemapReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [summary, setSummary] = useState({ pending: 0, accepted: 0, rejected: 0 });
  const [changeSummary, setChangeSummary] = useState({ taxonomy: 0, gender_only: 0, none: 0 });
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [changeType, setChangeType] = useState<ChangeTypeFilter>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [brandId, setBrandId] = useState("");
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionById, setActionById] = useState<Record<string, "accept" | "reject">>({});
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);
  const [autoReseedBusy, setAutoReseedBusy] = useState(false);
  const [decisionBusyCount, setDecisionBusyCount] = useState(0);
  const [autoReseedFeedback, setAutoReseedFeedback] = useState<{
    at: string;
    source: "manual" | "decision";
    result: AutoReseedResult;
  } | null>(null);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightDecisionRef = useRef<Set<string>>(new Set());
  const [brokenImageById, setBrokenImageById] = useState<Record<string, true>>({});
  const optimisticDecisionsRef = useRef<
    Map<string, { status: "accepted" | "rejected"; decidedAt: string }>
  >(new Map());
  const [phase, setPhase] = useState<NonNullable<ReviewsResponse["phase"]>>({
    enabled: true,
    running: false,
    runningExecutionId: null,
    runningTrigger: null,
    runningSince: null,
    pendingThreshold: 100,
    autoLimit: 10_000,
    cooldownMinutes: 120,
    pendingCount: 0,
    remainingForPhase: 0,
    remainingToTrigger: 0,
    readyToTrigger: false,
    lastAutoReseedAt: null,
    lastAutoReseedSource: null,
    lastAutoReseedRunKey: null,
    lastAutoReseedCreated: 0,
    lastAutoReseedPendingNow: 0,
    reviewedSinceLastAuto: 0,
    lastRunStatus: null,
    lastRunReason: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [catalogCounters, setCatalogCounters] = useState<
    NonNullable<ReviewsResponse["catalog"]>
  >({
    totalProducts: 0,
    reviewedProducts: 0,
    pendingProducts: 0,
    remainingProducts: 0,
    eligibleProducts: 0,
    eligibleReviewedProducts: 0,
    eligiblePendingProducts: 0,
    eligibleRemainingProducts: 0,
  });

  const hasFilters = useMemo(() => {
    return Boolean(search.trim()) || Boolean(brandId) || status !== "pending" || changeType !== "all";
  }, [search, brandId, status, changeType]);

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

  const mergeIncomingItems = useCallback(
    (incoming: ReviewItem[]) => {
      const optimistic = optimisticDecisionsRef.current;
      if (optimistic.size) {
        const now = Date.now();
        for (const [id, value] of optimistic.entries()) {
          const decidedAtMs = new Date(value.decidedAt).getTime();
          if (!Number.isFinite(decidedAtMs) || now - decidedAtMs > OPTIMISTIC_TTL_MS) {
            optimistic.delete(id);
          }
        }
      }
      if (!optimistic.size) return incoming;
      for (const entry of incoming) {
        if (entry.status !== "pending" && optimistic.has(entry.id)) {
          optimistic.delete(entry.id);
        }
      }
      if (!optimistic.size) return incoming;
      return incoming
        .filter((entry) => !(status === "pending" && optimistic.has(entry.id)))
        .map((entry) => {
          const localDecision = optimistic.get(entry.id);
          if (!localDecision) return entry;
          if (entry.status !== "pending") return entry;
          if (status === "all") {
            return {
              ...entry,
              status: localDecision.status,
              decidedAt: localDecision.decidedAt,
              decisionError: null,
            };
          }
          return entry;
        });
    },
    [status],
  );

  const fetchItems = useCallback(async () => {
    const silent = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("changeType", changeType);
      params.set("page", String(page));
      params.set("limit", String(PAGE_LIMIT));
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
      setItems(mergeIncomingItems(Array.isArray(payload.items) ? payload.items : []));
      setSummary(payload.summary ?? { pending: 0, accepted: 0, rejected: 0 });
      setChangeSummary(payload.changeSummary ?? { taxonomy: 0, gender_only: 0, none: 0 });
      if (payload.phase) setPhase(payload.phase);
      if (payload.catalog) setCatalogCounters(payload.catalog);
      setTotal(payload.pagination?.total ?? 0);
      setTotalPages(Math.max(1, payload.pagination?.totalPages ?? 1));
    } catch (err) {
      if (!silent) {
        setItems([]);
        setError(err instanceof Error ? err.message : "No se pudo cargar la cola de revisión");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [status, changeType, page, search, brandId, mergeIncomingItems]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const fetchItemsSilent = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("changeType", changeType);
      params.set("page", String(page));
      params.set("limit", String(PAGE_LIMIT));
      if (search.trim()) params.set("search", search.trim());
      if (brandId) params.set("brandId", brandId);
      const res = await fetch(`/api/admin/taxonomy-remap/reviews?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const payload = (await res.json().catch(() => null)) as ReviewsResponse | null;
      if (!payload) return;
      if (Array.isArray(payload.items)) setItems(mergeIncomingItems(payload.items));
      if (payload.summary) setSummary(payload.summary);
      if (payload.changeSummary) setChangeSummary(payload.changeSummary);
      if (payload.phase) setPhase(payload.phase);
      if (payload.catalog) setCatalogCounters(payload.catalog);
      if (payload.pagination) {
        setTotal(payload.pagination.total ?? 0);
        setTotalPages(Math.max(1, payload.pagination.totalPages ?? 1));
      }
    } catch {
      // silent refresh should not disrupt review flow
    }
  }, [status, changeType, page, search, brandId, mergeIncomingItems]);

  useEffect(() => {
    const shouldPoll = phase.running || autoReseedBusy || decisionBusyCount > 0;
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      void fetchItemsSilent();
    }, 2500);
    return () => clearInterval(timer);
  }, [phase.running, autoReseedBusy, decisionBusyCount, fetchItemsSilent]);

  const scheduleSilentRefresh = useCallback(() => {
    if (silentRefreshTimerRef.current) {
      clearTimeout(silentRefreshTimerRef.current);
      silentRefreshTimerRef.current = null;
    }
    silentRefreshTimerRef.current = setTimeout(() => {
      silentRefreshTimerRef.current = null;
      if (inflightDecisionRef.current.size > 0) {
        scheduleSilentRefresh();
        return;
      }
      void fetchItemsSilent();
    }, 900);
  }, [fetchItemsSilent]);

  useEffect(() => {
    return () => {
      if (silentRefreshTimerRef.current) clearTimeout(silentRefreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!previewImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);

  const applyOptimisticDecision = useCallback(
    (item: ReviewItem, nextStatus: "accepted" | "rejected", decidedAt: string) => {
      // Update list first so the UI feels instant.
      setItems((prev) => {
        if (status === "all") {
          return prev.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: nextStatus,
                  decidedAt,
                  decisionError: null,
                }
              : entry,
          );
        }
        // In pending view, removing the row is the fastest UX.
        return prev.filter((entry) => entry.id !== item.id);
      });

      setSummary((prev) => ({
        pending: Math.max(0, prev.pending - 1),
        accepted: prev.accepted + (nextStatus === "accepted" ? 1 : 0),
        rejected: prev.rejected + (nextStatus === "rejected" ? 1 : 0),
      }));

      setCatalogCounters((prev) => ({
        ...prev,
        reviewedProducts: prev.reviewedProducts + 1,
        pendingProducts: Math.max(0, prev.pendingProducts - 1),
        remainingProducts: Math.max(0, prev.remainingProducts - 1),
        eligibleReviewedProducts: prev.eligibleReviewedProducts + 1,
        eligiblePendingProducts: Math.max(0, prev.eligiblePendingProducts - 1),
        eligibleRemainingProducts: Math.max(0, prev.eligibleRemainingProducts - 1),
      }));

      setPhase((prev) => {
        const pendingCount = Math.max(0, prev.pendingCount - 1);
        const remainingToTrigger = Math.max(0, pendingCount - prev.pendingThreshold);
        return {
          ...prev,
          pendingCount,
          remainingForPhase: pendingCount,
          remainingToTrigger,
          readyToTrigger: pendingCount <= prev.pendingThreshold,
          reviewedSinceLastAuto: prev.reviewedSinceLastAuto + 1,
        };
      });

      // These are derived from the current filter. For pending-only view, the item leaves the view.
      if (status === "pending") {
        const bucket = item.changeType === "taxonomy" ? "taxonomy" : item.changeType === "none" ? "none" : "gender_only";
        setChangeSummary((prev) => ({
          ...prev,
          [bucket]: Math.max(0, (prev as Record<string, number>)[bucket] - 1),
        }));
        setTotal((prevTotal) => {
          const nextTotal = Math.max(0, prevTotal - 1);
          const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_LIMIT));
          setTotalPages(nextTotalPages);
          setPage((prevPage) => Math.min(prevPage, nextTotalPages));
          return nextTotal;
        });
      }
    },
    [status],
  );

  const runAutoReseed = useCallback(async (force = false) => {
    setAutoReseedBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/taxonomy-remap/auto-reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, limit: 10000 }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo ejecutar auto-reseed");
      }
      const payload = (await res.json().catch(() => ({}))) as {
        result?: AutoReseedResult;
      };
      if (payload.result) {
        setAutoReseedFeedback({
          at: new Date().toISOString(),
          source: "manual",
          result: payload.result,
        });
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ejecutar auto-reseed");
    } finally {
      setAutoReseedBusy(false);
    }
  }, [fetchItems]);

  const handleAccept = useCallback(async (item: ReviewItem) => {
    if (inflightDecisionRef.current.has(item.id)) return;
    const decidedAt = new Date().toISOString();
    let acceptedOnServer = false;
    inflightDecisionRef.current.add(item.id);
    setDecisionBusyCount((prev) => prev + 1);
    optimisticDecisionsRef.current.set(item.id, { status: "accepted", decidedAt });
    setActionById((prev) => ({ ...prev, [item.id]: "accept" }));
    setError(null);
    applyOptimisticDecision(item, "accepted", decidedAt);
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
      const payload = (await res.json().catch(() => ({}))) as {
        autoReseed?: AutoReseedResult;
      };
      if (payload.autoReseed) {
        setAutoReseedFeedback({
          at: new Date().toISOString(),
          source: "decision",
          result: payload.autoReseed,
        });
      }
      acceptedOnServer = true;
      scheduleSilentRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aceptar la propuesta");
      optimisticDecisionsRef.current.delete(item.id);
      scheduleSilentRefresh();
    } finally {
      setActionById((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      inflightDecisionRef.current.delete(item.id);
      setDecisionBusyCount((prev) => Math.max(0, prev - 1));
      if (!acceptedOnServer) optimisticDecisionsRef.current.delete(item.id);
    }
  }, [applyOptimisticDecision, scheduleSilentRefresh]);

  const handleReject = useCallback(async (item: ReviewItem) => {
    if (inflightDecisionRef.current.has(item.id)) return;
    const decidedAt = new Date().toISOString();
    let rejectedOnServer = false;
    inflightDecisionRef.current.add(item.id);
    setDecisionBusyCount((prev) => prev + 1);
    optimisticDecisionsRef.current.set(item.id, { status: "rejected", decidedAt });
    setActionById((prev) => ({ ...prev, [item.id]: "reject" }));
    setError(null);
    applyOptimisticDecision(item, "rejected", decidedAt);
    try {
      const res = await fetch(`/api/admin/taxonomy-remap/reviews/${item.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo rechazar la propuesta");
      }
      const payload = (await res.json().catch(() => ({}))) as {
        autoReseed?: AutoReseedResult;
      };
      if (payload.autoReseed) {
        setAutoReseedFeedback({
          at: new Date().toISOString(),
          source: "decision",
          result: payload.autoReseed,
        });
      }
      rejectedOnServer = true;
      scheduleSilentRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo rechazar la propuesta");
      optimisticDecisionsRef.current.delete(item.id);
      scheduleSilentRefresh();
    } finally {
      setActionById((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      inflightDecisionRef.current.delete(item.id);
      setDecisionBusyCount((prev) => Math.max(0, prev - 1));
      if (!rejectedOnServer) optimisticDecisionsRef.current.delete(item.id);
    }
  }, [applyOptimisticDecision, scheduleSilentRefresh]);

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
          <span className="rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-700">
            Faltantes fase: {phase.remainingForPhase}
          </span>
          <span className="rounded-full bg-indigo-100 px-3 py-1 font-semibold text-indigo-700">
            Faltan para auto-reseed: {phase.remainingToTrigger}
          </span>
          <span className="rounded-full bg-cyan-100 px-3 py-1 font-semibold text-cyan-700">
            Catálogo total: {catalogCounters.totalProducts}
          </span>
          <span className="rounded-full bg-teal-100 px-3 py-1 font-semibold text-teal-700">
            Faltan por revisar catálogo: {catalogCounters.remainingProducts}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">
            Elegibles (enriquecidos): {catalogCounters.eligibleProducts}
          </span>
          <span className="rounded-full bg-lime-100 px-3 py-1 font-semibold text-lime-700">
            Faltan por revisar elegibles: {catalogCounters.eligibleRemainingProducts}
          </span>
          <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-700">
            Cat/Subcat: {changeSummary.taxonomy}
          </span>
          <span className="rounded-full bg-fuchsia-100 px-3 py-1 font-semibold text-fuchsia-700">
            Solo género: {changeSummary.gender_only}
          </span>
        </div>
      </div>
      {phase.running || autoReseedBusy || decisionBusyCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-300 bg-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          </span>
          <span className="font-semibold">
            {phase.running
              ? "Auto-reseed en ejecución"
              : "Procesando decisión y evaluando auto-reseed"}
          </span>
          {phase.runningSince ? (
            <span>desde {formatDateTime(phase.runningSince)}</span>
          ) : null}
          {phase.runningExecutionId ? (
            <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-amber-700">
              run {phase.runningExecutionId.slice(0, 8)}
            </span>
          ) : null}
          {decisionBusyCount > 0 ? (
            <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-amber-700">
              decisiones en curso: {decisionBusyCount}
            </span>
          ) : null}
        </div>
      ) : null}
      {autoReseedFeedback ? (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <p className="font-semibold">
            Última evaluación auto-reseed ({autoReseedFeedback.source === "manual" ? "manual" : "por decisión"}):{" "}
            {AUTO_RESEED_REASON_LABEL[autoReseedFeedback.result.reason]}
          </p>
          <p className="mt-1">
            {formatDateTime(autoReseedFeedback.at)} · scanned {autoReseedFeedback.result.scanned} · propuestas{" "}
            {autoReseedFeedback.result.proposed} · encoladas {autoReseedFeedback.result.enqueued} · muestras aprendizaje{" "}
            {autoReseedFeedback.result.learningAcceptedSamples}/{autoReseedFeedback.result.learningRejectedSamples}
          </p>
          {autoReseedFeedback.result.error ? (
            <p className="mt-1 text-rose-700">{autoReseedFeedback.result.error}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p>
            Auto-reseed: <span className="font-semibold">{phase.enabled ? "Activo" : "Inactivo"}</span> ·
            Umbral: <span className="font-semibold">≤ {phase.pendingThreshold}</span> pendientes ·
            Batch: <span className="font-semibold">{phase.autoLimit}</span>
          </p>
          <p>
            {phase.lastAutoReseedAt
              ? `Último auto-reseed: ${formatDateTime(phase.lastAutoReseedAt)} · creados ${phase.lastAutoReseedCreated} · pendientes de ese batch ${phase.lastAutoReseedPendingNow}`
              : "Sin ejecuciones automáticas registradas"}
          </p>
          <p>
            Última ejecución:{" "}
            <span className="font-semibold">
              {phase.lastRunStatus ? `${phase.lastRunStatus}${phase.lastRunReason ? ` (${phase.lastRunReason})` : ""}` : "sin datos"}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => runAutoReseed(false)}
            disabled={autoReseedBusy}
          >
            {autoReseedBusy ? "Ejecutando..." : "Intentar auto-reseed"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => runAutoReseed(true)}
            disabled={autoReseedBusy}
          >
            {autoReseedBusy ? "Forzando..." : "Forzar batch 10.000"}
          </button>
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
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Tipo cambio
          </label>
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={changeType}
            onChange={(event) => {
              setChangeType(event.target.value as ChangeTypeFilter);
              setPage(1);
            }}
          >
            {CHANGE_TYPE_OPTIONS.map((option) => (
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
        <div className="lg:col-span-3">
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
              setChangeType("all");
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
          <table className="min-w-[1380px] table-fixed divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="w-[32%] px-3 py-2 text-left">Producto</th>
                <th className="w-[34%] px-3 py-2 text-left">Cambio destacado</th>
                <th className="w-[24%] px-3 py-2 text-left">Señales</th>
                <th className="w-[10%] px-3 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white align-top">
              {items.map((item) => {
                const action = actionById[item.id];
                const busy = Boolean(action);
                const categoryChanged = hasChanged(item.fromCategory, item.toCategory);
                const subcategoryChanged = hasChanged(item.fromSubcategory, item.toSubcategory);
                const genderChanged = hasChanged(item.fromGender, item.toGender);
                const taxonomyChanged = categoryChanged || subcategoryChanged;
                const imageSrc =
                  proxiedImageUrl(item.imageCoverUrl, {
                    productId: item.productId,
                    kind: "cover",
                  }) ?? null;
                const imageCanPreview = Boolean(imageSrc) && !brokenImageById[item.id];
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-3">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className={`relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border ${
                            imageCanPreview
                              ? "border-slate-200 bg-slate-100 transition hover:scale-[1.02] hover:shadow-sm"
                              : "cursor-default border-slate-200 bg-slate-100"
                          }`}
                          onClick={() => {
                            if (!imageSrc || brokenImageById[item.id]) return;
                            setPreviewImage({ url: imageSrc, alt: item.productName });
                          }}
                          disabled={!imageCanPreview}
                          aria-label={imageCanPreview ? "Ampliar imagen del producto" : "Producto sin imagen"}
                        >
                          {imageSrc && !brokenImageById[item.id] ? (
                            <Image
                              src={imageSrc}
                              alt={item.productName}
                              fill
                              className="object-cover"
                              unoptimized={imageSrc.startsWith("/api/")}
                              onError={() =>
                                setBrokenImageById((prev) =>
                                  prev[item.id] ? prev : { ...prev, [item.id]: true },
                                )
                              }
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">
                              Sin imagen
                            </div>
                          )}
                          {imageCanPreview ? (
                            <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              ampliar
                            </span>
                          ) : null}
                        </button>
                        <div className="space-y-1">
                          <p className="line-clamp-2 font-semibold text-slate-900">{item.productName}</p>
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
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            taxonomyChanged
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {taxonomyChanged ? "Cat/Sub cambia" : "Cat/Sub sin cambio"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            genderChanged
                              ? "bg-fuchsia-100 text-fuchsia-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {genderChanged ? "Género cambia" : "Género sin cambio"}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <DiffField
                          label="Categoría"
                          from={item.fromCategory}
                          to={item.toCategory}
                          changed={categoryChanged}
                        />
                        <DiffField
                          label="Subcategoría"
                          from={item.fromSubcategory}
                          to={item.toSubcategory}
                          changed={subcategoryChanged}
                        />
                        <DiffField
                          label="Género"
                          from={item.fromGender}
                          to={item.toGender}
                          changed={genderChanged}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                            Conf {formatScore(item.confidence)}
                          </span>
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                            {item.changeType === "gender_only"
                              ? "Solo género"
                              : item.changeType === "taxonomy"
                                ? "Cat/Subcat"
                                : "Sin cambio"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-[11px]">
                          <div className="rounded-md bg-slate-100 px-2 py-1">
                            <p className="font-semibold text-slate-500">Sources</p>
                            <p>{formatNullable(String(item.sourceCount ?? ""))}</p>
                          </div>
                          <div className="rounded-md bg-slate-100 px-2 py-1">
                            <p className="font-semibold text-slate-500">Support</p>
                            <p>{formatScore(item.scoreSupport, 4)}</p>
                          </div>
                          <div className="rounded-md bg-slate-100 px-2 py-1">
                            <p className="font-semibold text-slate-500">Margin</p>
                            <p>{formatScore(item.marginRatio, 4)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 max-h-20 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                        {item.reasons.length ? item.reasons.join(" · ") : "Sin razones"}
                      </div>
                      {item.seoCategoryHints.length ? (
                        <p className="mt-2 text-[11px] text-amber-700">SEO hints: {item.seoCategoryHints.join(", ")}</p>
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

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Vista ampliada de imagen de producto"
        >
          <div
            className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <p className="line-clamp-1 pr-8 text-sm font-semibold text-slate-900">{previewImage.alt}</p>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => setPreviewImage(null)}
              >
                Cerrar
              </button>
            </div>
            <div className="relative h-[70vh] max-h-[760px] min-h-[360px] bg-slate-100">
              <Image
                src={previewImage.url}
                alt={previewImage.alt}
                fill
                className="object-contain"
                unoptimized={previewImage.url.startsWith("/api/")}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
