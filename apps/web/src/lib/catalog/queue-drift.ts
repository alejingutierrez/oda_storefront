import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";
import { topUpCatalogRunQueue } from "@/lib/catalog/queue-control";
import { isRedisEnabled } from "@/lib/redis";

const catalogQueueName = process.env.CATALOG_QUEUE_NAME ?? "catalog";
const connection = { url: process.env.REDIS_URL ?? "" };

const driftSampleLimitDefault = Math.max(
  100,
  Number(process.env.CATALOG_QUEUE_DRIFT_SAMPLE_LIMIT ?? 500),
);
const reconcileJobScanLimitDefault = Math.max(
  driftSampleLimitDefault,
  Number(process.env.CATALOG_RECONCILE_JOB_SCAN_LIMIT ?? 2000),
);
const reconcileReenqueueLimitDefault = Math.max(
  50,
  Number(process.env.CATALOG_RECONCILE_REENQUEUE_LIMIT ?? 500),
);
const reconcileMaxRunsDefault = Math.max(
  1,
  Number(process.env.CATALOG_RECONCILE_MAX_RUNS ?? 50),
);

type CatalogItemLite = {
  id: string;
  status: string;
  attempts: number;
  runId: string;
  run: { status: string; brandId: string };
};

type DriftFilter = {
  brandId?: string | null;
  runId?: string | null;
};

const matchesFilter = (item: CatalogItemLite, filter: DriftFilter) => {
  if (filter.runId && item.runId !== filter.runId) return false;
  if (filter.brandId && item.run.brandId !== filter.brandId) return false;
  return true;
};

const getQueue = () => new Queue(catalogQueueName, { connection });

const readWaitingJobs = async (queue: Queue, limit: number) => {
  if (limit <= 0) return [];
  return queue.getJobs(["waiting"], 0, Math.max(0, limit - 1), true);
};

const readDelayedJobs = async (queue: Queue, limit: number) => {
  if (limit <= 0) return [];
  return queue.getJobs(["delayed"], 0, Math.max(0, limit - 1), true);
};

const loadCatalogItemsByIds = async (itemIds: string[]) => {
  if (!itemIds.length) return new Map<string, CatalogItemLite>();
  const rows = await prisma.catalogItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      status: true,
      attempts: true,
      runId: true,
      run: { select: { status: true, brandId: true } },
    },
  });
  return new Map(rows.map((row) => [row.id, row]));
};

const readRunsRunnableWithoutQueueLoad = async (filter: DriftFilter) => {
  const runFilters: Prisma.Sql[] = [Prisma.sql`cr.status = 'processing'`];
  if (filter.runId) runFilters.push(Prisma.sql`cr.id = ${filter.runId}`);
  if (filter.brandId) runFilters.push(Prisma.sql`cr."brandId" = ${filter.brandId}`);
  const whereRuns = Prisma.join(runFilters, " AND ");

  const [countRow] = await prisma.$queryRaw<{ count: number }[]>(
    Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "catalog_runs" cr
      WHERE ${whereRuns}
        AND EXISTS (
          SELECT 1
          FROM "catalog_items" ci
          WHERE ci."runId" = cr.id
            AND ci.status IN ('pending', 'failed', 'queued')
            AND ci.attempts < ${CATALOG_MAX_ATTEMPTS}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "catalog_items" ci
          WHERE ci."runId" = cr.id
            AND ci.status IN ('queued', 'in_progress')
            AND ci.attempts < ${CATALOG_MAX_ATTEMPTS}
        )
    `,
  );

  const sample = await prisma.$queryRaw<Array<{ runId: string; brandId: string }>>(
    Prisma.sql`
      SELECT cr.id AS "runId", cr."brandId" AS "brandId"
      FROM "catalog_runs" cr
      WHERE ${whereRuns}
        AND EXISTS (
          SELECT 1
          FROM "catalog_items" ci
          WHERE ci."runId" = cr.id
            AND ci.status IN ('pending', 'failed', 'queued')
            AND ci.attempts < ${CATALOG_MAX_ATTEMPTS}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "catalog_items" ci
          WHERE ci."runId" = cr.id
            AND ci.status IN ('queued', 'in_progress')
            AND ci.attempts < ${CATALOG_MAX_ATTEMPTS}
        )
      ORDER BY cr."updatedAt" ASC
      LIMIT 20
    `,
  );

  return {
    count: countRow?.count ?? 0,
    sample,
  };
};

export type CatalogQueueDriftSummary = {
  queueName: string;
  waiting: number;
  active: number;
  delayed: number;
  waitingSampleSize: number;
  waitingSampleFilteredOut: number;
  waitingMissingItem: number;
  waitingItemNotQueued: number;
  waitingRunNotProcessing: number;
  runsRunnableWithoutQueueLoad: number;
  runsRunnableWithoutQueueLoadSample: Array<{ runId: string; brandId: string }>;
  driftDetected: boolean;
};

export const readCatalogQueueDriftSummary = async (params: {
  sampleLimit?: number;
  brandId?: string | null;
  runId?: string | null;
} = {}): Promise<CatalogQueueDriftSummary> => {
  if (!isRedisEnabled()) {
    return {
      queueName: catalogQueueName,
      waiting: 0,
      active: 0,
      delayed: 0,
      waitingSampleSize: 0,
      waitingSampleFilteredOut: 0,
      waitingMissingItem: 0,
      waitingItemNotQueued: 0,
      waitingRunNotProcessing: 0,
      runsRunnableWithoutQueueLoad: 0,
      runsRunnableWithoutQueueLoadSample: [],
      driftDetected: false,
    };
  }
  const sampleLimit = Math.max(10, params.sampleLimit ?? driftSampleLimitDefault);
  const queue = getQueue();
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed");
    const waitingJobs = await readWaitingJobs(queue, sampleLimit);
    const waitingIds = Array.from(
      new Set(
        waitingJobs
          .map((job) => (typeof job.data?.itemId === "string" ? job.data.itemId : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const itemsById = await loadCatalogItemsByIds(waitingIds);

    let waitingSampleFilteredOut = 0;
    let waitingMissingItem = 0;
    let waitingItemNotQueued = 0;
    let waitingRunNotProcessing = 0;

    waitingJobs.forEach((job) => {
      const itemId = typeof job.data?.itemId === "string" ? job.data.itemId : null;
      if (!itemId) return;
      const item = itemsById.get(itemId);
      if (!item) {
        waitingMissingItem += 1;
        return;
      }
      if (!matchesFilter(item, { brandId: params.brandId, runId: params.runId })) {
        waitingSampleFilteredOut += 1;
        return;
      }
      if (item.status !== "queued") waitingItemNotQueued += 1;
      if (item.run.status !== "processing") waitingRunNotProcessing += 1;
    });

    const runsWithoutQueue = await readRunsRunnableWithoutQueueLoad({
      brandId: params.brandId,
      runId: params.runId,
    });

    const driftDetected =
      waitingMissingItem > 0 ||
      waitingItemNotQueued > 0 ||
      waitingRunNotProcessing > 0 ||
      runsWithoutQueue.count > 0;

    return {
      queueName: catalogQueueName,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      waitingSampleSize: waitingJobs.length,
      waitingSampleFilteredOut,
      waitingMissingItem,
      waitingItemNotQueued,
      waitingRunNotProcessing,
      runsRunnableWithoutQueueLoad: runsWithoutQueue.count,
      runsRunnableWithoutQueueLoadSample: runsWithoutQueue.sample,
      driftDetected,
    };
  } finally {
    await queue.close().catch(() => null);
  }
};

type ReconcileParams = {
  brandId?: string | null;
  runId?: string | null;
  dryRun?: boolean;
  jobScanLimit?: number;
  reenqueueLimit?: number;
};

export type CatalogQueueReconcileResult = {
  queueName: string;
  dryRun: boolean;
  scannedJobs: number;
  removedJobs: number;
  removedByReason: Record<string, number>;
  normalizedToQueued: number;
  missingJobsDetected: number;
  queuedWithoutJobResetToPending: number;
  runsReconciled: number;
  reenqueued: number;
  driftBefore: CatalogQueueDriftSummary | null;
  driftAfter: CatalogQueueDriftSummary | null;
};

export const reconcileCatalogQueue = async (
  params: ReconcileParams = {},
): Promise<CatalogQueueReconcileResult> => {
  if (!isRedisEnabled()) {
    return {
      queueName: catalogQueueName,
      dryRun: true,
      scannedJobs: 0,
      removedJobs: 0,
      removedByReason: { redis_disabled: 1 },
      normalizedToQueued: 0,
      missingJobsDetected: 0,
      queuedWithoutJobResetToPending: 0,
      runsReconciled: 0,
      reenqueued: 0,
      driftBefore: null,
      driftAfter: null,
    };
  }

  const dryRun = params.dryRun ?? false;
  const jobScanLimit = Math.max(50, params.jobScanLimit ?? reconcileJobScanLimitDefault);
  const reenqueueLimit = Math.max(10, params.reenqueueLimit ?? reconcileReenqueueLimitDefault);
  const driftBefore = await readCatalogQueueDriftSummary({
    sampleLimit: Math.min(jobScanLimit, driftSampleLimitDefault),
    brandId: params.brandId,
    runId: params.runId,
  });

  const queue = getQueue();
  try {
    const [waitingJobs, delayedJobs] = await Promise.all([
      readWaitingJobs(queue, jobScanLimit),
      readDelayedJobs(queue, jobScanLimit),
    ]);
    const jobs = [...waitingJobs, ...delayedJobs];
    const scannedJobs = jobs.length;
    const itemIds = Array.from(
      new Set(
        jobs
          .map((job) => (typeof job.data?.itemId === "string" ? job.data.itemId : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const itemsById = await loadCatalogItemsByIds(itemIds);

    const removedByReason: Record<string, number> = {};
    const jobsToRemove: Array<{ jobId: string }> = [];
    const itemsToNormalizeQueued: string[] = [];

    const pushReason = (reason: string) => {
      removedByReason[reason] = (removedByReason[reason] ?? 0) + 1;
    };

    jobs.forEach((job) => {
      const itemId = typeof job.data?.itemId === "string" ? job.data.itemId : null;
      const jobId = job.id ? String(job.id) : itemId;
      if (!itemId || !jobId) {
        if (params.runId || params.brandId) return;
        pushReason("missing_item_id");
        jobsToRemove.push({ jobId: jobId ?? "" });
        return;
      }
      const item = itemsById.get(itemId);
      if (!item) {
        if (params.runId || params.brandId) return;
        pushReason("missing_item");
        jobsToRemove.push({ jobId });
        return;
      }
      if (!matchesFilter(item, { brandId: params.brandId, runId: params.runId })) return;
      if (item.run.status !== "processing") {
        pushReason("run_not_processing");
        jobsToRemove.push({ jobId });
        return;
      }
      if (item.status === "completed") {
        pushReason("item_completed");
        jobsToRemove.push({ jobId });
        return;
      }
      if (item.status === "failed" && item.attempts >= CATALOG_MAX_ATTEMPTS) {
        pushReason("item_terminal_failed");
        jobsToRemove.push({ jobId });
        return;
      }
      if (item.status === "in_progress") {
        pushReason("item_in_progress");
        jobsToRemove.push({ jobId });
        return;
      }
      if (item.status === "pending" || item.status === "failed") {
        itemsToNormalizeQueued.push(item.id);
      }
    });

    let removedJobs = 0;
    if (!dryRun && jobsToRemove.length) {
      for (const target of jobsToRemove) {
        if (!target.jobId) continue;
        try {
          const job = await queue.getJob(target.jobId);
          if (!job) continue;
          await job.remove();
          removedJobs += 1;
        } catch {
          // ignore remove races
        }
      }
    } else {
      removedJobs = jobsToRemove.length;
    }

    let normalizedToQueued = 0;
    if (itemsToNormalizeQueued.length) {
      if (dryRun) {
        normalizedToQueued = itemsToNormalizeQueued.length;
      } else {
        const result = await prisma.catalogItem.updateMany({
          where: { id: { in: itemsToNormalizeQueued }, status: { in: ["pending", "failed"] } },
          data: { status: "queued", startedAt: null, updatedAt: new Date() },
        });
        normalizedToQueued = result.count;
      }
    }

    const runnableCandidates = await prisma.catalogItem.findMany({
      where: {
        status: { in: ["pending", "failed", "queued"] },
        attempts: { lt: CATALOG_MAX_ATTEMPTS },
        run: {
          status: "processing",
          ...(params.runId ? { id: params.runId } : {}),
          ...(params.brandId ? { brandId: params.brandId } : {}),
        },
      },
      select: { id: true, runId: true, status: true },
      orderBy: { updatedAt: "asc" },
      take: reenqueueLimit,
    });

    const missingJobs: Array<{ id: string; runId: string; status: string }> = [];
    for (const candidate of runnableCandidates) {
      const existingJob = await queue.getJob(candidate.id);
      if (!existingJob) missingJobs.push(candidate);
    }

    const queuedMissingIds = missingJobs
      .filter((item) => item.status === "queued")
      .map((item) => item.id);
    let queuedWithoutJobResetToPending = 0;
    if (queuedMissingIds.length) {
      if (dryRun) {
        queuedWithoutJobResetToPending = queuedMissingIds.length;
      } else {
        const result = await prisma.catalogItem.updateMany({
          where: { id: { in: queuedMissingIds }, status: "queued" },
          data: { status: "pending", startedAt: null, updatedAt: new Date() },
        });
        queuedWithoutJobResetToPending = result.count;
      }
    }

    const runIds = Array.from(new Set(missingJobs.map((item) => item.runId))).slice(
      0,
      reconcileMaxRunsDefault,
    );

    let reenqueued = 0;
    if (!dryRun) {
      const enqueueLimit = Math.max(1, Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50));
      for (const runId of runIds) {
        const refill = await topUpCatalogRunQueue({
          runId,
          enqueueLimit,
          queueEnabled: true,
        });
        reenqueued += refill.enqueued;
      }
    } else {
      reenqueued = missingJobs.length;
    }

    const driftAfter = await readCatalogQueueDriftSummary({
      sampleLimit: Math.min(jobScanLimit, driftSampleLimitDefault),
      brandId: params.brandId,
      runId: params.runId,
    });

    return {
      queueName: catalogQueueName,
      dryRun,
      scannedJobs,
      removedJobs,
      removedByReason,
      normalizedToQueued,
      missingJobsDetected: missingJobs.length,
      queuedWithoutJobResetToPending,
      runsReconciled: runIds.length,
      reenqueued,
      driftBefore,
      driftAfter,
    };
  } finally {
    await queue.close().catch(() => null);
  }
};
