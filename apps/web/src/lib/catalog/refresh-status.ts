export type CatalogStatusSource = "run" | "refresh" | "derived";

export type CatalogStatusDiagnostics = {
  runStatus: string | null;
  refreshStatus: string | null;
  source: CatalogStatusSource;
};

const ACTIVE_RUN_STATUSES = new Set(["processing", "paused", "blocked", "stopped"]);

const normalizeStatus = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export const deriveCatalogStatus = (
  runStatusRaw: unknown,
  refreshStatusRaw: unknown,
): {
  catalogStatus: string;
  diagnostics: CatalogStatusDiagnostics;
} => {
  const runStatus = normalizeStatus(runStatusRaw);
  const refreshStatus = normalizeStatus(refreshStatusRaw);

  if (runStatus && ACTIVE_RUN_STATUSES.has(runStatus)) {
    return {
      catalogStatus: runStatus,
      diagnostics: { runStatus, refreshStatus, source: "run" },
    };
  }
  if (refreshStatus === "failed") {
    return {
      catalogStatus: "failed",
      diagnostics: { runStatus, refreshStatus, source: "refresh" },
    };
  }
  if (runStatus === "failed") {
    return {
      catalogStatus: "failed",
      diagnostics: { runStatus, refreshStatus, source: "run" },
    };
  }
  if (refreshStatus === "completed") {
    return {
      catalogStatus: "completed",
      diagnostics: { runStatus, refreshStatus, source: "refresh" },
    };
  }
  if (runStatus === "completed") {
    return {
      catalogStatus: "completed",
      diagnostics: { runStatus, refreshStatus, source: "run" },
    };
  }
  if (refreshStatus) {
    return {
      catalogStatus: refreshStatus,
      diagnostics: { runStatus, refreshStatus, source: "refresh" },
    };
  }
  return {
    catalogStatus: "unknown",
    diagnostics: { runStatus, refreshStatus, source: "derived" },
  };
};

export const hasStatusMismatch = (runStatusRaw: unknown, refreshStatusRaw: unknown) => {
  const runStatus = normalizeStatus(runStatusRaw);
  const refreshStatus = normalizeStatus(refreshStatusRaw);
  if (!runStatus || !refreshStatus) return false;
  return runStatus !== refreshStatus;
};

export const toOperationalCoveragePctRaw = (freshBrands: number, autoEligibleBrands: number) => {
  if (autoEligibleBrands <= 0) return 0;
  return (freshBrands / autoEligibleBrands) * 100;
};

export const toOperationalCoveragePctDisplay = (
  freshBrands: number,
  autoEligibleBrands: number,
) => {
  if (autoEligibleBrands <= 0) return 0;
  if (freshBrands >= autoEligibleBrands) return 100;

  const raw = toOperationalCoveragePctRaw(freshBrands, autoEligibleBrands);
  const truncated = Math.floor(raw * 10) / 10;
  if (truncated >= 100) return 99.9;
  return Number(truncated.toFixed(1));
};

export type Operational100RealInput = {
  freshBrands: number;
  autoEligibleBrands: number;
  heartbeatMissing: boolean;
  queueDriftDetected: boolean;
  activeHungDetected: boolean;
  processingRunsWithoutRecentProgress: number;
};

export type Operational100RealSummary = {
  operationalCoverageExact: boolean;
  operationalHealthOk: boolean;
  operational100Real: boolean;
  operationalCoveragePctRaw: number;
  operationalCoveragePctDisplay: number;
  realGapReasons: string[];
};

export const computeOperational100Real = (
  input: Operational100RealInput,
): Operational100RealSummary => {
  const operationalCoverageExact = input.freshBrands === input.autoEligibleBrands;
  const operationalHealthOk =
    !input.heartbeatMissing &&
    !input.queueDriftDetected &&
    !input.activeHungDetected &&
    input.processingRunsWithoutRecentProgress === 0;
  const operational100Real = operationalCoverageExact && operationalHealthOk;

  const realGapReasons: string[] = [];
  if (!operationalCoverageExact) realGapReasons.push("missing_brands");
  if (input.heartbeatMissing) realGapReasons.push("heartbeat_missing");
  if (input.queueDriftDetected) realGapReasons.push("queue_drift");
  if (input.activeHungDetected) realGapReasons.push("active_hung");
  if (input.processingRunsWithoutRecentProgress > 0) {
    realGapReasons.push("processing_no_progress");
  }

  return {
    operationalCoverageExact,
    operationalHealthOk,
    operational100Real,
    operationalCoveragePctRaw: toOperationalCoveragePctRaw(
      input.freshBrands,
      input.autoEligibleBrands,
    ),
    operationalCoveragePctDisplay: toOperationalCoveragePctDisplay(
      input.freshBrands,
      input.autoEligibleBrands,
    ),
    realGapReasons,
  };
};
