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
  staleOpenBrands?: number;
  staleCompletedBrands?: number;
  staleBreakdown: {
    processing: number;
    paused?: number;
    failed: number;
    completed_stale: number;
    unknown: number;
    no_status?: number;
    manual_review: number;
  };
  processingNoProgressCount?: number;
  processingNoProgressTop?: Array<{
    brandId: string;
    brandName: string;
    runId: string;
    runStatus: string;
    completed: number;
    total: number;
    completedRecent: number;
    pending: number;
    failed: number;
    progressPct: number;
    updatedAt: string;
  }>;
  processingNoProgressOverflow?: number;
  activeRunCount?: number;
  activeRunCap?: number;
  activeRunCapacityRemaining?: number;
  avgDiscoveryCoverage: number;
  avgRunSuccessRate: number;
  newProducts: number;
  priceChanges: number;
  stockChanges: number;
  stockStatusChanges: number;
  operationalCoverageExact?: boolean;
  operationalHealthOk?: boolean;
  operational100Real?: boolean;
  operationalCoveragePctRaw?: number;
  operationalCoveragePctDisplay?: number;
  realGapReasons?: string[];
  statusMismatchCount?: number;
  statusMismatchSample?: Array<{
    brandId: string;
    brandName: string;
    runStatus: string | null;
    refreshStatus: string | null;
  }>;
  archivedBrandsTotal?: number;
  archivedLast24h?: number;
  archiveCandidatesCount?: number;
  archiveByReason?: {
    "404_real"?: number;
    "no_products_validated"?: number;
  };
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
  catalogStatus?: string;
  statusDiagnostics?: {
    runStatus: string | null;
    refreshStatus: string | null;
    source: "run" | "refresh" | "derived";
  };
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
  archiveCandidate?: {
    reason: "404_real" | "no_products_validated";
    confidence: number;
    firstDetectedAt: string | null;
    lastValidatedAt: string | null;
    nextCheckAt: string | null;
    evidenceSummary?: Record<string, unknown> | null;
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

type ArchiveAlert = {
  id: string;
  type: string;
  level: "danger";
  title: string;
  detail?: string;
  brandId?: string;
  reason: "404_real" | "no_products_validated";
  archivedAt: string;
};

type ArchiveCandidate = {
  brandId: string;
  brandName: string;
  reason: "404_real" | "no_products_validated";
  confidence: number;
  evidence?: Record<string, unknown>;
  firstDetectedAt?: string | null;
  lastValidatedAt?: string | null;
  nextCheckAt?: string | null;
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
  archiveAlerts?: ArchiveAlert[];
  archiveCandidates?: ArchiveCandidate[];
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
      zombieCriticalCount?: number;
      zombieTransientCount?: number;
      zombieByReason?: Record<string, number>;
      zombieByDbState?: {
        completed?: number;
        completed_recent?: number;
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

const LITE_POLL_MS = 15000;
const DEEP_POLL_MS = 90000;
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

type RemediationResponse = {
  attempted: boolean;
  dryRun: boolean;
  strategy: "balanced" | "aggressive_tail_close";
  resumed: number;
  paused: number;
  requeued: number;
  reconciled: boolean;
  errors: number;
  runIds: string[];
  skipped?: boolean;
  skipReason?: "locked" | "cooldown" | "no_work" | null;
  nextEligibleAt?: string | null;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
};

const percentRounded = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";

const toCoverageDisplayPercent = (fresh: number, total: number) => {
  if (total <= 0) return 0;
  if (fresh >= total) return 100;
  const raw = (fresh / total) * 100;
  const truncated = Math.floor(raw * 10) / 10;
  return truncated >= 100 ? 99.9 : Number(truncated.toFixed(1));
};

const formatCoverageDisplayPercent = (value: number) =>
  value >= 100 ? "100%" : `${value.toFixed(1)}%`;

const realGapReasonLabel = (reason: string) => {
  if (reason === "missing_brands") return "Faltan marcas";
  if (reason === "heartbeat_missing") return "Heartbeat ausente";
  if (reason === "queue_drift") return "Drift de cola";
  if (reason === "active_hung") return "Jobs activos colgados";
  if (reason === "processing_no_progress") return "Runs sin progreso reciente";
  return reason.replace(/_/g, " ");
};

const catalogStatusLabel = (status: string | null | undefined) => {
  const normalized = (status ?? "unknown").toLowerCase();
  if (normalized === "processing") return "processing";
  if (normalized === "failed") return "failed";
  if (normalized === "completed") return "completed";
  if (normalized === "paused") return "paused";
  if (normalized === "blocked") return "blocked";
  if (normalized === "stopped") return "stopped";
  return normalized;
};

const catalogStatusBadgeClass = (status: string | null | undefined) => {
  const normalized = (status ?? "unknown").toLowerCase();
  if (normalized === "processing") return "bg-blue-100 text-blue-700";
  if (normalized === "failed") return "bg-rose-100 text-rose-700";
  if (normalized === "completed") return "bg-emerald-100 text-emerald-700";
  if (normalized === "paused" || normalized === "blocked" || normalized === "stopped") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-slate-100 text-slate-700";
};

const alertLabel = (type: string) => {
  if (type === "stale_brand") return "stale brand";
  if (type === "stale_auto_recovering") return "auto recovering";
  if (type === "stale_processing_no_progress") return "sin progreso";
  if (type === "stale_processing_no_progress_overflow") return "sin progreso (+)";
  if (type === "stale_no_refs") return "sin refs";
  if (type === "catalog_stuck") return "catalog stuck";
  if (type === "catalog_queue_drift") return "queue drift";
  if (type === "catalog_worker_heartbeat_missing") return "heartbeat";
  if (type === "catalog_processing_no_recent_progress") return "processing idle";
  if (type === "brand_archived_404_real") return "archivado 404";
  if (type === "brand_archived_no_products_validated") return "archivado no_products";
  return type.replace(/_/g, " ");
};

const archiveReasonLabel = (reason: "404_real" | "no_products_validated") =>
  reason === "404_real" ? "404 real" : "no products validado";

export default function CatalogRefreshPanel() {
  const [state, setState] = useState<RefreshState | null>(null);
  const [queueHealth, setQueueHealth] = useState<QueueHealthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [forcingBrands, setForcingBrands] = useState<Record<string, boolean>>({});
  const [archiveActionMode, setArchiveActionMode] = useState<"dry-run" | "apply" | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [remediationRunning, setRemediationRunning] = useState(false);
  const [remediationMessage, setRemediationMessage] = useState<string | null>(null);
  const [forceMessages, setForceMessages] = useState<
    Record<string, { level: "info" | "warning" | "danger"; message: string; at: number }>
  >({});
  const [runProgressFloor, setRunProgressFloor] = useState<Record<string, number>>({});
  const [quickPollUntil, setQuickPollUntil] = useState<Record<string, number>>({});
  const litePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertsRef = useRef<HTMLDivElement | null>(null);
  const mergeLiteState = useCallback((prev: RefreshState | null, lite: RefreshState) => {
    if (!prev) return lite;
    const brandById = new Map(prev.brands.map((brand) => [brand.id, brand]));
    const mergedBrands = lite.brands.map((brand) => {
      const previous = brandById.get(brand.id);
      if (!previous) return brand;
      return {
        ...previous,
        ...brand,
        refresh: { ...previous.refresh, ...brand.refresh },
      };
    });
    const missingById = new Map(
      (prev.operationalMissingBrands ?? []).map((brand) => [brand.id, brand]),
    );
    const mergedMissing = (lite.operationalMissingBrands ?? []).map((brand) => {
      const previous = missingById.get(brand.id);
      if (!previous) return brand;
      return {
        ...previous,
        ...brand,
        runProgress: brand.runProgress ?? previous.runProgress ?? null,
      };
    });
    return {
      ...prev,
      windowStart: lite.windowStart ?? prev.windowStart,
      summary: { ...prev.summary, ...lite.summary },
      brands: mergedBrands,
      archiveCandidates: lite.archiveCandidates ?? prev.archiveCandidates,
      operationalMissingBrands: mergedMissing,
      oldestOperationalRefresh:
        lite.oldestOperationalRefresh ?? prev.oldestOperationalRefresh,
    };
  }, []);

  const fetchLiteState = useCallback(async () => {
    try {
      const liteRes = await fetch("/api/admin/catalog-refresh/state-lite", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (liteRes.status === 401) {
        window.location.href = "/admin";
        return;
      }
      if (!liteRes.ok) throw new Error("No se pudo cargar el estado lite de refresh.");
      const payload = (await liteRes.json()) as RefreshState;
      setState((prev) => mergeLiteState(prev, payload));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }, [mergeLiteState]);

  const fetchDeepState = useCallback(
    async (options?: { forceLoading?: boolean }) => {
      const forceLoading = Boolean(options?.forceLoading);
      if (forceLoading) setLoading(true);
      try {
        const [stateRes, queueRes] = await Promise.all([
          fetch("/api/admin/catalog-refresh/state-deep", {
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
        if (!stateRes.ok) throw new Error("No se pudo cargar el estado profundo de refresh.");

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
        if (forceLoading) setLoading(false);
      }
    },
    [],
  );

  const refreshState = useCallback(async () => {
    await fetchDeepState({ forceLoading: true });
    await fetchLiteState();
  }, [fetchDeepState, fetchLiteState]);

  const triggerBatch = useCallback(
    async (force = false) => {
      try {
        const res = await fetch(`/api/admin/catalog-refresh/cron${force ? "?force=true" : ""}`);
        if (!res.ok) throw new Error("No se pudo iniciar el refresh.");
        await refreshState();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    },
    [refreshState],
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
        await refreshState();
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
    [refreshState],
  );

  const triggerReconcile = useCallback(async () => {
    const res = await fetch("/api/admin/catalog-extractor/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });
    if (!res.ok) throw new Error("No se pudo reconciliar la cola.");
    await refreshState();
  }, [refreshState]);

  const triggerMassRemediation = useCallback(async () => {
    setRemediationRunning(true);
    setRemediationMessage(null);
    try {
      const dryRunRes = await fetch("/api/admin/catalog-refresh/remediate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dryRun: true,
          strategy: "balanced",
        }),
      });
      if (!dryRunRes.ok) {
        throw new Error("No se pudo ejecutar el dry-run de remediación.");
      }
      const dryRunPayload = (await dryRunRes.json()) as RemediationResponse;
      if (dryRunPayload.skipped) {
        setRemediationMessage(
          `Dry-run omitido por ${dryRunPayload.skipReason ?? "unknown"}${
            dryRunPayload.nextEligibleAt ? ` · próximo intento ${formatDate(dryRunPayload.nextEligibleAt)}` : ""
          }.`,
        );
        await refreshState();
        return;
      }
      const dryRunSummary = `Dry-run: resumed=${dryRunPayload.resumed}, paused=${dryRunPayload.paused}, requeued=${dryRunPayload.requeued}, reconciled=${dryRunPayload.reconciled ? "si" : "no"}, errors=${dryRunPayload.errors}.`;
      setRemediationMessage(dryRunSummary);

      const hasWorkToApply =
        dryRunPayload.resumed > 0 ||
        dryRunPayload.paused > 0 ||
        dryRunPayload.requeued > 0 ||
        dryRunPayload.reconciled;
      if (hasWorkToApply) {
        const applyRes = await fetch("/api/admin/catalog-refresh/remediate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dryRun: false,
            strategy: "balanced",
          }),
        });
        if (!applyRes.ok) {
          throw new Error("No se pudo aplicar la remediación masiva.");
        }
        const applyPayload = (await applyRes.json()) as RemediationResponse;
        if (applyPayload.skipped) {
          setRemediationMessage(
            `Apply omitido por ${applyPayload.skipReason ?? "unknown"}${
              applyPayload.nextEligibleAt ? ` · próximo intento ${formatDate(applyPayload.nextEligibleAt)}` : ""
            }.`,
          );
          await refreshState();
          return;
        }
        setRemediationMessage(
          `Apply: resumed=${applyPayload.resumed}, paused=${applyPayload.paused}, requeued=${applyPayload.requeued}, reconciled=${applyPayload.reconciled ? "si" : "no"}, errors=${applyPayload.errors}.`,
        );
      }
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setRemediationRunning(false);
    }
  }, [refreshState]);

  const triggerArchiveCandidates = useCallback(
    async (apply: boolean) => {
      setArchiveActionMode(apply ? "apply" : "dry-run");
      try {
        const res = await fetch("/api/admin/catalog-refresh/archive-candidates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dryRun: !apply,
            scope: "all",
            reasons: ["404_real", "no_products_validated"],
            limit: 50,
          }),
        });
        if (!res.ok) throw new Error("No se pudo evaluar candidatos a archivo.");
        const payload = (await res.json()) as {
          evaluated: number;
          qualified: number;
          archived: number;
          skipped: number;
          dryRun: boolean;
        };
        setArchiveMessage(
          payload.dryRun
            ? `Dry-run: evaluadas ${payload.evaluated}, calificadas ${payload.qualified}, omitidas ${payload.skipped}.`
            : `Apply: evaluadas ${payload.evaluated}, archivadas ${payload.archived}, calificadas ${payload.qualified}.`,
        );
        await refreshState();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setArchiveActionMode(null);
      }
    },
    [refreshState],
  );

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
          await refreshState();
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
          await refreshState();
          return;
        }
        if (alert.action.type === "reconcile_catalog") {
          await triggerReconcile();
          return;
        }
        if (alert.action.type === "remediate_catalog_balanced") {
          await triggerMassRemediation();
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setActionId(null);
      }
    },
    [refreshState, triggerBrand, triggerMassRemediation, triggerReconcile],
  );

  useEffect(() => {
    void fetchDeepState({ forceLoading: true });
    void fetchLiteState();
  }, [fetchDeepState, fetchLiteState]);

  useEffect(() => {
    if (litePollRef.current) clearTimeout(litePollRef.current);
    const nowTs = Date.now();
    const activeQuickPollEntries = Object.entries(quickPollUntil).filter(([, expiresAt]) => expiresAt > nowTs);
    if (activeQuickPollEntries.length !== Object.keys(quickPollUntil).length) {
      const compact = Object.fromEntries(activeQuickPollEntries);
      setQuickPollUntil(compact);
    }
    const pollMs = activeQuickPollEntries.length ? QUICK_POLL_MS : LITE_POLL_MS;
    litePollRef.current = setTimeout(fetchLiteState, pollMs);
    return () => {
      if (litePollRef.current) clearTimeout(litePollRef.current);
    };
  }, [fetchLiteState, quickPollUntil]);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchDeepState();
    }, DEEP_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchDeepState]);

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
  const archiveAlerts = state?.archiveAlerts ?? [];
  const archiveCandidates = state?.archiveCandidates ?? [];

  const operationalCoverage = useMemo(() => {
    if (!summary) return { fresh: 0, total: 0, percent: 0, label: "0%" };
    const total = summary.autoEligibleBrands ?? summary.totalBrands;
    const fresh = summary.operationalFreshBrands ?? summary.freshBrands;
    const value =
      typeof summary.operationalCoveragePctDisplay === "number"
        ? summary.operationalCoveragePctDisplay
        : toCoverageDisplayPercent(fresh, total);
    return { fresh, total, percent: value, label: formatCoverageDisplayPercent(value) };
  }, [summary]);

  const qualityCoverage = useMemo(() => {
    if (!summary) return { fresh: 0, total: 0, percent: 0 };
    const total = summary.autoEligibleBrands ?? summary.totalBrands;
    const fresh = summary.qualityFreshBrands ?? summary.freshBrands;
    const value = total > 0 ? Math.round((fresh / total) * 100) : 0;
    return { fresh, total, percent: value };
  }, [summary]);
  const realGapReasons = summary?.realGapReasons ?? [];
  const statusMismatchSample = summary?.statusMismatchSample ?? [];

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
          <button
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800"
            onClick={() => triggerMassRemediation()}
            disabled={loading || remediationRunning}
          >
            {remediationRunning ? "Remediando..." : "Remediación masiva (balanceada)"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {remediationMessage ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {remediationMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Cobertura automatica (operativa)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {operationalCoverage.label}
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
          <p className="mt-2 text-xs text-slate-700">
            Stale vencidas: abiertas{" "}
            {summary?.staleOpenBrands ??
              (summary?.staleBreakdown?.processing ?? 0) +
                (summary?.staleBreakdown?.paused ?? 0) +
                (summary?.staleBreakdown?.failed ?? 0)}{" "}
            · completadas vencidas{" "}
            {summary?.staleCompletedBrands ??
              (summary?.staleBreakdown?.completed_stale ?? 0) +
                (summary?.staleBreakdown?.unknown ?? 0)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Stale: processing {summary?.staleBreakdown?.processing ?? 0} - paused{" "}
            {summary?.staleBreakdown?.paused ?? 0} - failed{" "}
            {summary?.staleBreakdown?.failed ?? 0} - completed stale{" "}
            {summary?.staleBreakdown?.completed_stale ?? 0} - unknown{" "}
            {summary?.staleBreakdown?.unknown ?? 0}
          </p>
          {typeof summary?.activeRunCount === "number" && typeof summary?.activeRunCap === "number" ? (
            <p className="mt-1 text-xs text-slate-500">
              Active runs: {summary.activeRunCount}/{summary.activeRunCap} · capacidad restante{" "}
              {typeof summary.activeRunCapacityRemaining === "number"
                ? summary.activeRunCapacityRemaining
                : Math.max(0, summary.activeRunCap - summary.activeRunCount)}
            </p>
          ) : null}
          {typeof summary?.processingNoProgressCount === "number" ? (
            <p className="mt-1 text-xs text-slate-500">
              Processing sin progreso: {summary.processingNoProgressCount} · top{" "}
              {summary.processingNoProgressTop?.length ?? 0} · overflow{" "}
              {summary.processingNoProgressOverflow ?? 0}
            </p>
          ) : null}
          {summary?.operationalCoverageExact && !summary?.operationalHealthOk ? (
            <p className="mt-1 text-xs text-amber-700">
              Cobertura completa, salud operativa no OK.
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Estado 100% real</p>
          <p
            className={`mt-2 text-2xl font-semibold ${
              summary?.operational100Real ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {summary?.operational100Real ? "Sí" : "No"}
          </p>
          <p className="text-sm text-slate-600">
            {summary?.operational100Real
              ? "Cobertura exacta y salud operativa OK."
              : summary?.operationalCoverageExact && !summary?.operationalHealthOk
                ? "Cobertura completa, salud operativa no OK."
                : "Cobertura/operación con brecha."}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Razones:{" "}
            {realGapReasons.length
              ? realGapReasons.map((reason) => realGapReasonLabel(reason)).join(" - ")
              : "ninguna"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Mismatch run/refresh: {summary?.statusMismatchCount ?? 0}
          </p>
          {statusMismatchSample.length ? (
            <p className="mt-1 truncate text-[11px] text-slate-500">
              Ejemplos:{" "}
              {statusMismatchSample
                .slice(0, 2)
                .map((item) => item.brandName)
                .join(" - ")}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Calidad de refresh</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {percentRounded(qualityCoverage.fresh, qualityCoverage.total)}
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
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs uppercase text-rose-700">Archivo automatico</p>
          <p className="mt-2 text-2xl font-semibold text-rose-800">
            {summary?.archivedBrandsTotal ?? 0}
          </p>
          <p className="text-sm text-rose-700">
            Archivadas total · {summary?.archivedLast24h ?? 0} en 24h
          </p>
          <p className="mt-1 text-xs text-rose-700">
            404 real: {summary?.archiveByReason?.["404_real"] ?? 0} · no_products:{" "}
            {summary?.archiveByReason?.["no_products_validated"] ?? 0}
          </p>
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
                  critical={queueHealth?.activeHang?.catalog?.zombieCriticalCount ?? 0} · transient=
                  {queueHealth?.activeHang?.catalog?.zombieTransientCount ?? 0}
                </p>
                <p>
                  completed={queueHealth?.activeHang?.catalog?.zombieByDbState?.completed ?? 0} ·
                  completed_recent={queueHealth?.activeHang?.catalog?.zombieByDbState?.completed_recent ?? 0} ·
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

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase text-rose-700">Marcas archivadas recientemente</p>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
              {archiveAlerts.length}
            </span>
          </div>
          {archiveAlerts.length ? (
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {archiveAlerts.map((alert) => (
                <div key={alert.id} className="rounded-xl border border-rose-200 bg-white px-3 py-2">
                  <p className="text-sm font-semibold text-rose-800">{alert.title}</p>
                  <p className="mt-1 text-xs text-rose-700">
                    {alert.detail ?? `Motivo ${archiveReasonLabel(alert.reason)}`}
                  </p>
                  <p className="mt-1 text-[11px] text-rose-600">
                    Archivada: {formatDate(alert.archivedAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-rose-700">Sin archivos en las últimas 24h.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase text-slate-500">Candidatas a archivo</p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                onClick={() => triggerArchiveCandidates(false)}
                disabled={archiveActionMode !== null}
              >
                {archiveActionMode === "dry-run" ? "Evaluando..." : "Dry-run"}
              </button>
              <button
                className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                onClick={() => triggerArchiveCandidates(true)}
                disabled={archiveActionMode !== null}
              >
                {archiveActionMode === "apply" ? "Aplicando..." : "Aplicar"}
              </button>
            </div>
          </div>
          {archiveMessage ? (
            <p className="mt-2 text-xs text-slate-600">{archiveMessage}</p>
          ) : null}
          {archiveCandidates.length ? (
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {archiveCandidates.map((candidate) => (
                <div
                  key={`${candidate.brandId}:${candidate.reason}`}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {candidate.brandName}
                    </p>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {archiveReasonLabel(candidate.reason)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Confianza {(candidate.confidence * 100).toFixed(0)}% · validado{" "}
                    {formatDate(candidate.lastValidatedAt ?? null)}
                  </p>
                  {candidate.nextCheckAt ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Próxima validación: {formatDate(candidate.nextCheckAt)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Sin candidatas registradas.</p>
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
              <th className="px-3">Status</th>
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
              const catalogStatus = brand.catalogStatus ?? "unknown";
              const runStatus = brand.statusDiagnostics?.runStatus ?? brand.runStatus ?? null;
              const refreshStatus =
                brand.statusDiagnostics?.refreshStatus ??
                (typeof refresh.lastStatus === "string" ? refresh.lastStatus : null);
              const statusSource = brand.statusDiagnostics?.source ?? "derived";
              const statusTooltip = `run=${runStatus ?? "-"}, refresh=${refreshStatus ?? "-"}, source=${statusSource}`;
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
                    {brand.archiveCandidate ? (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        candidata archivo
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{brand.ecommercePlatform ?? "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{brand.productCount}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {formatDate(refresh.lastFinishedAt ?? refresh.lastCompletedAt)}
                  </td>
                  <td
                    className="px-3 py-3 text-slate-600"
                    title={
                      refresh.lastError
                        ? `${statusTooltip} | error=${refresh.lastError}`
                        : statusTooltip
                    }
                  >
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${catalogStatusBadgeClass(
                        catalogStatus,
                      )}`}
                    >
                      {catalogStatusLabel(catalogStatus)}
                    </span>
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
