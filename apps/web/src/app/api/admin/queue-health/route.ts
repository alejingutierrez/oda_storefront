import { NextResponse } from "next/server";
import { Queue } from "bullmq";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readCatalogQueueDriftSummary } from "@/lib/catalog/queue-drift";
import { isRedisEnabled, readHeartbeat } from "@/lib/redis";

export const runtime = "nodejs";

const connection = { url: process.env.REDIS_URL ?? "" };

const queueNames = {
  catalog: process.env.CATALOG_QUEUE_NAME ?? "catalog",
  enrichment: process.env.PRODUCT_ENRICHMENT_QUEUE_NAME ?? "product-enrichment",
  plpSeo: process.env.PLP_SEO_QUEUE_NAME ?? "plp-seo",
};
const workerNoProgressSeconds = Math.max(
  60,
  Number(process.env.WORKER_NO_PROGRESS_SECONDS ?? 300),
);
const activeHungMinutes = Math.max(
  5,
  Number(process.env.WORKER_ACTIVE_HUNG_MINUTES ?? 15),
);
const activeSampleLimit = Math.max(
  10,
  Number(process.env.WORKER_ACTIVE_SAMPLE_LIMIT ?? 200),
);

const readQueueCounts = async (name: string) => {
  const queue = new Queue(name, { connection });
  try {
    return await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
    );
  } finally {
    await queue.close().catch(() => null);
  }
};

const readActiveHang = async (name: string) => {
  const queue = new Queue(name, { connection });
  try {
    const jobs = await queue.getJobs(["active"], 0, Math.max(0, activeSampleLimit - 1), true);
    const now = Date.now();
    const thresholdMs = activeHungMinutes * 60 * 1000;
    let hungCount = 0;
    let oldestActiveMs = 0;
    let oldestProcessedOn: string | null = null;

    for (const job of jobs) {
      const processedOn = typeof job.processedOn === "number" ? job.processedOn : null;
      if (!processedOn) continue;
      const ageMs = Math.max(0, now - processedOn);
      if (ageMs >= thresholdMs) hungCount += 1;
      if (ageMs > oldestActiveMs) {
        oldestActiveMs = ageMs;
        oldestProcessedOn = new Date(processedOn).toISOString();
      }
    }

    return {
      sampleSize: jobs.length,
      hungThresholdMinutes: activeHungMinutes,
      hungCount,
      oldestActiveMs,
      oldestProcessedOn,
    };
  } finally {
    await queue.close().catch(() => null);
  }
};

const catalogMaxAttempts = Math.max(1, Number(process.env.CATALOG_MAX_ATTEMPTS ?? 3));
const enrichmentMaxAttempts = Math.max(
  1,
  Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 5),
);

const readDbRunnableFlags = async () => {
  const [catalogRow, enrichRow] = await Promise.all([
    prisma.catalogItem.findFirst({
      where: {
        run: { status: "processing" },
        status: { in: ["pending", "queued", "failed"] },
        attempts: { lt: catalogMaxAttempts },
      },
      select: { id: true },
    }),
    prisma.productEnrichmentItem.findFirst({
      where: {
        run: { status: "processing" },
        status: { in: ["pending", "queued", "failed"] },
        attempts: { lt: enrichmentMaxAttempts },
      },
      select: { id: true },
    }),
  ]);
  return {
    catalogDbRunnable: Boolean(catalogRow),
    enrichDbRunnable: Boolean(enrichRow),
  };
};

const buildWorkerStatus = ({
  workerKey,
  heartbeat,
  counts,
  dbRunnable,
}: {
  workerKey: "catalog" | "enrich";
  heartbeat: {
    online: boolean;
    ttlSeconds: number | null;
    payload?: { lastCompletedAt?: Record<string, string | null | undefined> | undefined } | null;
  };
  counts: {
    waiting?: number;
    active?: number;
    delayed?: number;
  };
  dbRunnable: boolean;
}) => {
  const lastCompletedAtValue = heartbeat.payload?.lastCompletedAt?.[workerKey];
  const lastCompletedAt =
    typeof lastCompletedAtValue === "string" ? lastCompletedAtValue : null;
  const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0);
  const active = counts.active ?? 0;
  const lastCompletedMs = lastCompletedAt ? Date.parse(lastCompletedAt) : Number.NaN;
  const noRecentProgress =
    !Number.isFinite(lastCompletedMs) ||
    Date.now() - lastCompletedMs > workerNoProgressSeconds * 1000;
  const staleNoProgress = heartbeat.online && backlog > 0 && active === 0 && noRecentProgress;
  const queueEmptyButDbRunnable = heartbeat.online && backlog === 0 && active === 0 && dbRunnable;
  return {
    online: heartbeat.online,
    ttlSeconds: heartbeat.ttlSeconds,
    lastCompletedAt,
    backlog,
    active,
    dbRunnable,
    noRecentProgress,
    staleNoProgress,
    queueEmptyButDbRunnable,
    maxNoProgressSeconds: workerNoProgressSeconds,
  };
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const redisEnabled = isRedisEnabled();
  const now = new Date().toISOString();

  if (!redisEnabled) {
    return NextResponse.json({
      ok: true,
      now,
      redisEnabled: false,
      workerAlive: {
        catalog: { online: false, ttlSeconds: null },
        enrich: { online: false, ttlSeconds: null },
      },
      flags: {
        heartbeatMissing: false,
        activeHung: false,
        queueDriftDetected: false,
        aggressiveRecoveryRequired: false,
      },
      queues: null,
    });
  }

  const [catalogAlive, enrichAlive, catalogCounts, enrichCounts, plpCounts, catalogHang, enrichHang, drift, dbFlags] = await Promise.all([
    readHeartbeat("workers:catalog:alive"),
    readHeartbeat("workers:enrich:alive"),
    readQueueCounts(queueNames.catalog),
    readQueueCounts(queueNames.enrichment),
    readQueueCounts(queueNames.plpSeo),
    readActiveHang(queueNames.catalog),
    readActiveHang(queueNames.enrichment),
    readCatalogQueueDriftSummary({
      sampleLimit: Math.max(
        100,
        Number(process.env.CATALOG_QUEUE_DRIFT_SAMPLE_LIMIT ?? 500),
      ),
      activeHungMinutes,
    }),
    readDbRunnableFlags(),
  ]);
  const workerStatus = {
    catalog: buildWorkerStatus({
      workerKey: "catalog",
      heartbeat: catalogAlive,
      counts: catalogCounts,
      dbRunnable: dbFlags.catalogDbRunnable,
    }),
    enrich: buildWorkerStatus({
      workerKey: "enrich",
      heartbeat: enrichAlive,
      counts: enrichCounts,
      dbRunnable: dbFlags.enrichDbRunnable,
    }),
  };
  const catalogBacklog = (catalogCounts.waiting ?? 0) + (catalogCounts.active ?? 0) + (catalogCounts.delayed ?? 0);
  const enrichBacklog = (enrichCounts.waiting ?? 0) + (enrichCounts.active ?? 0) + (enrichCounts.delayed ?? 0);
  const heartbeatMissing =
    (catalogBacklog > 0 && !catalogAlive.online) || (enrichBacklog > 0 && !enrichAlive.online);
  const activeHung =
    catalogHang.hungCount > 0 ||
    enrichHang.hungCount > 0 ||
    drift.activeHungDetected ||
    drift.activeZombieCount > 0;
  const queueDriftDetected = drift.driftDetected;
  const aggressiveRecoveryRequired = drift.aggressiveRequired;
  const aggressiveRecoveryReason = drift.aggressiveReason;
  const zombieByDbState = {
    completed: drift.activeZombieByReason.item_completed ?? 0,
    failed_terminal: drift.activeZombieByReason.item_terminal_failed ?? 0,
    run_not_processing: drift.activeZombieByReason.run_not_processing ?? 0,
    item_not_in_progress: drift.activeZombieByReason.item_not_in_progress ?? 0,
    missing_item: drift.activeZombieByReason.missing_item ?? 0,
  };

  return NextResponse.json({
    ok: true,
    now,
    redisEnabled: true,
    queueNames,
    workerAlive: { catalog: catalogAlive, enrich: enrichAlive },
    flags: {
      heartbeatMissing,
      activeHung,
      queueDriftDetected,
      aggressiveRecoveryRequired,
    },
    activeHang: {
      catalog: {
        ...catalogHang,
        zombieCount: drift.activeZombieCount,
        zombieByReason: drift.activeZombieByReason,
        zombieByDbState,
        driftHungCount: drift.activeHungCount,
        aggressiveRecoveryRequired,
        aggressiveRecoveryReason,
      },
      enrich: enrichHang,
    },
    drift,
    workerStatus,
    queues: {
      catalog: catalogCounts,
      enrichment: enrichCounts,
      plpSeo: plpCounts,
    },
  });
}
