import fs from "node:fs/promises";
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
  readNumber(readArgValue("iterations") ?? process.env.CATALOG_REFRESH_MONITOR_ITERATIONS, 1),
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
      30,
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
const cronMode =
  (readArgValue("cron-mode") ?? process.env.CATALOG_REFRESH_MONITOR_CRON_MODE ?? "light")
    .toString()
    .trim()
    .toLowerCase() === "heavy"
    ? "heavy"
    : "light";
const runCron = hasFlag("run-cron");
const reportDir = path.join(repoRoot, "reports", "catalog_refresh_diagnostics");
const stateFile =
  readArgValue("state-file") ||
  process.env.CATALOG_REFRESH_MONITOR_STATE_FILE ||
  path.join(reportDir, "monitor-state.json");
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
        skipRemediateCycles: 0,
      };
    }
    return {
      lastCronAt: Number(parsed.lastCronAt ?? 0) || 0,
      lastRemediateAt: Number(parsed.lastRemediateAt ?? 0) || 0,
      guardrailConsecutiveHits: Number(parsed.guardrailConsecutiveHits ?? 0) || 0,
      skipRemediateCycles: Number(parsed.skipRemediateCycles ?? 0) || 0,
    };
  } catch {
    return {
      lastCronAt: 0,
      lastRemediateAt: 0,
      guardrailConsecutiveHits: 0,
      skipRemediateCycles: 0,
    };
  }
};

const persistState = async () => {
  const payload = {
    lastCronAt,
    lastRemediateAt,
    guardrailConsecutiveHits,
    skipRemediateCycles,
    updatedAt: nowIso(),
  };
  await fs.writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

let previous = null;
let lastCronAt = 0;
let lastRemediateAt = 0;
let guardrailConsecutiveHits = 0;
let skipRemediateCycles = 0;
const persistedState = await loadState();
lastCronAt = persistedState.lastCronAt;
lastRemediateAt = persistedState.lastRemediateAt;
guardrailConsecutiveHits = persistedState.guardrailConsecutiveHits;
skipRemediateCycles = persistedState.skipRemediateCycles;
let cycle = 0;

while (iterations === 0 || cycle < iterations) {
  cycle += 1;
  const startedAt = Date.now();
  const timestamp = nowIso();
  const actions = [];

  try {
    const [state, queueHealth] = await Promise.all([
      requestJson("/api/admin/catalog-refresh/state"),
      requestJson("/api/admin/queue-health"),
    ]);

    const drift = queueHealth?.drift ?? {};
    const waitingItemNotQueued = Number(drift.waitingItemNotQueued ?? 0) || 0;
    const runsRunnableWithoutQueueLoad = Number(drift.runsRunnableWithoutQueueLoad ?? 0) || 0;
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
    const processingNoProgress =
      Number(state?.summary?.processingRunsWithoutRecentProgress ?? 0) || 0;
    const guardrailSignal = zombieCriticalCount > 0 || activeHungDetected;
    guardrailConsecutiveHits = guardrailSignal ? guardrailConsecutiveHits + 1 : 0;
    const guardrailTriggered = guardrailConsecutiveHits >= guardrailConsecutiveCycles;
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

    if (
      waitingItemNotQueued > 0 ||
      runsRunnableWithoutQueueLoad > 0 ||
      zombieCriticalCount > 0 ||
      activeHungDetected
    ) {
      const reconcileResult = await requestJson("/api/admin/catalog-extractor/reconcile", {
        method: "POST",
        body: {
          dryRun: false,
          jobScanLimit: reconcileJobScanLimit,
          reenqueueLimit: reconcileReenqueueLimit,
          includeActiveAnalysis: reconcileIncludeActiveAnalysis,
        },
      });
      actions.push({
        type: "reconcile",
        waitingItemNotQueued,
        runsRunnableWithoutQueueLoad,
        zombieCriticalCount,
        activeHungDetected,
        jobScanLimit: reconcileJobScanLimit,
        reenqueueLimit: reconcileReenqueueLimit,
        includeActiveAnalysis: reconcileIncludeActiveAnalysis,
        removedJobs: reconcileResult?.removedJobs ?? 0,
        reenqueued: reconcileResult?.reenqueued ?? 0,
      });
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
    } else if (processingNoProgress >= stuckThreshold && !remediateOnCooldown) {
      try {
        const remediateResult = await requestJson("/api/admin/catalog-refresh/remediate", {
          method: "POST",
          body: {
            dryRun: false,
            strategy: "balanced",
            limit: remediateLimit,
            minNoProgressMinutes: remediateMinNoProgressMinutes,
            pauseOverCapTarget: remediatePauseOverCapTarget,
          },
        });
        lastRemediateAt = Date.now();
        actions.push({
          type: "remediate_balanced",
          threshold: stuckThreshold,
          processingNoProgress,
          cooldownMinutes: remediateCooldownMinutes,
          limit: remediateLimit,
          minNoProgressMinutes: remediateMinNoProgressMinutes,
          pauseOverCapTarget: remediatePauseOverCapTarget,
          resumed: remediateResult?.resumed ?? 0,
          paused: remediateResult?.paused ?? 0,
          requeued: remediateResult?.requeued ?? 0,
          errors: remediateResult?.errors ?? 0,
        });
      } catch (error) {
        actions.push({
          type: "remediate_error",
          threshold: stuckThreshold,
          processingNoProgress,
          message: error instanceof Error ? error.message : String(error),
        });
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

    const shouldRunCron = runCron && Date.now() - lastCronAt >= cronEveryMinutes * 60 * 1000;
    let cron = null;
    if (shouldRunCron) {
      cron = await requestJson(`/api/admin/catalog-refresh/cron?mode=${cronMode}`);
      lastCronAt = Date.now();
      actions.push({
        type: "cron",
        mode: cronMode,
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
    }

    const summary = state?.summary ?? {};
    const snapshot = {
      timestamp,
      baseUrl,
      cycle,
      intervalMinutes,
      summary: {
        freshBrands: Number(summary.freshBrands ?? 0),
        staleBrands: Number(summary.staleBrands ?? 0),
        processingRunsWithoutRecentProgress: Number(
          summary.processingRunsWithoutRecentProgress ?? 0,
        ),
        activeRunCount: Number(summary.activeRunCount ?? 0),
        activeRunCap: Number(summary.activeRunCap ?? 0),
      },
      queue: {
        waiting: Number(queueHealth?.queues?.catalog?.waiting ?? 0),
        active: Number(queueHealth?.queues?.catalog?.active ?? 0),
        delayed: Number(queueHealth?.queues?.catalog?.delayed ?? 0),
        waitingItemNotQueued,
        runsRunnableWithoutQueueLoad,
        activeZombieCriticalCount: zombieCriticalCount,
        activeHungDetected,
      },
      actions,
      cron,
      trend: previous
        ? {
            waitingDelta:
              Number(queueHealth?.queues?.catalog?.waiting ?? 0) -
              Number(previous.queue?.waiting ?? 0),
            freshBrandsDelta:
              Number(summary.freshBrands ?? 0) - Number(previous.summary?.freshBrands ?? 0),
            staleBrandsDelta:
              Number(summary.staleBrands ?? 0) - Number(previous.summary?.staleBrands ?? 0),
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
      `[${timestamp}] waiting=${snapshot.queue.waiting} active=${snapshot.queue.active} delayed=${snapshot.queue.delayed} fresh=${snapshot.summary.freshBrands} stale=${snapshot.summary.staleBrands} no_progress=${snapshot.summary.processingRunsWithoutRecentProgress} actions=${actions.length} ${trendSummary}\n`,
    );
    process.stdout.write(`  snapshot=${reportPath}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${timestamp}] monitor_error ${message}\n`);
  }

  if (iterations !== 0 && cycle >= iterations) break;
  await sleep(intervalMinutes * 60 * 1000);
}
