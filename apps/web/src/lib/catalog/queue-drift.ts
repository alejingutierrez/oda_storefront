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
const reconcileActiveHungMinutesDefault = Math.max(
  5,
  Number(process.env.CATALOG_RECONCILE_ACTIVE_HUNG_MINUTES ?? 15),
);
const activeCompletedGraceSecondsDefault = Math.max(
  0,
  Number(process.env.CATALOG_QUEUE_ACTIVE_COMPLETED_GRACE_SECONDS ?? 180),
);

type CatalogItemLite = {
  id: string;
  status: string;
  attempts: number;
  completedAt: Date | null;
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

const readActiveJobs = async (queue: Queue, limit: number) => {
  if (limit <= 0) return [];
  return queue.getJobs(["active"], 0, Math.max(0, limit - 1), true);
};

const loadCatalogItemsByIds = async (itemIds: string[]) => {
  if (!itemIds.length) return new Map<string, CatalogItemLite>();
  const rows = await prisma.catalogItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      status: true,
      attempts: true,
      completedAt: true,
      runId: true,
      run: { select: { status: true, brandId: true } },
    },
  });
  return new Map(rows.map((row) => [row.id, row]));
};

const isCompletedWithinGraceWindow = (
  completedAt: Date | null,
  graceMs: number,
  nowMs: number,
) => {
  if (!completedAt) return false;
  if (graceMs <= 0) return false;
  const completedAtMs = completedAt.getTime();
  if (!Number.isFinite(completedAtMs)) return false;
  return nowMs - completedAtMs <= graceMs;
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
  activeSampleSize: number;
  activeSampleFilteredOut: number;
  activeMissingItem: number;
  activeRunNotProcessing: number;
  activeItemNotInProgress: number;
  activeItemTerminalFailed: number;
  activeItemCompleted: number;
  activeCompletedGraceSeconds: number;
  activeHungThresholdMinutes: number;
  activeHungCount: number;
  activeOldestActiveMs: number;
  activeOldestProcessedOn: string | null;
  activeZombieCount: number;
  activeZombieCriticalCount: number;
  activeZombieTransientCount: number;
  activeZombieByReason: Record<string, number>;
  activeHungDetected: boolean;
  runsRunnableWithoutQueueLoad: number;
  runsRunnableWithoutQueueLoadSample: Array<{ runId: string; brandId: string }>;
  aggressiveRequired: boolean;
  aggressiveReason: string | null;
  driftDetected: boolean;
};

export const readCatalogQueueDriftSummary = async (params: {
  sampleLimit?: number;
  brandId?: string | null;
  runId?: string | null;
  activeHungMinutes?: number;
  activeCompletedGraceSeconds?: number;
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
      activeSampleSize: 0,
      activeSampleFilteredOut: 0,
      activeMissingItem: 0,
      activeRunNotProcessing: 0,
      activeItemNotInProgress: 0,
      activeItemTerminalFailed: 0,
      activeItemCompleted: 0,
      activeCompletedGraceSeconds: activeCompletedGraceSecondsDefault,
      activeHungThresholdMinutes: reconcileActiveHungMinutesDefault,
      activeHungCount: 0,
      activeOldestActiveMs: 0,
      activeOldestProcessedOn: null,
      activeZombieCount: 0,
      activeZombieCriticalCount: 0,
      activeZombieTransientCount: 0,
      activeZombieByReason: {},
      activeHungDetected: false,
      runsRunnableWithoutQueueLoad: 0,
      runsRunnableWithoutQueueLoadSample: [],
      aggressiveRequired: false,
      aggressiveReason: null,
      driftDetected: false,
    };
  }
  const sampleLimit = Math.max(10, params.sampleLimit ?? driftSampleLimitDefault);
  const activeHungMinutes = Math.max(
    5,
    params.activeHungMinutes ?? reconcileActiveHungMinutesDefault,
  );
  const activeCompletedGraceSeconds = Math.max(
    0,
    params.activeCompletedGraceSeconds ?? activeCompletedGraceSecondsDefault,
  );
  const activeHungThresholdMs = activeHungMinutes * 60 * 1000;
  const activeCompletedGraceMs = activeCompletedGraceSeconds * 1000;
  const queue = getQueue();
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed");
    const [waitingJobs, activeJobs] = await Promise.all([
      readWaitingJobs(queue, sampleLimit),
      readActiveJobs(queue, sampleLimit),
    ]);
    const waitingIds = Array.from(
      new Set(
        waitingJobs
          .map((job) => (typeof job.data?.itemId === "string" ? job.data.itemId : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const activeIds = Array.from(
      new Set(
        activeJobs
          .map((job) => (typeof job.data?.itemId === "string" ? job.data.itemId : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const itemsById = await loadCatalogItemsByIds(Array.from(new Set([...waitingIds, ...activeIds])));

    let waitingSampleFilteredOut = 0;
    let waitingMissingItem = 0;
    let waitingItemNotQueued = 0;
    let waitingRunNotProcessing = 0;
    let activeSampleFilteredOut = 0;
    let activeMissingItem = 0;
    let activeRunNotProcessing = 0;
    let activeItemNotInProgress = 0;
    let activeItemTerminalFailed = 0;
    let activeItemCompleted = 0;
    let activeHungCount = 0;
    let activeOldestActiveMs = 0;
    let activeOldestProcessedOn: string | null = null;
    const activeZombieByReason: Record<string, number> = {};

    const pushActiveZombieReason = (reason: string) => {
      activeZombieByReason[reason] = (activeZombieByReason[reason] ?? 0) + 1;
    };

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

    const now = Date.now();
    activeJobs.forEach((job) => {
      const itemId = typeof job.data?.itemId === "string" ? job.data.itemId : null;
      if (!itemId) return;
      const item = itemsById.get(itemId);
      const processedOn = typeof job.processedOn === "number" ? job.processedOn : null;
      if (!item) {
        activeMissingItem += 1;
        pushActiveZombieReason("missing_item");
        return;
      }
      if (!matchesFilter(item, { brandId: params.brandId, runId: params.runId })) {
        activeSampleFilteredOut += 1;
        return;
      }
      const completedWithinGrace =
        item.status === "completed" &&
        isCompletedWithinGraceWindow(item.completedAt, activeCompletedGraceMs, now);
      if (processedOn) {
        const ageMs = Math.max(0, now - processedOn);
        if (!completedWithinGrace && ageMs >= activeHungThresholdMs) activeHungCount += 1;
        if (ageMs > activeOldestActiveMs) {
          activeOldestActiveMs = ageMs;
          activeOldestProcessedOn = new Date(processedOn).toISOString();
        }
      }
      if (item.run.status !== "processing") {
        activeRunNotProcessing += 1;
        pushActiveZombieReason("run_not_processing");
        return;
      }
      if (item.status === "completed") {
        activeItemCompleted += 1;
        pushActiveZombieReason(completedWithinGrace ? "item_completed_recent" : "item_completed");
        return;
      }
      if (item.status === "failed" && item.attempts >= CATALOG_MAX_ATTEMPTS) {
        activeItemTerminalFailed += 1;
        pushActiveZombieReason("item_terminal_failed");
        return;
      }
      if (item.status !== "in_progress") {
        activeItemNotInProgress += 1;
        pushActiveZombieReason("item_not_in_progress");
      }
    });

    const runsWithoutQueue = await readRunsRunnableWithoutQueueLoad({
      brandId: params.brandId,
      runId: params.runId,
    });

    const activeZombieCriticalCount =
      (activeZombieByReason.missing_item ?? 0) +
      (activeZombieByReason.run_not_processing ?? 0) +
      (activeZombieByReason.item_not_in_progress ?? 0) +
      (activeZombieByReason.item_terminal_failed ?? 0) +
      (activeZombieByReason.item_completed ?? 0);
    const activeZombieTransientCount = activeZombieByReason.item_completed_recent ?? 0;
    const activeZombieCount = activeZombieCriticalCount + activeZombieTransientCount;
    const activeHungDetected = activeHungCount > 0;
    let aggressiveReason: string | null = null;
    if (activeHungDetected && activeZombieCriticalCount > 0) {
      aggressiveReason = "active_hung_and_zombies_detected";
    }
    else if (activeHungDetected) aggressiveReason = "active_hung_detected";
    else if (activeZombieCriticalCount > 0) aggressiveReason = "active_zombies_detected";

    const driftDetected =
      waitingMissingItem > 0 ||
      waitingItemNotQueued > 0 ||
      waitingRunNotProcessing > 0 ||
      activeZombieCriticalCount > 0 ||
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
      activeSampleSize: activeJobs.length,
      activeSampleFilteredOut,
      activeMissingItem,
      activeRunNotProcessing,
      activeItemNotInProgress,
      activeItemTerminalFailed,
      activeItemCompleted,
      activeCompletedGraceSeconds,
      activeHungThresholdMinutes: activeHungMinutes,
      activeHungCount,
      activeOldestActiveMs,
      activeOldestProcessedOn,
      activeZombieCount,
      activeZombieCriticalCount,
      activeZombieTransientCount,
      activeZombieByReason,
      activeHungDetected,
      runsRunnableWithoutQueueLoad: runsWithoutQueue.count,
      runsRunnableWithoutQueueLoadSample: runsWithoutQueue.sample,
      aggressiveRequired: Boolean(aggressiveReason),
      aggressiveReason,
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
  activeHungMinutes?: number;
  activeCompletedGraceSeconds?: number;
  scanUntilMatchLimit?: number;
  includeActiveAnalysis?: boolean;
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
  activeHungDetected: boolean;
  activeZombieCount: number;
  activeZombieCriticalCount: number;
  activeZombieTransientCount: number;
  aggressiveRequired: boolean;
  aggressiveReason: string | null;
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
      activeHungDetected: false,
      activeZombieCount: 0,
      activeZombieCriticalCount: 0,
      activeZombieTransientCount: 0,
      aggressiveRequired: false,
      aggressiveReason: "redis_disabled",
      driftBefore: null,
      driftAfter: null,
    };
  }

  const dryRun = params.dryRun ?? false;
  const jobScanLimit = Math.max(50, params.jobScanLimit ?? reconcileJobScanLimitDefault);
  const scanUntilMatchLimit = Math.max(
    50,
    params.scanUntilMatchLimit ?? params.jobScanLimit ?? reconcileJobScanLimitDefault,
  );
  const activeHungMinutes = Math.max(
    5,
    params.activeHungMinutes ?? reconcileActiveHungMinutesDefault,
  );
  const activeCompletedGraceSeconds = Math.max(
    0,
    params.activeCompletedGraceSeconds ?? activeCompletedGraceSecondsDefault,
  );
  const activeCompletedGraceMs = activeCompletedGraceSeconds * 1000;
  const includeActiveAnalysis = params.includeActiveAnalysis ?? true;
  const reenqueueLimit = Math.max(10, params.reenqueueLimit ?? reconcileReenqueueLimitDefault);
  const driftBefore = await readCatalogQueueDriftSummary({
    sampleLimit: Math.min(jobScanLimit, driftSampleLimitDefault),
    brandId: params.brandId,
    runId: params.runId,
    activeHungMinutes,
    activeCompletedGraceSeconds,
  });

  const queue = getQueue();
  try {
    const [waitingJobs, delayedJobs, activeJobs] = await Promise.all([
      readWaitingJobs(queue, jobScanLimit),
      readDelayedJobs(queue, jobScanLimit),
      includeActiveAnalysis ? readActiveJobs(queue, scanUntilMatchLimit) : Promise.resolve([]),
    ]);
    const jobsByState: Array<{ state: "waiting" | "delayed" | "active"; job: Awaited<ReturnType<typeof readWaitingJobs>>[number] }> = [
      ...waitingJobs.map((job) => ({ state: "waiting" as const, job })),
      ...delayedJobs.map((job) => ({ state: "delayed" as const, job })),
      ...activeJobs.map((job) => ({ state: "active" as const, job })),
    ];
    const scannedJobs = jobsByState.length;
    const itemIds = Array.from(
      new Set(
        jobsByState
          .map(({ job }) => (typeof job.data?.itemId === "string" ? job.data.itemId : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const itemsById = await loadCatalogItemsByIds(itemIds);

    const removedByReason: Record<string, number> = {};
    const jobsToRemove: Array<{ jobId: string; state: "waiting" | "delayed" | "active" }> = [];
    const itemsToNormalizeQueued: string[] = [];
    const activeHungThresholdMs = activeHungMinutes * 60 * 1000;
    const now = Date.now();

    const pushReason = (reason: string) => {
      removedByReason[reason] = (removedByReason[reason] ?? 0) + 1;
    };

    jobsByState.forEach(({ state, job }) => {
      const itemId = typeof job.data?.itemId === "string" ? job.data.itemId : null;
      const jobId = job.id ? String(job.id) : itemId;
      if (!itemId || !jobId) {
        if (params.runId || params.brandId) return;
        const reason = state === "active" ? "active_missing_item_id" : "missing_item_id";
        pushReason(reason);
        jobsToRemove.push({ jobId: jobId ?? "", state });
        return;
      }
      const item = itemsById.get(itemId);
      if (!item) {
        if (params.runId || params.brandId) return;
        const reason = state === "active" ? "active_missing_item" : "missing_item";
        pushReason(reason);
        jobsToRemove.push({ jobId, state });
        return;
      }
      if (!matchesFilter(item, { brandId: params.brandId, runId: params.runId })) return;
      if (state === "active") {
        const processedOn = typeof job.processedOn === "number" ? job.processedOn : null;
        const completedWithinGrace =
          item.status === "completed" &&
          isCompletedWithinGraceWindow(item.completedAt, activeCompletedGraceMs, now);
        if (item.run.status !== "processing") {
          pushReason("active_run_not_processing");
          jobsToRemove.push({ jobId, state });
          return;
        }
        if (item.status === "completed") {
          if (completedWithinGrace) {
            pushReason("active_item_completed_recent_grace");
            return;
          }
          pushReason("active_item_completed");
          jobsToRemove.push({ jobId, state });
          return;
        }
        if (item.status === "failed" && item.attempts >= CATALOG_MAX_ATTEMPTS) {
          pushReason("active_item_terminal_failed");
          jobsToRemove.push({ jobId, state });
          return;
        }
        if (item.status !== "in_progress") {
          pushReason("active_item_not_in_progress");
          jobsToRemove.push({ jobId, state });
          return;
        }
        if (
          processedOn &&
          !completedWithinGrace &&
          Math.max(0, now - processedOn) >= activeHungThresholdMs
        ) {
          pushReason("active_hung");
          jobsToRemove.push({ jobId, state });
        }
        return;
      }
      if (item.run.status !== "processing") {
        pushReason("run_not_processing");
        jobsToRemove.push({ jobId, state });
        return;
      }
      if (item.status === "completed") {
        pushReason("item_completed");
        jobsToRemove.push({ jobId, state });
        return;
      }
      if (item.status === "failed" && item.attempts >= CATALOG_MAX_ATTEMPTS) {
        pushReason("item_terminal_failed");
        jobsToRemove.push({ jobId, state });
        return;
      }
      if (item.status === "in_progress") {
        pushReason("item_in_progress");
        jobsToRemove.push({ jobId, state });
        return;
      }
      if (item.status === "pending" || item.status === "failed") {
        itemsToNormalizeQueued.push(item.id);
      }
    });

    let removedJobs = 0;
    let activeRemovalBlocked = 0;
    if (!dryRun && jobsToRemove.length) {
      for (const target of jobsToRemove) {
        if (!target.jobId) continue;
        try {
          const job = await queue.getJob(target.jobId);
          if (!job) continue;
          await job.remove();
          removedJobs += 1;
        } catch {
          if (target.state === "active") activeRemovalBlocked += 1;
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

    // Batch check: obtener todos los job IDs en cola de una vez en lugar de O(n) queries
    const existingJobIds = await queue
      .getRanges(["waiting", "delayed"], 0, -1)
      .catch(() => [] as string[]);
    const existingJobIdSet = new Set(existingJobIds);

    const missingJobs: Array<{ id: string; runId: string; status: string }> = [];
    for (const candidate of runnableCandidates) {
      if (!existingJobIdSet.has(candidate.id)) missingJobs.push(candidate);
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
      activeHungMinutes,
      activeCompletedGraceSeconds,
    });

    const activeZombieCount = driftBefore.activeZombieCount;
    const activeZombieCriticalCount = driftBefore.activeZombieCriticalCount;
    const activeZombieTransientCount = driftBefore.activeZombieTransientCount;
    const activeHungDetected = driftBefore.activeHungDetected;
    let aggressiveReason: string | null = null;
    if (activeRemovalBlocked > 0) aggressiveReason = "active_jobs_remove_blocked";
    else if (driftBefore.aggressiveRequired) aggressiveReason = driftBefore.aggressiveReason;
    const aggressiveRequired = Boolean(aggressiveReason);

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
      activeHungDetected,
      activeZombieCount,
      activeZombieCriticalCount,
      activeZombieTransientCount,
      aggressiveRequired,
      aggressiveReason,
      driftBefore,
      driftAfter,
    };
  } finally {
    await queue.close().catch(() => null);
  }
};
