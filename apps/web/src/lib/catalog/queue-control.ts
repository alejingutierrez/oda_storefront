import { prisma } from "@/lib/prisma";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";
import { enqueueCatalogItems } from "@/lib/catalog/queue";
import { listPendingItems, markItemsQueued } from "@/lib/catalog/run-store";

const parsePositiveInt = (value: unknown) => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

export const resolveCatalogQueueTargetDepth = (enqueueLimit: number) => {
  const envTarget = parsePositiveInt(process.env.CATALOG_QUEUE_TARGET_DEPTH);
  const workerConcurrency = Math.max(
    1,
    parsePositiveInt(process.env.CATALOG_WORKER_CONCURRENCY) ?? 10,
  );
  const fallback = Math.max(1, enqueueLimit, workerConcurrency * 3);
  return envTarget ?? fallback;
};

export const readCatalogRunQueueDepth = async (runId: string) => {
  const grouped = await prisma.catalogItem.groupBy({
    by: ["status"],
    where: {
      runId,
      status: { in: ["queued", "in_progress"] },
      attempts: { lt: CATALOG_MAX_ATTEMPTS },
    },
    _count: { _all: true },
  });
  const queued = grouped.find((row) => row.status === "queued")?._count._all ?? 0;
  const inProgress = grouped.find((row) => row.status === "in_progress")?._count._all ?? 0;
  return {
    queued,
    inProgress,
    currentLoad: queued + inProgress,
  };
};

export type TopUpCatalogRunQueueResult = {
  targetDepth: number;
  currentLoad: number;
  gap: number;
  selected: number;
  enqueued: number;
};

export const topUpCatalogRunQueue = async (params: {
  runId: string;
  enqueueLimit: number;
  targetDepth?: number;
  queueEnabled: boolean;
}): Promise<TopUpCatalogRunQueueResult> => {
  const targetDepth = Math.max(1, params.targetDepth ?? resolveCatalogQueueTargetDepth(params.enqueueLimit));
  const depth = await readCatalogRunQueueDepth(params.runId);
  const gap = Math.max(0, targetDepth - depth.currentLoad);
  if (gap <= 0) {
    return {
      targetDepth,
      currentLoad: depth.currentLoad,
      gap: 0,
      selected: 0,
      enqueued: 0,
    };
  }

  if (!params.queueEnabled) {
    return {
      targetDepth,
      currentLoad: depth.currentLoad,
      gap,
      selected: 0,
      enqueued: 0,
    };
  }

  const pickLimit = Math.max(1, Math.min(gap, Math.max(params.enqueueLimit, gap)));
  const pendingItems = await listPendingItems(params.runId, pickLimit);
  if (!pendingItems.length) {
    return {
      targetDepth,
      currentLoad: depth.currentLoad,
      gap,
      selected: 0,
      enqueued: 0,
    };
  }

  await markItemsQueued(pendingItems.map((item) => item.id));
  if (params.queueEnabled) {
    await enqueueCatalogItems(pendingItems);
  }
  return {
    targetDepth,
    currentLoad: depth.currentLoad,
    gap,
    selected: pendingItems.length,
    enqueued: pendingItems.length,
  };
};
