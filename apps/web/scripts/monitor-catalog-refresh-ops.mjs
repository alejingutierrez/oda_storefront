import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const args = process.argv.slice(2);
const readArgValue = (name) => {
  const token = `--${name}=`;
  const entry = args.find((arg) => arg.startsWith(token));
  return entry ? entry.slice(token.length) : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);
const readNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const baseUrl = (
  readArgValue("base-url") ||
  process.env.CATALOG_REFRESH_MONITOR_BASE_URL ||
  process.env.CATALOG_WORKER_API_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const adminToken = readArgValue("admin-token") || process.env.ADMIN_TOKEN || "";
if (!adminToken) {
  throw new Error("Missing ADMIN_TOKEN (env o --admin-token).");
}

const intervalMinutes = Math.max(
  5,
  Math.floor(
    readNumber(
      readArgValue("interval-minutes") ?? process.env.CATALOG_REFRESH_MONITOR_INTERVAL_MINUTES,
      10,
    ),
  ),
);
const iterations = Math.floor(
  readNumber(readArgValue("iterations") ?? process.env.CATALOG_REFRESH_MONITOR_ITERATIONS, 0),
);
const cronEveryMinutes = Math.max(
  30,
  Math.floor(
    readNumber(
      readArgValue("cron-every-minutes") ?? process.env.CATALOG_REFRESH_MONITOR_CRON_EVERY_MINUTES,
      30,
    ),
  ),
);
const stuckThreshold = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("stuck-threshold") ?? process.env.CATALOG_REFRESH_STUCK_REMEDIATE_THRESHOLD,
      20,
    ),
  ),
);
const reconcileJobScanLimit = Math.max(
  100,
  Math.floor(
    readNumber(
      readArgValue("reconcile-job-scan-limit") ??
        process.env.CATALOG_REFRESH_AUTO_RECONCILE_JOB_SCAN_LIMIT,
      2500,
    ),
  ),
);
const reconcileReenqueueLimit = Math.max(
  10,
  Math.floor(
    readNumber(
      readArgValue("reconcile-reenqueue-limit") ??
        process.env.CATALOG_REFRESH_AUTO_RECONCILE_REENQUEUE_LIMIT,
      800,
    ),
  ),
);
const reconcileIncludeActiveAnalysis =
  (readArgValue("reconcile-include-active-analysis") ??
    process.env.CATALOG_REFRESH_MONITOR_RECONCILE_INCLUDE_ACTIVE_ANALYSIS ??
    "true")
    .toString()
    .trim()
    .toLowerCase() !== "false";
const remediateCooldownMinutes = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("remediate-cooldown-minutes") ??
        process.env.CATALOG_REFRESH_MONITOR_REMEDIATE_COOLDOWN_MINUTES,
      30,
    ),
  ),
);
const remediateLimit = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("remediate-limit") ??
        process.env.CATALOG_REFRESH_MONITOR_REMEDIATE_LIMIT,
      60,
    ),
  ),
);
const remediateMinNoProgressMinutes = Math.max(
  5,
  Math.floor(
    readNumber(
      readArgValue("remediate-min-no-progress-minutes") ??
        process.env.CATALOG_REFRESH_MONITOR_REMEDIATE_MIN_NO_PROGRESS_MINUTES,
      20,
    ),
  ),
);
const remediatePauseOverCapTarget = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("remediate-pause-over-cap-target") ??
        process.env.CATALOG_REFRESH_MONITOR_REMEDIATE_PAUSE_OVER_CAP_TARGET,
      64,
    ),
  ),
);
const remediateTailProgressPct = Math.max(
  50,
  Math.min(
    100,
    Math.floor(
      readNumber(
        readArgValue("remediate-tail-progress-pct") ??
          process.env.CATALOG_REFRESH_STUCK_TAIL_PROGRESS_PCT,
        99,
      ),
    ),
  ),
);
const remediateTailMaxRemaining = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("remediate-tail-max-remaining") ??
        process.env.CATALOG_REFRESH_STUCK_TAIL_MAX_REMAINING,
      20,
    ),
  ),
);
const remediateTailStaleMinutes = Math.max(
  5,
  Math.floor(
    readNumber(
      readArgValue("remediate-tail-stale-minutes") ??
        process.env.CATALOG_REFRESH_STUCK_TAIL_STALE_MINUTES,
      20,
    ),
  ),
);
const remediateForceTerminalizeRemaining =
  (readArgValue("remediate-force-terminalize-remaining") ??
    process.env.CATALOG_REFRESH_STUCK_TAIL_FORCE_TERMINALIZE_REMAINING ??
    "true")
    .toString()
    .trim()
    .toLowerCase() !== "false";
const guardrailConsecutiveCycles = Math.max(
  2,
  Math.floor(
    readNumber(
      readArgValue("guardrail-consecutive-cycles") ??
        process.env.CATALOG_REFRESH_MONITOR_GUARDRAIL_CONSECUTIVE_CYCLES,
      2,
    ),
  ),
);
const heartbeatGuardrailConsecutiveCycles = Math.max(
  2,
  Math.floor(
    readNumber(
      readArgValue("heartbeat-guardrail-consecutive-cycles") ??
        process.env.CATALOG_REFRESH_MONITOR_HEARTBEAT_GUARDRAIL_CONSECUTIVE_CYCLES,
      2,
    ),
  ),
);
const guardrailDrainLimit = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("guardrail-drain-limit") ??
        process.env.CATALOG_REFRESH_MONITOR_GUARDRAIL_DRAIN_LIMIT,
      12,
    ),
  ),
);
const guardrailDrainMaxMs = Math.max(
  2000,
  Math.floor(
    readNumber(
      readArgValue("guardrail-drain-max-ms") ??
        process.env.CATALOG_REFRESH_MONITOR_GUARDRAIL_DRAIN_MAX_MS,
      15000,
    ),
  ),
);
const cronMode =
  (readArgValue("cron-mode") ?? process.env.CATALOG_REFRESH_MONITOR_CRON_MODE ?? "light")
    .toString()
    .trim()
    .toLowerCase() === "heavy"
    ? "heavy"
    : "light";
const interventionModeRaw = (
  readArgValue("intervention-mode") ??
  process.env.CATALOG_REFRESH_MONITOR_INTERVENTION_MODE ??
  "minimal"
)
  .toString()
  .trim()
  .toLowerCase();
const interventionMode =
  interventionModeRaw === "active" || interventionModeRaw === "observe"
    ? interventionModeRaw
    : "minimal";
const nearCloseProgressPct = Math.max(
  50,
  Math.min(
    100,
    Math.floor(
      readNumber(
        readArgValue("near-close-progress-pct") ??
          process.env.CATALOG_REFRESH_MONITOR_NEAR_CLOSE_PROGRESS_PCT,
        90,
      ),
    ),
  ),
);
const nearCloseMaxPending = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("near-close-max-pending") ??
        process.env.CATALOG_REFRESH_MONITOR_NEAR_CLOSE_MAX_PENDING,
      40,
    ),
  ),
);
const nearCloseRunLimit = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("near-close-run-limit") ??
        process.env.CATALOG_REFRESH_MONITOR_NEAR_CLOSE_RUN_LIMIT,
      8,
    ),
  ),
);
const nearCloseMinConsecutiveCycles = Math.max(
  1,
  Math.floor(
    readNumber(
      readArgValue("near-close-min-consecutive-cycles") ??
        process.env.CATALOG_REFRESH_MONITOR_NEAR_CLOSE_MIN_CONSECUTIVE_CYCLES,
      2,
    ),
  ),
);
const runCron = hasFlag("run-cron");
const reportDir = path.join(repoRoot, "reports", "catalog_refresh_diagnostics");
const stateFile =
  readArgValue("state-file") ||
  process.env.CATALOG_REFRESH_MONITOR_STATE_FILE ||
  path.join(reportDir, "monitor-state.json");
const lockFile =
  readArgValue("lock-file") ||
  process.env.CATALOG_REFRESH_MONITOR_LOCK_FILE ||
  path.join(reportDir, "monitor.lock");
const requestTimeoutMs = Math.max(
  5000,
  Math.floor(
    readNumber(
      readArgValue("request-timeout-ms") ??
        process.env.CATALOG_REFRESH_MONITOR_REQUEST_TIMEOUT_MS,
      45000,
    ),
  ),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFileTimestamp = (iso) => iso.replace(/[:.]/g, "-");

const isPidAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let lockAcquired = false;
const releaseSingleInstanceLockSync = () => {
  if (!lockAcquired) return;
  try {
    if (fsSync.existsSync(lockFile)) fsSync.unlinkSync(lockFile);
  } catch {}
  lockAcquired = false;
};

const acquireSingleInstanceLock = async () => {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  const payload = {
    pid: process.pid,
    startedAt: nowIso(),
    baseUrl,
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    await fs.writeFile(lockFile, content, { encoding: "utf8", flag: "wx" });
    lockAcquired = true;
    return;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code !== "EEXIST") throw error;
  }

  let stale = false;
  try {
    const existingRaw = await fs.readFile(lockFile, "utf8");
    const existing = JSON.parse(existingRaw);
    const existingPid = Number(existing?.pid);
    stale = !isPidAlive(existingPid);
    if (!stale) {
      throw new Error(
        `Monitor ya en ejecución (pid=${existingPid}) con lock ${lockFile}.`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Monitor ya en ejecución")
    ) {
      throw error;
    }
    stale = true;
  }

  if (stale) {
    await fs.unlink(lockFile).catch(() => null);
    await fs.writeFile(lockFile, content, { encoding: "utf8", flag: "wx" });
    lockAcquired = true;
  }
};

const registerExitHandlers = () => {
  const handleExit = (signal, code = 0) => {
    releaseSingleInstanceLockSync();
    if (signal) process.stderr.write(`[monitor] exit ${signal}\n`);
    process.exit(code);
  };
  process.on("SIGINT", () => handleExit("SIGINT"));
  process.on("SIGTERM", () => handleExit("SIGTERM"));
  process.on("uncaughtException", (error) => {
    process.stderr.write(
      `[monitor] uncaught_exception ${error instanceof Error ? error.message : String(error)}\n`,
    );
    handleExit("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `[monitor] unhandled_rejection ${reason instanceof Error ? reason.message : String(reason)}\n`,
    );
    handleExit("unhandledRejection", 1);
  });
};

const requestJson = async (route, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl}${route}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new Error(`${route}: timeout after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && typeof json.error === "string" && json.error) ||
      `HTTP ${res.status}`;
    throw new Error(`${route}: ${message}`);
  }
  return json;
};

const requestJsonSafe = async (route, options = {}) => {
  try {
    const data = await requestJson(route, options);
    return { ok: true, data, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, data: null, error: message };
  }
};

const extractProcessingNoProgressEntries = (state) => {
  const diagnosticsAll = Array.isArray(state?.diagnostics?.processingNoProgress?.all)
    ? state.diagnostics.processingNoProgress.all
    : [];
  const diagnosticsTop = Array.isArray(state?.diagnostics?.processingNoProgress?.top)
    ? state.diagnostics.processingNoProgress.top
    : [];
  const summaryTop = Array.isArray(state?.summary?.processingNoProgressTop)
    ? state.summary.processingNoProgressTop
    : [];
  const source = diagnosticsAll.length
    ? diagnosticsAll
    : diagnosticsTop.length
      ? diagnosticsTop
      : summaryTop;
  const normalized = source
    .map((row) => ({
      runId: typeof row?.runId === "string" ? row.runId : null,
      brandName: typeof row?.brandName === "string" ? row.brandName : "unknown",
      progressPct: Number(row?.progressPct ?? 0) || 0,
      pending: Number(row?.pending ?? 0) || 0,
      completedRecent: Number(row?.completedRecent ?? 0) || 0,
      updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : null,
    }))
    .filter((row) => row.runId)
    .sort((a, b) => {
      if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
      if (a.pending !== b.pending) return a.pending - b.pending;
      return String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? ""));
    });
  const deduped = [];
  const seen = new Set();
  for (const row of normalized) {
    if (!row.runId || seen.has(row.runId)) continue;
    seen.add(row.runId);
    deduped.push(row);
  }
  return deduped;
};

const extractNearCloseCandidates = (entries, stuckRunStreaks) => {
  const normalized = entries
    .filter((row) => row.progressPct >= nearCloseProgressPct)
    .filter((row) => row.pending <= nearCloseMaxPending)
    .filter((row) => row.completedRecent <= 0)
    .filter(
      (row) => Number(stuckRunStreaks?.[row.runId] ?? 0) >= nearCloseMinConsecutiveCycles,
    )
    .sort((a, b) => {
      if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
      if (a.pending !== b.pending) return a.pending - b.pending;
      return String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? ""));
    });

  const deduped = [];
  const seen = new Set();
  for (const row of normalized) {
    if (!row.runId || seen.has(row.runId)) continue;
    seen.add(row.runId);
    deduped.push(row);
    if (deduped.length >= nearCloseRunLimit) break;
  }
  return deduped;
};

const computeNoProgressInsights = (entries, stuckRunStreaks) => {
  const buckets = {
    pct99plus: 0,
    pct95to98: 0,
    pct90to94: 0,
    pct80to89: 0,
    pctBelow80: 0,
  };
  const staleBuckets = {
    staleOver20m: 0,
    staleOver60m: 0,
    staleOver180m: 0,
    staleOver720m: 0,
  };
  const nowMs = Date.now();
  const topPersistent = entries
    .map((entry) => {
      const updatedMs = entry.updatedAt ? new Date(entry.updatedAt).getTime() : null;
      const staleMinutes =
        updatedMs && Number.isFinite(updatedMs)
          ? Math.max(0, Math.floor((nowMs - updatedMs) / (60 * 1000)))
          : null;
      const streak = Number(stuckRunStreaks?.[entry.runId] ?? 0) || 0;
      if (entry.progressPct >= 99) buckets.pct99plus += 1;
      else if (entry.progressPct >= 95) buckets.pct95to98 += 1;
      else if (entry.progressPct >= 90) buckets.pct90to94 += 1;
      else if (entry.progressPct >= 80) buckets.pct80to89 += 1;
      else buckets.pctBelow80 += 1;

      if (staleMinutes !== null) {
        if (staleMinutes >= 20) staleBuckets.staleOver20m += 1;
        if (staleMinutes >= 60) staleBuckets.staleOver60m += 1;
        if (staleMinutes >= 180) staleBuckets.staleOver180m += 1;
        if (staleMinutes >= 720) staleBuckets.staleOver720m += 1;
      }

      return {
        runId: entry.runId,
        brandName: entry.brandName,
        progressPct: entry.progressPct,
        pending: entry.pending,
        staleMinutes,
        consecutiveNoProgressCycles: streak,
      };
    })
    .sort((a, b) => {
      if (b.consecutiveNoProgressCycles !== a.consecutiveNoProgressCycles) {
        return b.consecutiveNoProgressCycles - a.consecutiveNoProgressCycles;
      }
      if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
      if (a.pending !== b.pending) return a.pending - b.pending;
      return (b.staleMinutes ?? 0) - (a.staleMinutes ?? 0);
    })
    .slice(0, 25);

  return {
    total: entries.length,
    buckets,
    staleBuckets,
    topPersistent,
  };
};

const inferRootCauseSignals = (params) => {
  const endpointErrors = Array.isArray(params.endpointErrors)
    ? params.endpointErrors.filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          typeof entry.endpoint === "string" &&
          typeof entry.error === "string",
      )
    : [];
  const hasStateError = endpointErrors.some(
    (entry) => entry.endpoint === "catalog-refresh/state",
  );
  const hasQueueHealthError = endpointErrors.some(
    (entry) => entry.endpoint === "queue-health",
  );
  const actionErrors = params.actions
    .map((action) => action.error ?? action.message ?? null)
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase());
  const drainLockedCount = params.actions.filter(
    (action) =>
      typeof action.type === "string" &&
      action.type.includes("drain") &&
      action.skipped === "drain_locked",
  ).length;
  const timeoutErrorCount = actionErrors.filter(
    (message) =>
      message.includes("timeout") || message.includes("timed out") || message.includes("function_invocation_timeout"),
  ).length;
  const dbAuthTimeoutCount = actionErrors.filter((message) =>
    message.includes("authentication timed out"),
  ).length;
  const queueActiveZeroWithWaiting = params.queueWaiting > 0 && params.queueActive <= 0;

  let primary = "none";
  if (hasStateError && hasQueueHealthError) primary = "state_and_queue_health_unavailable";
  else if (hasStateError) primary = "state_unavailable";
  else if (hasQueueHealthError) primary = "queue_health_unavailable";
  else if (params.heartbeatMissing) primary = "worker_heartbeat_missing";
  else if (queueActiveZeroWithWaiting) primary = "queue_not_consuming";
  else if (dbAuthTimeoutCount > 0) primary = "db_auth_timeouts";
  else if (timeoutErrorCount > 0) primary = "route_timeouts";
  else if (drainLockedCount > 0) primary = "drain_lock_contention";
  else if (params.waitingItemNotQueued > 0) primary = "queue_drift_waiting_item_not_queued";
  else if (params.runsRunnableWithoutQueueLoad > 0) primary = "queue_drift_runnable_without_load";

  return {
    primary,
    heartbeatMissing: params.heartbeatMissing,
    queueActiveZeroWithWaiting,
    drainLockedCount,
    timeoutErrorCount,
    dbAuthTimeoutCount,
    endpointErrors: params.endpointErrors ?? [],
  };
};

await fs.mkdir(reportDir, { recursive: true });

const loadState = async () => {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {
        lastCronAt: 0,
        lastRemediateAt: 0,
        guardrailConsecutiveHits: 0,
        heartbeatMissingConsecutive: 0,
        skipRemediateCycles: 0,
        totalTimeoutErrors: 0,
        totalDbAuthTimeouts: 0,
        totalDrainLocked: 0,
        stuckRunStreaks: {},
      };
    }
    return {
      lastCronAt: Number(parsed.lastCronAt ?? 0) || 0,
      lastRemediateAt: Number(parsed.lastRemediateAt ?? 0) || 0,
      guardrailConsecutiveHits: Number(parsed.guardrailConsecutiveHits ?? 0) || 0,
      heartbeatMissingConsecutive:
        Number(parsed.heartbeatMissingConsecutive ?? 0) || 0,
      skipRemediateCycles: Number(parsed.skipRemediateCycles ?? 0) || 0,
      totalTimeoutErrors: Number(parsed.totalTimeoutErrors ?? 0) || 0,
      totalDbAuthTimeouts: Number(parsed.totalDbAuthTimeouts ?? 0) || 0,
      totalDrainLocked: Number(parsed.totalDrainLocked ?? 0) || 0,
      stuckRunStreaks:
        parsed.stuckRunStreaks && typeof parsed.stuckRunStreaks === "object"
          ? parsed.stuckRunStreaks
          : {},
    };
  } catch {
    return {
      lastCronAt: 0,
      lastRemediateAt: 0,
      guardrailConsecutiveHits: 0,
      heartbeatMissingConsecutive: 0,
      skipRemediateCycles: 0,
      totalTimeoutErrors: 0,
      totalDbAuthTimeouts: 0,
      totalDrainLocked: 0,
      stuckRunStreaks: {},
    };
  }
};

const persistState = async () => {
  const payload = {
    lastCronAt,
    lastRemediateAt,
    guardrailConsecutiveHits,
    heartbeatMissingConsecutive,
    skipRemediateCycles,
    totalTimeoutErrors,
    totalDbAuthTimeouts,
    totalDrainLocked,
    stuckRunStreaks,
    updatedAt: nowIso(),
  };
  await fs.writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

let previous = null;
let lastCronAt = 0;
let lastRemediateAt = 0;
let guardrailConsecutiveHits = 0;
let heartbeatMissingConsecutive = 0;
let skipRemediateCycles = 0;
let totalTimeoutErrors = 0;
let totalDbAuthTimeouts = 0;
let totalDrainLocked = 0;
let stuckRunStreaks = {};
const persistedState = await loadState();
lastCronAt = persistedState.lastCronAt;
lastRemediateAt = persistedState.lastRemediateAt;
guardrailConsecutiveHits = persistedState.guardrailConsecutiveHits;
heartbeatMissingConsecutive = persistedState.heartbeatMissingConsecutive;
skipRemediateCycles = persistedState.skipRemediateCycles;
totalTimeoutErrors = persistedState.totalTimeoutErrors;
totalDbAuthTimeouts = persistedState.totalDbAuthTimeouts;
totalDrainLocked = persistedState.totalDrainLocked;
stuckRunStreaks =
  persistedState.stuckRunStreaks && typeof persistedState.stuckRunStreaks === "object"
    ? persistedState.stuckRunStreaks
    : {};
let cycle = 0;
await acquireSingleInstanceLock();
registerExitHandlers();

try {
  while (iterations === 0 || cycle < iterations) {
    cycle += 1;
    const startedAt = Date.now();
    const timestamp = nowIso();
    const actions = [];

    try {
      const [stateAttempt, queueHealthAttempt] = await Promise.all([
        requestJsonSafe("/api/admin/catalog-refresh/state"),
        requestJsonSafe("/api/admin/queue-health"),
      ]);
      const endpointErrors = [];
      if (!stateAttempt.ok) {
        endpointErrors.push({ endpoint: "catalog-refresh/state", error: stateAttempt.error });
        actions.push({
          type: "state_error",
          error: stateAttempt.error,
        });
      }
      if (!queueHealthAttempt.ok) {
        endpointErrors.push({ endpoint: "queue-health", error: queueHealthAttempt.error });
        actions.push({
          type: "queue_health_error",
          error: queueHealthAttempt.error,
        });
      }
      const state = stateAttempt.ok ? stateAttempt.data : {};
      const queueHealth = queueHealthAttempt.ok ? queueHealthAttempt.data : {};

      const drift = queueHealth?.drift ?? {};
      const waitingItemNotQueued = Number(drift.waitingItemNotQueued ?? 0) || 0;
      const runsRunnableWithoutQueueLoad =
        Number(drift.runsRunnableWithoutQueueLoad ?? 0) || 0;
      const zombieCriticalCount =
        Number(
          drift.activeZombieCriticalCount ??
            queueHealth?.activeHang?.catalog?.zombieCriticalCount ??
            0,
        ) || 0;
      const activeHungDetected = Boolean(
        queueHealth?.flags?.activeHung ??
          drift.activeHungDetected ??
          queueHealth?.activeHang?.catalog?.activeHungDetected ??
          false,
      );
      const heartbeatMissing = Boolean(
        state?.summary?.heartbeatMissing ?? queueHealth?.flags?.heartbeatMissing ?? false,
      );
      heartbeatMissingConsecutive = heartbeatMissing
        ? heartbeatMissingConsecutive + 1
        : 0;
      const heartbeatGuardrailTriggered =
        heartbeatMissingConsecutive >= heartbeatGuardrailConsecutiveCycles;
      const processingNoProgress =
        Number(state?.summary?.processingRunsWithoutRecentProgress ?? 0) || 0;
      const noProgressEntries = extractProcessingNoProgressEntries(state);
      const liveRunIds = new Set(noProgressEntries.map((entry) => entry.runId));
      const nextStreaks = {};
      for (const entry of noProgressEntries) {
        const previousStreak = Number(stuckRunStreaks?.[entry.runId] ?? 0) || 0;
        nextStreaks[entry.runId] = previousStreak + 1;
      }
      // Evita crecimiento indefinido del archivo de estado.
      for (const runId of Object.keys(stuckRunStreaks)) {
        if (!liveRunIds.has(runId)) continue;
        if (!Object.prototype.hasOwnProperty.call(nextStreaks, runId)) {
          nextStreaks[runId] = Number(stuckRunStreaks[runId] ?? 0) || 0;
        }
      }
      stuckRunStreaks = nextStreaks;
      const noProgressInsights = computeNoProgressInsights(noProgressEntries, stuckRunStreaks);
      const guardrailSignal = zombieCriticalCount > 0 || activeHungDetected;
      guardrailConsecutiveHits = guardrailSignal ? guardrailConsecutiveHits + 1 : 0;
      const guardrailTriggered = guardrailConsecutiveHits >= guardrailConsecutiveCycles;
      const allowInterventions = interventionMode !== "observe";
      const interventionIsMinimal = interventionMode === "minimal";
      if (guardrailTriggered) {
        skipRemediateCycles = Math.max(skipRemediateCycles, 1);
        actions.push({
          type: "guardrail_triggered",
          guardrailConsecutiveHits,
          guardrailConsecutiveCycles,
          zombieCriticalCount,
          activeHungDetected,
          skipRemediateCycles,
        });
      }
      if (heartbeatGuardrailTriggered) {
        actions.push({
          type: "heartbeat_guardrail_triggered",
          heartbeatMissingConsecutive,
          heartbeatGuardrailConsecutiveCycles,
        });
        if (!allowInterventions) {
          actions.push({
            type: "heartbeat_guardrail_drain_skipped_observe",
            reason: "intervention_mode_observe",
          });
        } else {
          const drainAttempt = await requestJsonSafe(
            "/api/admin/catalog-extractor/drain?force=true",
            {
              method: "POST",
              body: {
                dryRun: false,
                drainBatch: guardrailDrainLimit,
                drainMaxMs: guardrailDrainMaxMs,
                drainConcurrency: 2,
                drainMaxRuns: 1,
                aggressiveTailCloseEnabled: true,
                tailProgressPct: remediateTailProgressPct,
                tailMaxRemaining: remediateTailMaxRemaining,
                tailStaleMinutes: remediateTailStaleMinutes,
                forceTerminalizeRemaining: remediateForceTerminalizeRemaining,
              },
            },
          );
          if (drainAttempt.ok) {
            actions.push({
              type: "heartbeat_guardrail_drain",
              drainLimit: guardrailDrainLimit,
              drainMaxMs: guardrailDrainMaxMs,
              processed: Number(drainAttempt.data?.processed ?? 0),
              runsProcessed: Number(drainAttempt.data?.runsProcessed ?? 0),
              finalizedRuns: Number(drainAttempt.data?.finalizedRuns ?? 0),
              forcedClosedRuns: Number(drainAttempt.data?.forcedClosedRuns ?? 0),
              forcedFailedItems: Number(drainAttempt.data?.forcedFailedItems ?? 0),
              tailProcessedRuns: Number(drainAttempt.data?.tailProcessedRuns ?? 0),
              skipped: drainAttempt.data?.skipped ?? null,
            });
          } else {
            actions.push({
              type: "heartbeat_guardrail_drain_error",
              error: drainAttempt.error,
            });
          }
        }
      }

      const shouldReconcile =
        heartbeatGuardrailTriggered ||
        waitingItemNotQueued > 0 ||
        runsRunnableWithoutQueueLoad > 0 ||
        zombieCriticalCount > 0 ||
        activeHungDetected;
      if (shouldReconcile) {
        if (!allowInterventions) {
          actions.push({
            type: "reconcile_skipped_observe",
            reason: "intervention_mode_observe",
            waitingItemNotQueued,
            runsRunnableWithoutQueueLoad,
          });
        } else {
          const reconcileAttempt = await requestJsonSafe("/api/admin/catalog-extractor/reconcile", {
            method: "POST",
            body: {
              dryRun: false,
              jobScanLimit: reconcileJobScanLimit,
              reenqueueLimit: reconcileReenqueueLimit,
              includeActiveAnalysis: reconcileIncludeActiveAnalysis,
            },
          });
          if (reconcileAttempt.ok) {
            actions.push({
              type: "reconcile",
              waitingItemNotQueued,
              runsRunnableWithoutQueueLoad,
              zombieCriticalCount,
              activeHungDetected,
              heartbeatMissingConsecutive,
              jobScanLimit: reconcileJobScanLimit,
              reenqueueLimit: reconcileReenqueueLimit,
              includeActiveAnalysis: reconcileIncludeActiveAnalysis,
              removedJobs: reconcileAttempt.data?.removedJobs ?? 0,
              reenqueued: reconcileAttempt.data?.reenqueued ?? 0,
            });
          } else {
            actions.push({
              type: "reconcile_error",
              waitingItemNotQueued,
              runsRunnableWithoutQueueLoad,
              error: reconcileAttempt.error,
            });
          }
        }
      }

      const remediateCooldownMs = remediateCooldownMinutes * 60 * 1000;
      const remediateOnCooldown =
        lastRemediateAt > 0 && Date.now() - lastRemediateAt < remediateCooldownMs;
      if (processingNoProgress >= stuckThreshold && skipRemediateCycles > 0) {
        actions.push({
          type: "remediate_suppressed_guardrail",
          threshold: stuckThreshold,
          processingNoProgress,
          guardrailConsecutiveHits,
          skipRemediateCycles,
        });
      } else if (processingNoProgress >= stuckThreshold && !allowInterventions) {
        actions.push({
          type: "remediate_skipped_observe",
          threshold: stuckThreshold,
          processingNoProgress,
          reason: "intervention_mode_observe",
        });
      } else if (processingNoProgress >= stuckThreshold && !remediateOnCooldown) {
        if (interventionIsMinimal) {
          const nearCloseCandidates = extractNearCloseCandidates(
            noProgressEntries,
            stuckRunStreaks,
          );
          if (!nearCloseCandidates.length) {
            actions.push({
              type: "remediate_minimal_no_candidates",
              threshold: stuckThreshold,
              processingNoProgress,
              nearCloseProgressPct,
              nearCloseMaxPending,
              nearCloseRunLimit,
              nearCloseMinConsecutiveCycles,
              monitoredNoProgressRuns: noProgressInsights.total,
            });
          } else {
            let resumed = 0;
            let paused = 0;
            let requeued = 0;
            let forcedClosedRuns = 0;
            let forcedFailedItems = 0;
            let tailProcessedRuns = 0;
            let errors = 0;
            const failedRuns = [];
            for (const candidate of nearCloseCandidates) {
              const remediationAttempt = await requestJsonSafe("/api/admin/catalog-refresh/remediate", {
                method: "POST",
                body: {
                  dryRun: false,
                  strategy: "aggressive_tail_close",
                  runId: candidate.runId,
                  limit: 1,
                  minNoProgressMinutes: remediateMinNoProgressMinutes,
                  pauseOverCapTarget: remediatePauseOverCapTarget,
                  tailProgressPct: Math.max(remediateTailProgressPct, candidate.progressPct),
                  tailMaxRemaining: Math.max(remediateTailMaxRemaining, candidate.pending + 5),
                  tailStaleMinutes: remediateTailStaleMinutes,
                  forceTerminalizeRemaining: remediateForceTerminalizeRemaining,
                },
              });
              if (!remediationAttempt.ok) {
                errors += 1;
                failedRuns.push({
                  runId: candidate.runId,
                  brandName: candidate.brandName,
                  error: remediationAttempt.error,
                });
                continue;
              }
              resumed += Number(remediationAttempt.data?.resumed ?? 0);
              paused += Number(remediationAttempt.data?.paused ?? 0);
              requeued += Number(remediationAttempt.data?.requeued ?? 0);
              forcedClosedRuns += Number(remediationAttempt.data?.forcedClosedRuns ?? 0);
              forcedFailedItems += Number(remediationAttempt.data?.forcedFailedItems ?? 0);
              tailProcessedRuns += Number(remediationAttempt.data?.tailProcessedRuns ?? 0);
              errors += Number(remediationAttempt.data?.errors ?? 0);
            }
            lastRemediateAt = Date.now();
            actions.push({
              type: "remediate_minimal_near_close",
              threshold: stuckThreshold,
              processingNoProgress,
              cooldownMinutes: remediateCooldownMinutes,
              candidateRuns: nearCloseCandidates.map((candidate) => ({
                runId: candidate.runId,
                brandName: candidate.brandName,
                progressPct: candidate.progressPct,
                pending: candidate.pending,
                consecutiveNoProgressCycles:
                  Number(stuckRunStreaks?.[candidate.runId] ?? 0) || 0,
              })),
              resumed,
              paused,
              requeued,
              forcedClosedRuns,
              forcedFailedItems,
              tailProcessedRuns,
              errors,
              failedRuns,
              nearCloseMinConsecutiveCycles,
              monitoredNoProgressRuns: noProgressInsights.total,
            });
          }
        } else {
          const remediateAttempt = await requestJsonSafe("/api/admin/catalog-refresh/remediate", {
            method: "POST",
            body: {
              dryRun: false,
              strategy: "aggressive_tail_close",
              limit: remediateLimit,
              minNoProgressMinutes: remediateMinNoProgressMinutes,
              pauseOverCapTarget: remediatePauseOverCapTarget,
              tailProgressPct: remediateTailProgressPct,
              tailMaxRemaining: remediateTailMaxRemaining,
              tailStaleMinutes: remediateTailStaleMinutes,
              forceTerminalizeRemaining: remediateForceTerminalizeRemaining,
            },
          });
          if (remediateAttempt.ok) {
            lastRemediateAt = Date.now();
            actions.push({
              type: "remediate_aggressive_tail_close",
              threshold: stuckThreshold,
              processingNoProgress,
              cooldownMinutes: remediateCooldownMinutes,
              limit: remediateLimit,
              minNoProgressMinutes: remediateMinNoProgressMinutes,
              pauseOverCapTarget: remediatePauseOverCapTarget,
              tailProgressPct: remediateTailProgressPct,
              tailMaxRemaining: remediateTailMaxRemaining,
              tailStaleMinutes: remediateTailStaleMinutes,
              forceTerminalizeRemaining: remediateForceTerminalizeRemaining,
              resumed: remediateAttempt.data?.resumed ?? 0,
              paused: remediateAttempt.data?.paused ?? 0,
              requeued: remediateAttempt.data?.requeued ?? 0,
              forcedClosedRuns: remediateAttempt.data?.forcedClosedRuns ?? 0,
              forcedFailedItems: remediateAttempt.data?.forcedFailedItems ?? 0,
              tailProcessedRuns: remediateAttempt.data?.tailProcessedRuns ?? 0,
              errors: remediateAttempt.data?.errors ?? 0,
            });
          } else {
            actions.push({
              type: "remediate_error",
              threshold: stuckThreshold,
              processingNoProgress,
              message: remediateAttempt.error,
            });
          }
        }
      } else if (processingNoProgress >= stuckThreshold) {
        actions.push({
          type: "remediate_skipped_cooldown",
          threshold: stuckThreshold,
          processingNoProgress,
          cooldownMinutes: remediateCooldownMinutes,
          nextAllowedAt: new Date(lastRemediateAt + remediateCooldownMs).toISOString(),
        });
      }
      if (skipRemediateCycles > 0) {
        skipRemediateCycles -= 1;
      }

      const shouldRunGuardrailCron = heartbeatGuardrailTriggered;
      const shouldRunScheduledCron =
        runCron && Date.now() - lastCronAt >= cronEveryMinutes * 60 * 1000;
      const cronModeToUse = shouldRunGuardrailCron ? "light" : cronMode;
      let cron = null;
      if (shouldRunGuardrailCron || shouldRunScheduledCron) {
        if (!allowInterventions) {
          actions.push({
            type: "cron_skipped_observe",
            mode: cronModeToUse,
            reason: "intervention_mode_observe",
          });
        } else {
          const cronAttempt = await requestJsonSafe(`/api/admin/catalog-refresh/cron?mode=${cronModeToUse}`);
          if (cronAttempt.ok) {
            cron = cronAttempt.data;
            lastCronAt = Date.now();
            actions.push({
              type: shouldRunGuardrailCron ? "heartbeat_guardrail_cron" : "cron",
              mode: cronModeToUse,
              selected: cron?.selected ?? 0,
              throttledByActiveCap: Boolean(cron?.throttledByActiveCap),
              stuckRemediation: cron?.stuckRemediation
                ? {
                    attempted: Boolean(cron.stuckRemediation.attempted),
                    resumed: Number(cron.stuckRemediation.resumed ?? 0),
                    paused: Number(cron.stuckRemediation.paused ?? 0),
                    requeued: Number(cron.stuckRemediation.requeued ?? 0),
                    errors: Number(cron.stuckRemediation.errors ?? 0),
                  }
                : null,
            });
          } else {
            actions.push({
              type: "cron_error",
              mode: cronModeToUse,
              error: cronAttempt.error,
            });
          }
        }
      }

      const summary = state?.summary ?? {};
      const rootCause = inferRootCauseSignals({
        actions,
        heartbeatMissing,
        queueWaiting: Number(queueHealth?.queues?.catalog?.waiting ?? 0),
        queueActive: Number(queueHealth?.queues?.catalog?.active ?? 0),
        waitingItemNotQueued,
        runsRunnableWithoutQueueLoad,
        endpointErrors,
      });
      totalTimeoutErrors += rootCause.timeoutErrorCount;
      totalDbAuthTimeouts += rootCause.dbAuthTimeoutCount;
      totalDrainLocked += rootCause.drainLockedCount;
      const snapshot = {
        timestamp,
        baseUrl,
        cycle,
        intervalMinutes,
        monitor: {
          interventionMode,
          remediateEnabled: interventionMode !== "observe",
          nearCloseProgressPct,
          nearCloseMaxPending,
          nearCloseRunLimit,
          nearCloseMinConsecutiveCycles,
          requestTimeoutMs,
        },
        summary: {
          freshBrands: Number(summary.freshBrands ?? 0),
          staleBrands: Number(summary.staleBrands ?? 0),
          processingRunsWithoutRecentProgress: Number(
            summary.processingRunsWithoutRecentProgress ?? 0,
          ),
          activeRunCount: Number(summary.activeRunCount ?? 0),
          activeRunCap: Number(summary.activeRunCap ?? 0),
          processingRunCount: Number(summary.processingRunCount ?? 0),
          pausedRunCount: Number(summary.pausedRunCount ?? 0),
          blockedRunCount: Number(summary.blockedRunCount ?? 0),
          schedulingCapacityRemaining: Number(
            summary.schedulingCapacityRemaining ?? 0,
          ),
          highProgressNoProgressCount: Number(
            summary.highProgressNoProgressCount ?? 0,
          ),
        },
        queue: {
          waiting: Number(queueHealth?.queues?.catalog?.waiting ?? 0),
          active: Number(queueHealth?.queues?.catalog?.active ?? 0),
          delayed: Number(queueHealth?.queues?.catalog?.delayed ?? 0),
          waitingItemNotQueued,
          runsRunnableWithoutQueueLoad,
          activeZombieCriticalCount: zombieCriticalCount,
          activeHungDetected,
          heartbeatMissing,
          heartbeatMissingConsecutive,
        },
        rootCause,
        noProgressInsights,
        cumulativeSignals: {
          totalTimeoutErrors,
          totalDbAuthTimeouts,
          totalDrainLocked,
        },
        actions,
        cron,
        trend: previous
          ? {
              waitingDelta:
                Number(queueHealth?.queues?.catalog?.waiting ?? 0) -
                Number(previous.queue?.waiting ?? 0),
              freshBrandsDelta:
                Number(summary.freshBrands ?? 0) -
                Number(previous.summary?.freshBrands ?? 0),
              staleBrandsDelta:
                Number(summary.staleBrands ?? 0) -
                Number(previous.summary?.staleBrands ?? 0),
              processingNoProgressDelta:
                Number(summary.processingRunsWithoutRecentProgress ?? 0) -
                Number(previous.summary?.processingRunsWithoutRecentProgress ?? 0),
            }
          : null,
        elapsedMs: Date.now() - startedAt,
      };

      const reportPath = path.join(
        reportDir,
        `${toFileTimestamp(timestamp)}-catalog-refresh-ops.json`,
      );
      await fs.writeFile(reportPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await persistState();
      previous = snapshot;

      const trendSummary = snapshot.trend
        ? `delta waiting=${snapshot.trend.waitingDelta}, fresh=${snapshot.trend.freshBrandsDelta}, stale=${snapshot.trend.staleBrandsDelta}, no_progress=${snapshot.trend.processingNoProgressDelta}`
        : "sin delta (primer ciclo)";
      process.stdout.write(
        `[${timestamp}] mode=${interventionMode} root=${snapshot.rootCause.primary} waiting=${snapshot.queue.waiting} active=${snapshot.queue.active} delayed=${snapshot.queue.delayed} fresh=${snapshot.summary.freshBrands} stale=${snapshot.summary.staleBrands} no_progress=${snapshot.summary.processingRunsWithoutRecentProgress} actions=${actions.length} ${trendSummary}\n`,
      );
      process.stdout.write(`  snapshot=${reportPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[${timestamp}] monitor_error ${message}\n`);
    }

    if (iterations !== 0 && cycle >= iterations) break;
    await sleep(intervalMinutes * 60 * 1000);
  }
} finally {
  await fs.unlink(lockFile).catch(() => null);
  lockAcquired = false;
}
