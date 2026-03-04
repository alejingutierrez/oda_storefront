import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readCatalogQueueDriftSummary } from "@/lib/catalog/queue-drift";
import {
  runCatalogRefreshStuckRemediation,
  type CatalogRefreshStuckRemediationStrategy,
} from "@/lib/catalog/refresh";
import { acquireLock, readKeyTtlSeconds, releaseLock, setKeyWithTtl } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 300;

const REMEDIATE_LOCK_TTL_MS = Math.max(
  1000,
  Number(process.env.CATALOG_REFRESH_REMEDIATE_LOCK_TTL_MS ?? 45_000),
);
const REMEDIATE_COOLDOWN_SECONDS = Math.max(
  1,
  Number(process.env.CATALOG_REFRESH_REMEDIATE_COOLDOWN_SECONDS ?? 180),
);
const REMEDIATE_PROGRESS_WINDOW_MINUTES = Math.max(
  5,
  Number(process.env.CATALOG_REFRESH_REMEDIATE_PROGRESS_WINDOW_MINUTES ?? 20),
);
const REMEDIATE_LOCK_KEY = "catalog:refresh:remediate:lock";
const REMEDIATE_COOLDOWN_KEY = "catalog:refresh:remediate:cooldown";

const parseBody = async (req: Request) => {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

const boolFromValue = (value: unknown) =>
  value === true || value === "true" || value === 1 || value === "1";

const parseOptionalNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseStrategy = (value: unknown): CatalogRefreshStuckRemediationStrategy => {
  if (typeof value !== "string") return "aggressive_tail_close";
  const normalized = value.trim().toLowerCase();
  if (normalized === "balanced") return "balanced";
  if (normalized === "safe_fast_high_progress") return "safe_fast_high_progress";
  return "aggressive_tail_close";
};

const computeNextEligibleAt = (ttlSeconds: number | null) => {
  if (!ttlSeconds || ttlSeconds <= 0) return null;
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
};

const readShouldRemediateByRealProgress = async () => {
  const cutoff = new Date(Date.now() - REMEDIATE_PROGRESS_WINDOW_MINUTES * 60 * 1000);
  const [completedRecent, drift] = await Promise.all([
    prisma.catalogItem.count({
      where: {
        status: "completed",
        completedAt: { gte: cutoff },
        run: { status: "processing" },
      },
    }),
    readCatalogQueueDriftSummary({
      sampleLimit: Math.max(
        100,
        Number(process.env.CATALOG_REFRESH_REMEDIATE_DRIFT_SAMPLE_LIMIT ?? 400),
      ),
    }),
  ]);
  const activeZombieCriticalCount = Number(
    (
      drift as {
        activeZombieCriticalCount?: number;
        activeZombieCount?: number;
      }
    ).activeZombieCriticalCount ??
      (
        drift as {
          activeZombieCount?: number;
        }
      ).activeZombieCount ??
      0,
  );
  const criticalDrift =
    drift.waitingItemNotQueued > 0 ||
    drift.waitingRunNotProcessing > 0 ||
    drift.waitingMissingItem > 0 ||
    activeZombieCriticalCount > 0 ||
    drift.activeHungDetected;
  return {
    shouldRun: completedRecent > 0 || criticalDrift,
    completedRecent,
    criticalDrift,
  };
};

const buildSkippedPayload = (
  skipReason: "locked" | "cooldown" | "no_work",
  nextEligibleAt: string | null,
  strategy: CatalogRefreshStuckRemediationStrategy,
) => ({
  attempted: false,
  dryRun: false,
  strategy,
  resumed: 0,
  paused: 0,
  requeued: 0,
  reconciled: false,
  errors: 0,
  forcedClosedRuns: 0,
  forcedFailedItems: 0,
  tailCandidates: 0,
  tailProcessedRuns: 0,
  highProgressCandidates: 0,
  highProgressProcessedRuns: 0,
  highProgressClosedRuns: 0,
  highProgressForcedFailedItems: 0,
  highProgressSampleRuns: [],
  runIds: [],
  skipped: true,
  skipReason,
  nextEligibleAt,
});

const shouldBypassGlobalGate = (
  strategy: CatalogRefreshStuckRemediationStrategy,
  runId?: string,
) => strategy === "safe_fast_high_progress" || Boolean(runId);

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await parseBody(req);
  const dryRun = body.dryRun === undefined ? true : boolFromValue(body.dryRun);
  const strategy = parseStrategy(body.strategy);
  const limit = parseOptionalNumber(body.limit);
  const minNoProgressMinutes = parseOptionalNumber(body.minNoProgressMinutes);
  const pauseOverCapTarget = parseOptionalNumber(body.pauseOverCapTarget);
  const tailProgressPct = parseOptionalNumber(body.tailProgressPct);
  const tailMaxRemaining = parseOptionalNumber(body.tailMaxRemaining);
  const tailStaleMinutes = parseOptionalNumber(body.tailStaleMinutes);
  const highProgressMinPct = parseOptionalNumber(body.highProgressMinPct);
  const highProgressMaxPending = parseOptionalNumber(body.highProgressMaxPending);
  const highProgressNoProgressMinutes = parseOptionalNumber(body.highProgressNoProgressMinutes);
  const forceTerminalizeRemaining =
    body.forceTerminalizeRemaining === undefined
      ? undefined
      : boolFromValue(body.forceTerminalizeRemaining);
  const runId = typeof body.runId === "string" ? body.runId : undefined;
  const bypassGlobalGate = shouldBypassGlobalGate(strategy, runId);

  if (dryRun) {
    try {
      const result = await runCatalogRefreshStuckRemediation({
        dryRun,
        strategy,
        limit,
        minNoProgressMinutes,
        pauseOverCapTarget,
        tailProgressPct,
        tailMaxRemaining,
        tailStaleMinutes,
        highProgressMinPct,
        highProgressMaxPending,
        highProgressNoProgressMinutes,
        forceTerminalizeRemaining,
        runId,
      });
      return NextResponse.json({
        ...result,
        skipped: false,
        skipReason: null,
        nextEligibleAt: null,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "unknown_error" },
        { status: 500 },
      );
    }
  }

  if (!bypassGlobalGate) {
    const cooldownTtl = await readKeyTtlSeconds(REMEDIATE_COOLDOWN_KEY);
    if (cooldownTtl && cooldownTtl > 0) {
      return NextResponse.json(
        buildSkippedPayload("cooldown", computeNextEligibleAt(cooldownTtl), strategy),
      );
    }
  }

  const lock = await acquireLock(REMEDIATE_LOCK_KEY, REMEDIATE_LOCK_TTL_MS);
  if (!lock) {
    const lockTtl = await readKeyTtlSeconds(REMEDIATE_LOCK_KEY);
    return NextResponse.json(
      buildSkippedPayload("locked", computeNextEligibleAt(lockTtl), strategy),
    );
  }

  try {
    if (!bypassGlobalGate) {
      const progressGate = await readShouldRemediateByRealProgress();
      if (!progressGate.shouldRun) {
        await setKeyWithTtl(REMEDIATE_COOLDOWN_KEY, "no_work", REMEDIATE_COOLDOWN_SECONDS);
        return NextResponse.json(
          buildSkippedPayload(
            "no_work",
            computeNextEligibleAt(REMEDIATE_COOLDOWN_SECONDS),
            strategy,
          ),
        );
      }
    }

    const result = await runCatalogRefreshStuckRemediation({
      dryRun: false,
      strategy,
      limit,
      minNoProgressMinutes,
      pauseOverCapTarget,
      tailProgressPct,
      tailMaxRemaining,
      tailStaleMinutes,
      highProgressMinPct,
      highProgressMaxPending,
      highProgressNoProgressMinutes,
      forceTerminalizeRemaining,
      runId,
    });
    if (!bypassGlobalGate) {
      await setKeyWithTtl(REMEDIATE_COOLDOWN_KEY, "applied", REMEDIATE_COOLDOWN_SECONDS);
    }
    return NextResponse.json({
      ...result,
      skipped: false,
      skipReason: null,
      nextEligibleAt: bypassGlobalGate
        ? null
        : computeNextEligibleAt(REMEDIATE_COOLDOWN_SECONDS),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  } finally {
    await releaseLock(lock);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
