"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RefreshSummary = {
  totalBrands: number;
  autoEligibleBrands: number;
  freshBrands: number;
  staleBrands: number;
  operationalFreshBrands: number;
  qualityFreshBrands: number;
  operationalStaleBrands: number;
  qualityStaleBrands: number;
  staleBreakdown: {
    processing: number;
    failed: number;
    no_status: number;
    manual_review: number;
  };
  avgDiscoveryCoverage: number;
  avgRunSuccessRate: number;
  newProducts: number;
  priceChanges: number;
  stockChanges: number;
  stockStatusChanges: number;
};

type RefreshMeta = {
  lastCompletedAt?: string | null;
  lastFinishedAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  lastRunSuccessRate?: number | null;
  lastRunCompletedItems?: number | null;
  lastRunTotalItems?: number | null;
  lastRunFailedItems?: number | null;
  lastNewProducts?: number | null;
  lastCombinedCoverage?: number | null;
  lastPriceChanges?: number | null;
  lastStockChanges?: number | null;
  lastStockStatusChanges?: number | null;
  lastForceAttemptAt?: string | null;
  lastForceResult?: {
    at?: string | null;
    mode?: string | null;
    runId?: string | null;
    reason?: string | null;
    status?: string | null;
  } | null;
};

type RefreshBrand = {
  id: string;
  name: string;
  siteUrl: string | null;
  ecommercePlatform: string | null;
  manualReview: boolean;
  productCount: number;
  refresh: RefreshMeta;
  runStatus?: string | null;
  runUpdatedAt?: string | null;
  due: boolean;
  schedulerDue?: boolean;
  operationalOverdue?: boolean;
  lastOperationalAt?: string | null;
  lastForceAttemptAt?: string | null;
  lastForceResult?: {
    at?: string | null;
    mode?: string | null;
    runId?: string | null;
    reason?: string | null;
    status?: string | null;
  } | null;
};

type RefreshAlert = {
  id: string;
  type: string;
  level: "info" | "warning" | "danger";
  title: string;
  detail?: string;
  brandId?: string;
  action?: { type: string; label: string; brandId?: string };
};

type OperationalMissingBrand = {
  id: string;
  name: string;
  lastOperationalAt: string | null;
  lastStatus: string | null;
  daysStale: number | null;
  runProgress?: {
    runId: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    pending: number;
    progressPct: number;
    updatedAt: string;
  } | null;
  lastForceResult?: {
    at?: string | null;
    mode?: string | null;
    runId?: string | null;
    reason?: string | null;
    status?: string | null;
  } | null;
  lastForceAttemptAt?: string | null;
};

type OldestOperationalRefresh = {
  brandId: string;
  brandName: string;
  lastOperationalAt: string | null;
  neverRefreshed: boolean;
};

type RefreshState = {
  summary: RefreshSummary;
  brands: RefreshBrand[];
  windowStart: string;
  alerts: RefreshAlert[];
  criticalOperationalAlerts?: RefreshAlert[];
  operationalMissingBrands?: OperationalMissingBrand[];
  oldestOperationalRefresh?: OldestOperationalRefresh | null;
};

type WorkerStatus = {
  online: boolean;
  ttlSeconds: number | null;
  backlog: number;
  active: number;
  staleNoProgress?: boolean;
  queueEmptyButDbRunnable?: boolean;
};

type QueueHealthState = {
  redisEnabled: boolean;
  flags?: {
    heartbeatMissing?: boolean;
    activeHung?: boolean;
    queueDriftDetected?: boolean;
    aggressiveRecoveryRequired?: boolean;
  };
  activeHang?: {
    catalog?: {
      hungCount?: number;
      hungThresholdMinutes?: number;
      zombieCount?: number;
      zombieByReason?: Record<string, number>;
      zombieByDbState?: {
        completed?: number;
        failed_terminal?: number;
        run_not_processing?: number;
        item_not_in_progress?: number;
        missing_item?: number;
      };
      driftHungCount?: number;
      aggressiveRecoveryRequired?: boolean;
      aggressiveRecoveryReason?: string | null;
    };
    enrich?: {
      hungCount?: number;
      hungThresholdMinutes?: number;
    };
  };
  drift?: {
    waitingItemNotQueued?: number;
    waitingRunNotProcessing?: number;
    runsRunnableWithoutQueueLoad?: number;
  };
  workerStatus?: {
    catalog?: WorkerStatus;
    enrich?: WorkerStatus;
  };
  queues?: {
    catalog?: {
      waiting?: number;
      active?: number;
      delayed?: number;
    };
    enrichment?: {
      waiting?: number;
      active?: number;
      delayed?: number;
    };
  };
};

const POLL_MS = 15000;
const QUICK_POLL_MS = 5000;
const QUICK_POLL_WINDOW_MS = 2 * 60 * 1000;

type ForceResponse = {
  ok: boolean;
  accepted: boolean;
  brandId: string;
  runId: string | null;
  mode:
    | "resumed_existing_run"
    | "created_from_last_run_refs"
    | "created_from_product_refs"
    | "created_from_discovery_fallback"
    | "already_active_run"
    | "no_refs";
  message?: string;
  reason?: string | null;
  pollUrl?: string;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
};

const percent = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";

const alertLabel = (type: string) => {
  if (type === "stale_brand") return "stale brand";
  if (type === "stale_auto_recovering") return "auto recovering";
  if (type === "stale_processing_no_progress") return "sin progreso";
  if (type === "stale_no_refs") return "sin refs";
  if (type === "catalog_stuck") return "catalog stuck";
  if (type === "catalog_queue_drift") return "queue drift";
  if (type === "catalog_worker_heartbeat_missing") return "heartbeat";
  if (type === "catalog_processing_no_recent_progress") return "processing idle";
  return type.replace(/_/g, " ");
};

export default function CatalogRefreshPanel() {
  const [state, setState] = useState<RefreshState | null>(null);
  const [queueHealth, setQueueHealth] = useState<QueueHealthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [forcingBrands, setForcingBrands] = useState<Record<string, boolean>>({});
  const [forceMessages, setForceMessages] = useState<
    Record<string, { level: "info" | "warning" | "danger"; message: string; at: number }>
  >({});
  const [runProgressFloor, setRunProgressFloor] = useState<Record<string, number>>({});
  const [quickPollUntil, setQuickPollUntil] = useState<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertsRef = useRef<HTMLDivElement | null>(null);

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const [stateRes, queueRes] = await Promise.all([
        fetch("/api/admin/catalog-refresh/state", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch("/api/admin/queue-health", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);

      if (stateRes.status === 401 || queueRes.status === 401) {
        window.location.href = "/admin";
        return;
      }
      if (!stateRes.ok) throw new Error("No se pudo cargar el estado de refresh.");

      const payload = (await stateRes.json()) as RefreshState;
      setState(payload);

      if (queueRes.ok) {
        const queuePayload = (await queueRes.json()) as QueueHealthState;
        setQueueHealth(queuePayload);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerBatch = useCallback(
    async (force = false) => {
      try {
        const res = await fetch(`/api/admin/catalog-refresh/cron${force ? "?force=true" : ""}`);
        if (!res.ok) throw new Error("No se pudo iniciar el refresh.");
        await fetchState();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    },
    [fetchState],
  );

  const triggerBrand = useCallback(
    async (brandId: string) => {
      setForcingBrands((prev) => ({ ...prev, [brandId]: true }));
      try {
        const res = await fetch("/api/admin/catalog-refresh/force", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brandId, force: true }),
        });
        if (!res.ok) throw new Error("No se pudo iniciar el refresh de la marca.");
        const payload = (await res.json()) as ForceResponse;
        if (payload.mode === "no_refs") {
          setForceMessages((prev) => ({
            ...prev,
            [brandId]: {
              level: "warning",
              message: payload.message ?? "Sin refs para iniciar el refresh.",
              at: Date.now(),
            },
          }));
        } else {
          setForceMessages((prev) => ({
            ...prev,
            [brandId]: {
              level: "info",
              message: payload.message ?? "Refresh forzado en ejecución.",
              at: Date.now(),
            },
          }));
          setQuickPollUntil((prev) => ({
            ...prev,
            [brandId]: Date.now() + QUICK_POLL_WINDOW_MS,
          }));
        }
        await fetchState();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setForcingBrands((prev) => {
          const next = { ...prev };
          delete next[brandId];
          return next;
        });
      }
    },
    [fetchState],
  );

  const triggerReconcile = useCallback(async () => {
    const res = await fetch("/api/admin/catalog-extractor/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });
    if (!res.ok) throw new Error("No se pudo reconciliar la cola.");
    await fetchState();
  }, [fetchState]);

  const handleAlertAction = useCallback(
    async (alert: RefreshAlert) => {
      if (!alert.action?.type) return;
      setActionId(alert.id);
      try {
        if (alert.action.type === "force_refresh" && alert.action.brandId) {
          await triggerBrand(alert.action.brandId);
          return;
        }
        if (alert.action.type === "resume_catalog" && alert.action.brandId) {
          const res = await fetch("/api/admin/catalog-extractor/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              brandId: alert.action.brandId,
              resume: true,
              drainOnRun: true,
            }),
          });
          if (!res.ok) throw new Error("No se pudo reanudar el catalogo.");
          await fetchState();
          return;
        }
        if (alert.action.type === "resume_catalog_strong" && alert.action.brandId) {
          const res = await fetch("/api/admin/catalog-extractor/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              brandId: alert.action.brandId,
              resume: true,
              strongResume: true,
              force: true,
              drainOnRun: true,
            }),
          });
          if (!res.ok) throw new Error("No se pudo ejecutar el resume fuerte.");
          await fetchState();
          return;
        }
        if (alert.action.type === "reconcile_catalog") {
          await triggerReconcile();
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setActionId(null);
      }
    },
    [fetchState, triggerBrand, triggerReconcile],
  );

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    const nowTs = Date.now();
    const activeQuickPollEntries = Object.entries(quickPollUntil).filter(([, expiresAt]) => expiresAt > nowTs);
    if (activeQuickPollEntries.length !== Object.keys(quickPollUntil).length) {
      const compact = Object.fromEntries(activeQuickPollEntries);
      setQuickPollUntil(compact);
    }
    const pollMs = activeQuickPollEntries.length ? QUICK_POLL_MS : POLL_MS;
    pollRef.current = setTimeout(fetchState, pollMs);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchState, state, queueHealth, quickPollUntil]);

  useEffect(() => {
    if (!alertsOpen) return;

    const onClickAway = (event: MouseEvent) => {
      const target = event.target as Node;
      if (alertsRef.current && !alertsRef.current.contains(target)) {
        setAlertsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAlertsOpen(false);
    };

    window.addEventListener("mousedown", onClickAway);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onClickAway);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [alertsOpen]);

  useEffect(() => {
    const missing = state?.operationalMissingBrands ?? [];
    if (!missing.length) return;
    setRunProgressFloor((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const brand of missing) {
        const progress = brand.runProgress;
        if (!progress?.runId) continue;
        const current = Math.max(0, Math.min(100, progress.progressPct));
        const floor = next[progress.runId] ?? 0;
        if (current > floor) {
          next[progress.runId] = current;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [state?.operationalMissingBrands]);

  const summary = state?.summary;
  const brands = state?.brands ?? [];
  const windowStart = state?.windowStart;
  const alertFeed = useMemo(() => {
    const map = new Map<string, RefreshAlert>();
    const criticalAlerts = state?.criticalOperationalAlerts ?? [];
    const regularAlerts = state?.alerts ?? [];
    [...criticalAlerts, ...regularAlerts].forEach((alert) => {
      if (!map.has(alert.id)) map.set(alert.id, alert);
    });
    return Array.from(map.values());
  }, [state?.alerts, state?.criticalOperationalAlerts]);
  const operationalMissingBrands = state?.operationalMissingBrands ?? [];
  const oldestOperationalRefresh = state?.oldestOperationalRefresh ?? null;

  const operationalCoverage = useMemo(() => {
    if (!summary) return { fresh: 0, total: 0, percent: 0 };
    const total = summary.autoEligibleBrands ?? summary.totalBrands;
    const fresh = summary.operationalFreshBrands ?? summary.freshBrands;
    const value = total > 0 ? Math.round((fresh / total) * 100) : 0;
    return { fresh, total, percent: value };
  }, [summary]);

  const qualityCoverage = useMemo(() => {
    if (!summary) return { fresh: 0, total: 0, percent: 0 };
    const total = summary.autoEligibleBrands ?? summary.totalBrands;
    const fresh = summary.qualityFreshBrands ?? summary.freshBrands;
    const value = total > 0 ? Math.round((fresh / total) * 100) : 0;
    return { fresh, total, percent: value };
  }, [summary]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Refresh semanal de catalogo</h2>
          <p className="text-sm text-slate-600">
            Ventana analizada desde {windowStart ? formatDate(windowStart) : "-"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" ref={alertsRef}>
            <button
              type="button"
              className="relative inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={() => setAlertsOpen((open) => !open)}
              aria-expanded={alertsOpen}
              aria-haspopup="menu"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
                <path d="M6 9a6 6 0 1 1 12 0v4.4l1.6 2.4H4.4L6 13.4V9Z" />
                <path d="M10 18a2 2 0 0 0 4 0" />
              </svg>
              <span>Alertas</span>
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                {alertFeed.length}
              </span>
            </button>
            {alertsOpen ? (
              <div className="absolute right-0 z-30 mt-2 w-[min(94vw,28rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Alertas de refresh</h3>
                  <span className="text-xs text-slate-500">{alertFeed.length} activas</span>
                </div>
                {alertFeed.length ? (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {alertFeed.map((alert) => {
                      const badge =
                        alert.level === "danger"
                          ? "bg-rose-100 text-rose-700"
                          : alert.level === "warning"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-700";
                      return (
                        <div
                          key={alert.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${badge}`}>
                              {alertLabel(alert.type)}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                          </div>
                          {alert.detail ? (
                            <p className="mt-1 text-xs text-slate-600">{alert.detail}</p>
                          ) : null}
                          {alert.action ? (
                            <button
                              className="mt-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                              onClick={() => handleAlertAction(alert)}
                              disabled={actionId === alert.id}
                            >
                              {actionId === alert.id ? "Ejecutando..." : alert.action.label}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Sin alertas de refresh.</p>
                )}
              </div>
            ) : null}
          </div>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={() => triggerBatch(false)}
            disabled={loading}
          >
            Ejecutar batch
          </button>
          <button
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => triggerBatch(true)}
            disabled={loading}
          >
            Forzar refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Cobertura automatica (operativa)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {percent(operationalCoverage.fresh, operationalCoverage.total)}
          </p>
          <p className="text-sm text-slate-600">
            {operationalCoverage.fresh} de {operationalCoverage.total} auto-elegibles
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-slate-900 transition-all"
              style={{ width: `${operationalCoverage.percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Stale: processing {summary?.staleBreakdown?.processing ?? 0} - failed{" "}
            {summary?.staleBreakdown?.failed ?? 0} - sin estado{" "}
            {summary?.staleBreakdown?.no_status ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Calidad de refresh</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {percent(qualityCoverage.fresh, qualityCoverage.total)}
          </p>
          <p className="text-sm text-slate-600">
            {qualityCoverage.fresh} de {qualityCoverage.total} con run exitoso
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-emerald-100">
            <div
              className="h-2 rounded-full bg-emerald-600 transition-all"
              style={{ width: `${qualityCoverage.percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Manual review fuera de cobertura automatica: {summary?.staleBreakdown?.manual_review ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Nuevos productos</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary?.newProducts ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Cambios de precio</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary?.priceChanges ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Exito promedio</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {summary ? `${Math.round(summary.avgRunSuccessRate * 100)}%` : "0%"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Items completados / items totales (ventana)</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Cobertura discovery</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {summary ? `${Math.round(summary.avgDiscoveryCoverage * 100)}%` : "0%"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Refs (sitemap+adapter) existentes en DB</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Cambios de stock</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary?.stockChanges ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Estado stock</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary?.stockStatusChanges ?? 0}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">
            Faltan {operationalMissingBrands.length} para 100% operativo
          </p>
          {operationalMissingBrands.length ? (
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {operationalMissingBrands.map((brand) => {
                const progress = brand.runProgress;
                const progressPct = progress?.runId
                  ? runProgressFloor[progress.runId] ??
                    Math.max(0, Math.min(100, progress.progressPct))
                  : 0;
                return (
                  <div
                    key={brand.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{brand.name}</p>
                        <p className="text-xs text-slate-600">
                          Ultimo: {formatDate(brand.lastOperationalAt)} - status {brand.lastStatus ?? "-"}
                        </p>
                      </div>
                      <button
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                        onClick={() => triggerBrand(brand.id)}
                        disabled={Boolean(forcingBrands[brand.id])}
                      >
                        {forcingBrands[brand.id] ? "Forzando..." : "Forzar"}
                      </button>
                    </div>
                    <div className="mt-2">
                      {brand.runProgress ? (
                        <>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-1.5 rounded-full bg-slate-900 transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {brand.runProgress.status === "completed"
                              ? "Completado"
                              : `Procesando ${progressPct}%`}{" "}
                            · {brand.runProgress.completed}/{brand.runProgress.total} · fallos{" "}
                            {brand.runProgress.failed}
                          </p>
                        </>
                      ) : forcingBrands[brand.id] ? (
                        <>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div className="h-1.5 w-1/3 animate-pulse rounded-full bg-slate-500" />
                          </div>
                          <p className="mt-1 text-[11px] text-slate-600">Iniciando...</p>
                        </>
                      ) : null}
                      {forceMessages[brand.id] ? (
                        <p
                          className={`mt-1 text-[11px] ${
                            forceMessages[brand.id]?.level === "warning"
                              ? "text-amber-700"
                              : forceMessages[brand.id]?.level === "danger"
                                ? "text-rose-700"
                                : "text-slate-600"
                          }`}
                        >
                          {forceMessages[brand.id]?.message}
                        </p>
                      ) : null}
                      {!forceMessages[brand.id] && brand.lastForceResult?.mode === "no_refs" ? (
                        <p className="mt-1 text-[11px] text-amber-700">
                          Sin refs para auto-recovery (último intento {formatDate(brand.lastForceAttemptAt)}).
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Cobertura operativa en 100%.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Refresh mas antiguo</p>
          {oldestOperationalRefresh ? (
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">{oldestOperationalRefresh.brandName}</p>
              <p>
                Ultimo refresh operativo: {formatDate(oldestOperationalRefresh.lastOperationalAt)}
              </p>
              <p>
                {oldestOperationalRefresh.neverRefreshed
                  ? "Nunca refrescada"
                  : "Con historial operativo"}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Sin datos de antiguedad.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Estado de jobs</p>
          {queueHealth?.redisEnabled === false ? (
            <p className="mt-2 text-xs text-slate-500">Redis no habilitado.</p>
          ) : (
            <div className="mt-3 space-y-2 text-xs text-slate-700">
              {queueHealth?.flags ? (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="font-semibold text-slate-900">Guardrails</p>
                  <p>
                    heartbeatMissing: {queueHealth.flags.heartbeatMissing ? "si" : "no"} · activeHung:{" "}
                    {queueHealth.flags.activeHung ? "si" : "no"} · drift:{" "}
                    {queueHealth.flags.queueDriftDetected ? "si" : "no"} · aggressiveRecovery:{" "}
                    {queueHealth.flags.aggressiveRecoveryRequired ? "si" : "no"}
                  </p>
                  {queueHealth.flags.queueDriftDetected ? (
                    <button
                      className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => triggerReconcile().catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"))}
                      disabled={loading}
                    >
                      Reconciliar cola
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">Catalog</p>
                <p>
                  Online: {queueHealth?.workerStatus?.catalog?.online ? "si" : "no"} - backlog{" "}
                  {queueHealth?.workerStatus?.catalog?.backlog ?? 0} - active{" "}
                  {queueHealth?.workerStatus?.catalog?.active ?? 0}
                </p>
                <p>
                  hung: {queueHealth?.activeHang?.catalog?.hungCount ?? 0} /{" "}
                  {queueHealth?.activeHang?.catalog?.hungThresholdMinutes ?? 15}m
                </p>
                <p>
                  zombies: {queueHealth?.activeHang?.catalog?.zombieCount ?? 0} · drift_hung:{" "}
                  {queueHealth?.activeHang?.catalog?.driftHungCount ?? 0}
                </p>
                <p>
                  completed={queueHealth?.activeHang?.catalog?.zombieByDbState?.completed ?? 0} ·
                  failed_terminal={queueHealth?.activeHang?.catalog?.zombieByDbState?.failed_terminal ?? 0} ·
                  run_not_processing={queueHealth?.activeHang?.catalog?.zombieByDbState?.run_not_processing ?? 0}
                </p>
                {queueHealth?.activeHang?.catalog?.aggressiveRecoveryRequired ? (
                  <p className="text-rose-700">
                    Recovery agresivo recomendado:{" "}
                    {queueHealth?.activeHang?.catalog?.aggressiveRecoveryReason ?? "active_zombies_or_hung"}
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">Enrichment</p>
                <p>
                  Online: {queueHealth?.workerStatus?.enrich?.online ? "si" : "no"} - backlog{" "}
                  {queueHealth?.workerStatus?.enrich?.backlog ?? 0} - active{" "}
                  {queueHealth?.workerStatus?.enrich?.active ?? 0}
                </p>
                <p>
                  hung: {queueHealth?.activeHang?.enrich?.hungCount ?? 0} /{" "}
                  {queueHealth?.activeHang?.enrich?.hungThresholdMinutes ?? 15}m
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="px-3">Marca</th>
              <th className="px-3">Plataforma</th>
              <th className="px-3">Productos</th>
              <th className="px-3">Ultimo refresh</th>
              <th className="px-3">Status run/refresh</th>
              <th className="px-3">Exito</th>
              <th className="px-3">Fallos</th>
              <th className="px-3">Nuevos</th>
              <th
                className="px-3"
                title="Cobertura de discovery (sitemap+adapter): % de refs que ya existen como productos en la DB al iniciar el refresh."
              >
                Cobertura discovery
              </th>
              <th className="px-3">Precio</th>
              <th className="px-3">Stock</th>
              <th className="px-3">Estado stock</th>
              <th className="px-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => {
              const refresh = brand.refresh ?? {};
              return (
                <tr key={brand.id} className="rounded-xl bg-white shadow-sm">
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {brand.name}
                    {brand.manualReview ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        manual
                      </span>
                    ) : null}
                    {brand.operationalOverdue ? (
                      <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        overdue
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{brand.ecommercePlatform ?? "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{brand.productCount}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {formatDate(refresh.lastFinishedAt ?? refresh.lastCompletedAt)}
                  </td>
                  <td className="px-3 py-3 text-slate-600" title={refresh.lastError ?? ""}>
                    {brand.runStatus ?? "-"} / {refresh.lastStatus ?? "-"}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {typeof refresh.lastRunSuccessRate === "number"
                      ? `${Math.round(refresh.lastRunSuccessRate * 100)}%`
                      : typeof refresh.lastRunCompletedItems === "number" &&
                          typeof refresh.lastRunTotalItems === "number" &&
                          refresh.lastRunTotalItems > 0
                        ? `${Math.round((refresh.lastRunCompletedItems / refresh.lastRunTotalItems) * 100)}%`
                        : "-"}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {typeof refresh.lastRunFailedItems === "number" ? refresh.lastRunFailedItems : "-"}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{refresh.lastNewProducts ?? 0}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {typeof refresh.lastCombinedCoverage === "number"
                      ? `${Math.round(refresh.lastCombinedCoverage * 100)}%`
                      : "-"}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{refresh.lastPriceChanges ?? 0}</td>
                  <td className="px-3 py-3 text-slate-600">{refresh.lastStockChanges ?? 0}</td>
                  <td className="px-3 py-3 text-slate-600">{refresh.lastStockStatusChanges ?? 0}</td>
                  <td className="px-3 py-3">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => triggerBrand(brand.id)}
                      disabled={loading}
                    >
                      Forzar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
