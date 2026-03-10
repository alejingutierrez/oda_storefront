import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { validateCronOrAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetQueuedItems, resetStuckItems } from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";
import {
  finalizeRefreshForRun,
  runCatalogRefreshStuckRemediation,
} from "@/lib/catalog/refresh";
import { isCatalogQueueEnabled } from "@/lib/catalog/queue";
import { isRedisEnabled, readHeartbeat, tryAcquireLock } from "@/lib/redis";

const readBrandMetadata = (brand: { metadata?: unknown }) =>
  brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
    ? (brand.metadata as Record<string, unknown>)
    : {};

const finalizeRunIfIdle = async (runId: string) => {
  const remaining = await prisma.catalogItem.findFirst({
    where: {
      runId,
      status: { in: ["pending", "queued", "in_progress", "failed"] },
      attempts: { lt: CATALOG_MAX_ATTEMPTS },
    },
    select: { id: true },
  });
  if (remaining) return { finalized: false, forcedClosed: false, forcedFailedItems: 0 };

  const run = await prisma.catalogRun.findUnique({
    where: { id: runId },
    include: { brand: true },
  });
  if (!run || run.status === "completed" || run.status === "failed") {
    return { finalized: false, forcedClosed: false, forcedFailedItems: 0 };
  }

  await prisma.catalogRun.update({
    where: { id: runId },
    data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
  });

  const failedCount = await prisma.catalogItem.count({
    where: { runId, status: "failed" },
  });
  await finalizeRefreshForRun({
    brandId: run.brand.id,
    runId: run.id,
    startedAt: run.startedAt,
  });
  if (failedCount > 0 || !run.brand) {
    return { finalized: true, forcedClosed: true, forcedFailedItems: 0 };
  }

  const metadata = readBrandMetadata(run.brand);
  if (metadata.catalog_extract_finished) {
    return { finalized: true, forcedClosed: true, forcedFailedItems: 0 };
  }

  const nextMetadata = { ...metadata };
  delete nextMetadata.catalog_extract;
  nextMetadata.catalog_extract_finished = {
    finishedAt: new Date().toISOString(),
    reason: "auto_complete_idle",
    runId: run.id,
    platform: run.platform ?? run.brand.ecommercePlatform ?? null,
    totalItems: run.totalItems ?? null,
    failedItems: failedCount,
  };
  await prisma.brand.update({
    where: { id: run.brand.id },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });
  return { finalized: true, forcedClosed: true, forcedFailedItems: 0 };
};

export const runtime = "nodejs";
export const maxDuration = 300;

const queueConnection = { url: process.env.REDIS_URL ?? "" };
const catalogQueueName = process.env.CATALOG_QUEUE_NAME ?? "catalog";
const workerNoProgressSeconds = Math.max(
  60,
  Number(process.env.WORKER_NO_PROGRESS_SECONDS ?? 300),
);

const readCatalogQueueCounts = async () => {
  const queue = new Queue(catalogQueueName, { connection: queueConnection });
  try {
    return await queue.getJobCounts("waiting", "active", "delayed");
  } finally {
    await queue.close().catch(() => null);
  }
};

const readCatalogLastCompletedAt = (heartbeat: {
  payload?: { lastCompletedAt?: Record<string, string | null | undefined> | undefined } | null;
}) => {
  const value = heartbeat.payload?.lastCompletedAt?.catalog;
  return typeof value === "string" ? value : null;
};

const hasCatalogRunnableInDb = async () => {
  const row = await prisma.catalogItem.findFirst({
    where: {
      run: { status: "processing" },
      status: { in: ["pending", "queued", "failed"] },
      attempts: { lt: CATALOG_MAX_ATTEMPTS },
    },
    select: { id: true },
  });
  return Boolean(row);
};

const evaluateCatalogWorkerGate = async (heartbeat: {
  online: boolean;
  ttlSeconds: number | null;
  payload?: { lastCompletedAt?: Record<string, string | null | undefined> | undefined } | null;
}) => {
  if (!heartbeat.online) {
    return {
      skipDrain: false,
      meta: { reason: "worker_offline", heartbeat },
    };
  }

  try {
    const counts = await readCatalogQueueCounts();
    const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    const active = counts.active ?? 0;
    const lastCompletedAt = readCatalogLastCompletedAt(heartbeat);
    const lastCompletedMs = lastCompletedAt ? Date.parse(lastCompletedAt) : Number.NaN;
    const noRecentProgress =
      !Number.isFinite(lastCompletedMs) ||
      Date.now() - lastCompletedMs > workerNoProgressSeconds * 1000;

    if (backlog === 0 && active === 0) {
      const dbRunnable = await hasCatalogRunnableInDb();
      if (dbRunnable) {
        return {
          skipDrain: false,
          meta: {
            reason: "worker_queue_empty_db_runnable",
            heartbeat,
            queue: {
              name: catalogQueueName,
              waiting: counts.waiting ?? 0,
              delayed: counts.delayed ?? 0,
              active: counts.active ?? 0,
              backlog,
              dbRunnable,
              lastCompletedAt,
              noRecentProgress,
              maxNoProgressSeconds: workerNoProgressSeconds,
            },
          },
        };
      }
    }

    const staleNoProgress = (backlog > 0 || active > 0) && noRecentProgress;
    if (staleNoProgress) {
      return {
        skipDrain: false,
        meta: {
          reason: "worker_stale_no_progress",
          heartbeat,
          queue: {
            name: catalogQueueName,
            waiting: counts.waiting ?? 0,
            delayed: counts.delayed ?? 0,
            active: counts.active ?? 0,
            backlog,
            lastCompletedAt,
            noRecentProgress,
            dbRunnable: false,
            maxNoProgressSeconds: workerNoProgressSeconds,
          },
        },
      };
    }
    return {
      skipDrain: true,
      meta: {
        reason: "worker_online",
        heartbeat,
        queue: {
          name: catalogQueueName,
          waiting: counts.waiting ?? 0,
          delayed: counts.delayed ?? 0,
          active: counts.active ?? 0,
          backlog,
          lastCompletedAt,
          noRecentProgress,
          dbRunnable: false,
          maxNoProgressSeconds: workerNoProgressSeconds,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Conservative behavior: if queue probe fails but worker heartbeat exists, do not race the worker.
    return {
      skipDrain: true,
      meta: {
        reason: "worker_online_queue_probe_failed",
        heartbeat,
        queueError: message,
      },
    };
  }
};

const boolFromValue = (value: unknown, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
};

const resolveDrainConfig = (body: unknown) => {
  const payload =
    body && typeof body === "object" ? (body as Record<string, unknown>) : ({} as Record<string, unknown>);
  const requestedBatch = Number(payload.drainBatch ?? payload.batch ?? payload.limit);
  const requestedConcurrency = Number(payload.drainConcurrency ?? payload.concurrency ?? payload.workers);
  const requestedMaxMs = Number(payload.drainMaxMs ?? payload.maxMs ?? payload.timeoutMs);
  const requestedMaxRuns = Number(payload.drainMaxRuns ?? payload.maxRuns);
  const batchDefault = Number(process.env.CATALOG_DRAIN_BATCH ?? 0);
  const concurrencyDefault = Number(process.env.CATALOG_DRAIN_CONCURRENCY ?? 5);
  const maxMsDefault = Number(process.env.CATALOG_DRAIN_MAX_RUNTIME_MS ?? 20000);
  const maxRunsDefault = Number(process.env.CATALOG_DRAIN_MAX_RUNS ?? 3);
  const batch = Number.isFinite(requestedBatch) ? requestedBatch : batchDefault;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? requestedConcurrency
    : concurrencyDefault;
  const maxMs = Number.isFinite(requestedMaxMs) ? requestedMaxMs : maxMsDefault;
  const maxRuns = Number.isFinite(requestedMaxRuns) ? requestedMaxRuns : maxRunsDefault;
  const dryRun = boolFromValue(payload.dryRun, false);
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );
  return { batch, concurrency, maxMs, maxRuns, queuedStaleMs, stuckMs, dryRun };
};

export async function POST(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isCron = auth.source === "cron-secret";

  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const brandId = typeof body?.brandId === "string" ? body.brandId : url.searchParams.get("brandId");
  const requestedRunId =
    typeof body?.runId === "string" ? body.runId : url.searchParams.get("runId");
  const dryRun = boolFromValue(url.searchParams.get("dryRun"), boolFromValue(body?.dryRun, false));
  const force = url.searchParams.get("force") === "true" || body?.force === true;
  const highProgressCloseEnabled = boolFromValue(
    body?.highProgressCloseEnabled ?? body?.aggressiveTailCloseEnabled,
    true,
  );
  const highProgressMinPct = Math.max(
    50,
    Math.min(
      100,
      Number(
        body?.highProgressMinPct ??
          body?.tailProgressPct ??
          process.env.CATALOG_REFRESH_HIGH_PROGRESS_MIN_PCT ??
          95,
      ),
    ),
  );
  const highProgressMaxPending = Math.max(
    0,
    Number(
      body?.highProgressMaxPending ??
        body?.tailMaxRemaining ??
        process.env.CATALOG_REFRESH_HIGH_PROGRESS_MAX_PENDING ??
        10,
    ),
  );
  const highProgressNoProgressMinutes = Math.max(
    1,
    Number(
      body?.highProgressNoProgressMinutes ??
        body?.tailStaleMinutes ??
        process.env.CATALOG_REFRESH_HIGH_PROGRESS_NO_PROGRESS_MINUTES ??
        5,
    ),
  );
  const forceTerminalizeRemaining = boolFromValue(
    body?.forceTerminalizeRemaining,
    (process.env.CATALOG_REFRESH_HIGH_PROGRESS_FORCE_TERMINALIZE_REMAINING ?? "true")
      .trim()
      .toLowerCase() !== "false",
  );
  // RC-8: Early exit when no processing runs exist (saves Redis/BullMQ/Prisma probes)
  if (isCron && !force && !dryRun) {
    const processingCount = await prisma.catalogRun.count({
      where: { status: "processing" },
    });
    if (processingCount === 0) {
      return NextResponse.json({ skipped: "no_processing_runs", processingCount: 0 });
    }
  }

  let workerGate: Record<string, unknown> | null = null;
  let microDrainBypass = false;

  if (!force && isCatalogQueueEnabled()) {
    const heartbeat = await readHeartbeat("workers:catalog:alive");
    const gate = await evaluateCatalogWorkerGate(heartbeat);
    workerGate = gate.meta;
    if (isCron) {
      console.log(JSON.stringify({
        event: "catalog_drain_decision",
        skipDrain: gate.skipDrain,
        reason: (gate.meta as Record<string, unknown>).reason ?? null,
        workerOnline: heartbeat.online,
        queueWaiting: (gate.meta as Record<string, unknown>).queue
          ? ((gate.meta as Record<string, unknown>).queue as Record<string, unknown>).waiting ?? null
          : null,
        queueActive: (gate.meta as Record<string, unknown>).queue
          ? ((gate.meta as Record<string, unknown>).queue as Record<string, unknown>).active ?? null
          : null,
        lastCompletedAt: (gate.meta as Record<string, unknown>).queue
          ? ((gate.meta as Record<string, unknown>).queue as Record<string, unknown>).lastCompletedAt ?? null
          : null,
        noRecentProgress: (gate.meta as Record<string, unknown>).queue
          ? ((gate.meta as Record<string, unknown>).queue as Record<string, unknown>).noRecentProgress ?? null
          : null,
      }));
    }
    if (gate.skipDrain) {
      if (isCron && !dryRun) {
        microDrainBypass = true;
        workerGate = {
          ...(gate.meta ?? {}),
          reason: "worker_online_cron_micro_drain",
          microDrainBypass: true,
        };
      } else {
        return NextResponse.json({ skipped: "worker_online", ...gate.meta });
      }
    }
  }

  const resolved = resolveDrainConfig(body);
  let batch = resolved.batch;
  let concurrency = resolved.concurrency;
  let maxMs = resolved.maxMs;
  let maxRuns = resolved.maxRuns;
  const queuedStaleMs = resolved.queuedStaleMs;
  const stuckMs = resolved.stuckMs;

  const isWorkerStale =
    workerGate &&
    typeof workerGate === "object" &&
    "reason" in workerGate &&
    (workerGate.reason === "worker_stale_no_progress" ||
      workerGate.reason === "worker_offline" ||
      workerGate.reason === "worker_queue_empty_db_runnable");

  if (isWorkerStale && !microDrainBypass) {
    concurrency = Math.max(concurrency, 10);
    maxMs = Math.max(maxMs, 50000);
    maxRuns = Math.max(maxRuns, 3);
  }

  if (microDrainBypass) {
    const microBatchCap = Math.max(1, Number(process.env.CATALOG_DRAIN_CRON_MICRO_BATCH ?? 8));
    const microConcurrencyCap = Math.max(
      1,
      Number(process.env.CATALOG_DRAIN_CRON_MICRO_CONCURRENCY ?? 2),
    );
    const microMaxRunsCap = Math.max(1, Number(process.env.CATALOG_DRAIN_CRON_MICRO_MAX_RUNS ?? 1));
    const microMaxMsCap = Math.max(2000, Number(process.env.CATALOG_DRAIN_CRON_MICRO_MAX_MS ?? 12000));
    batch = batch <= 0 ? microBatchCap : Math.min(Math.max(1, batch), microBatchCap);
    concurrency = Math.min(Math.max(1, concurrency), microConcurrencyCap);
    maxRuns = Math.min(Math.max(1, maxRuns), microMaxRunsCap);
    maxMs = Math.min(Math.max(2000, maxMs), microMaxMsCap);
  }

  const startedAt = Date.now();
  let processed = 0;
  let runsProcessed = 0;
  let finalizedRuns = 0;
  let forcedClosedRuns = 0;
  let forcedFailedItems = 0;
  let highProgressProcessedRuns = 0;
  let lastResult: unknown = null;
  const seenRunIds = new Set<string>();

  const safeBatch = batch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, batch);
  const safeConcurrency = Math.max(1, concurrency);
  const safeMaxMs = Math.max(2000, maxMs);
  const safeMaxRuns = Math.max(1, maxRuns);
  const deadline = startedAt + safeMaxMs;

  if (!dryRun && isCatalogQueueEnabled() && isRedisEnabled()) {
    const lockTtlMs = Math.max(5000, safeMaxMs + 5000);
    const lockScope = requestedRunId
      ? `run:${requestedRunId}`
      : brandId
        ? `brand:${brandId}`
        : "all";
    const lockKey = `catalog:drain:route:lock:${lockScope}`;
    const acquired = await tryAcquireLock(lockKey, lockTtlMs);
    if (!acquired) {
      return NextResponse.json(
        {
          skipped: "drain_locked",
          lockKey,
          lockTtlMs,
          workerGate,
        },
        { status: 409 },
      );
    }
  }

  while (
    processed < safeBatch &&
    runsProcessed < safeMaxRuns &&
    Date.now() < deadline
  ) {
    const run = await prisma.catalogRun.findFirst({
      where: {
        status: "processing",
        ...(brandId ? { brandId } : {}),
        ...(requestedRunId ? { id: requestedRunId } : {}),
        ...(seenRunIds.size ? { id: { notIn: Array.from(seenRunIds) } } : {}),
      },
      orderBy: { updatedAt: "asc" },
    });
    if (!run) break;

    const currentRunId = run.id;
    seenRunIds.add(currentRunId);
    runsProcessed += 1;

    if (dryRun) {
      const remainingBatch =
        safeBatch === Number.MAX_SAFE_INTEGER ? safeBatch : Math.max(1, safeBatch - processed);
      lastResult = {
        dryRun: true,
        runId: currentRunId,
        wouldDrainBatch: remainingBatch,
        wouldDrainConcurrency: safeConcurrency,
      };
      if (brandId || requestedRunId) break;
      continue;
    }

    await resetQueuedItems(currentRunId, queuedStaleMs);
    await resetStuckItems(currentRunId, stuckMs);
    const remainingBatch =
      safeBatch === Number.MAX_SAFE_INTEGER ? safeBatch : Math.max(1, safeBatch - processed);
    const remainingMs = Math.max(2000, deadline - Date.now());
    lastResult = await drainCatalogRun({
      runId: currentRunId,
      batch: remainingBatch,
      concurrency: safeConcurrency,
      maxMs: remainingMs,
      queuedStaleMs,
      stuckMs,
    });
    const finalized = await finalizeRunIfIdle(currentRunId);
    if (finalized.finalized) {
      finalizedRuns += 1;
      if (finalized.forcedClosed) forcedClosedRuns += 1;
      forcedFailedItems += finalized.forcedFailedItems;
    } else if (highProgressCloseEnabled) {
      const highProgressResult = await runCatalogRefreshStuckRemediation({
        dryRun: false,
        strategy: "safe_fast_high_progress",
        limit: 1,
        highProgressMinPct,
        highProgressMaxPending,
        highProgressNoProgressMinutes,
        forceTerminalizeRemaining,
        runId: currentRunId,
        pauseOverCapEnabled: false,
        queueEnabled: isCatalogQueueEnabled(),
      });
      highProgressProcessedRuns += highProgressResult.highProgressProcessedRuns;
      forcedClosedRuns += highProgressResult.highProgressClosedRuns;
      forcedFailedItems += highProgressResult.highProgressForcedFailedItems;
    }
    processed += (lastResult as { processed?: number })?.processed ?? 0;

    if (brandId || requestedRunId) break;
    if (processed >= safeBatch && safeBatch !== Number.MAX_SAFE_INTEGER) break;
  }

  if (isCron) {
    console.log(JSON.stringify({
      event: "catalog_drain_result",
      processed,
      runsProcessed,
      finalizedRuns,
      microDrainBypass,
      isWorkerStale,
      concurrency: safeConcurrency,
      maxMs: safeMaxMs,
      elapsedMs: Date.now() - startedAt,
    }));
  }

  return NextResponse.json({
    dryRun,
    processed,
    runsProcessed,
    finalizedRuns,
    forcedClosedRuns,
    forcedFailedItems,
    highProgressProcessedRuns,
    microDrainBypass,
    lastResult,
    workerGate,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
