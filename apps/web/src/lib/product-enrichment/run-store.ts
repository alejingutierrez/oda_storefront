import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type EnrichmentRunSummary = {
  runId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  lastError?: string | null;
  blockReason?: string | null;
  lastProductId?: string | null;
  lastStage?: string | null;
  consecutiveErrors?: number;
};

const MAX_ATTEMPTS = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 3));

export const findLatestRun = async (params: { scope: string; brandId?: string | null }) => {
  return prisma.productEnrichmentRun.findFirst({
    where: {
      scope: params.scope,
      brandId: params.brandId ?? null,
    },
    orderBy: { updatedAt: "desc" },
  });
};

export const findActiveRun = async (params: { scope: string; brandId?: string | null }) => {
  return prisma.productEnrichmentRun.findFirst({
    where: {
      scope: params.scope,
      brandId: params.brandId ?? null,
      status: { in: ["processing", "paused", "stopped", "blocked"] },
    },
    orderBy: { updatedAt: "desc" },
  });
};

export const summarizeRun = async (runId: string): Promise<EnrichmentRunSummary | null> => {
  const run = await prisma.productEnrichmentRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const counts = await prisma.productEnrichmentItem.groupBy({
    by: ["status"],
    where: { runId },
    _count: { _all: true },
  });

  const map = new Map<string, number>();
  counts.forEach((row) => map.set(row.status, row._count._all));
  const completed = map.get("completed") ?? 0;
  const failed = map.get("failed") ?? 0;
  const total = run.totalItems || counts.reduce((sum, row) => sum + row._count._all, 0);
  const pending = Math.max(0, total - completed - failed);

  return {
    runId: run.id,
    status: run.status,
    total,
    completed,
    failed,
    pending,
    lastError: run.lastError ?? null,
    blockReason: run.blockReason ?? null,
    lastProductId: run.lastProductId ?? null,
    lastStage: run.lastStage ?? null,
    consecutiveErrors: run.consecutiveErrors ?? 0,
  };
};

export const createRunWithItems = async (params: {
  scope: string;
  brandId?: string | null;
  productIds: string[];
  status?: string;
  metadata?: Prisma.InputJsonValue;
}) => {
  const now = new Date();
  return prisma.productEnrichmentRun.create({
    data: {
      scope: params.scope,
      brandId: params.brandId ?? null,
      status: params.status ?? "processing",
      totalItems: params.productIds.length,
      startedAt: now,
      updatedAt: now,
      metadata: params.metadata ?? undefined,
      items: {
        createMany: {
          data: params.productIds.map((productId) => ({
            productId,
            status: "pending",
            attempts: 0,
          })),
        },
      },
    },
  });
};

export const listPendingItems = async (runId: string, limit?: number) => {
  return prisma.productEnrichmentItem.findMany({
    where: {
      runId,
      status: { in: ["pending", "failed"] },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { updatedAt: "asc" },
    take: limit ?? 1000,
  });
};

export const listRunnableItems = async (runId: string, limit?: number, includeQueued = true) => {
  const statuses = includeQueued ? ["pending", "failed", "queued"] : ["pending", "failed"];
  return prisma.productEnrichmentItem.findMany({
    where: {
      runId,
      status: { in: statuses },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { updatedAt: "asc" },
    take: limit ?? 100,
  });
};

export const markItemsQueued = async (ids: string[]) => {
  if (!ids.length) return { count: 0 };
  return prisma.productEnrichmentItem.updateMany({
    where: { id: { in: ids }, status: { in: ["pending", "failed"] } },
    data: { status: "queued", updatedAt: new Date() },
  });
};

export const resetQueuedItems = async (runId: string, olderThanMs: number) => {
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) return { count: 0 };
  const cutoff = new Date(Date.now() - olderThanMs);
  return prisma.productEnrichmentItem.updateMany({
    where: { runId, status: "queued", updatedAt: { lt: cutoff } },
    data: { status: "pending", updatedAt: new Date() },
  });
};

export const resetStuckItems = async (runId: string, olderThanMs: number) => {
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) return { count: 0 };
  const cutoff = new Date(Date.now() - olderThanMs);
  return prisma.productEnrichmentItem.updateMany({
    where: { runId, status: "in_progress", startedAt: { lt: cutoff } },
    data: { status: "pending", updatedAt: new Date() },
  });
};

export const markRunStatus = async (runId: string, status: string) => {
  return prisma.productEnrichmentRun.update({
    where: { id: runId },
    data: { status, updatedAt: new Date() },
  });
};

export const updateRunAfterItem = async (params: {
  runId: string;
  lastProductId?: string | null;
  lastStage?: string | null;
  lastError?: string | null;
  blockReason?: string | null;
  consecutiveErrors?: number | null;
  status?: string | null;
}) => {
  const data: Prisma.ProductEnrichmentRunUpdateInput = {
    updatedAt: new Date(),
  };
  if (params.lastProductId !== undefined) data.lastProductId = params.lastProductId;
  if (params.lastStage !== undefined) data.lastStage = params.lastStage;
  if (params.lastError !== undefined) data.lastError = params.lastError;
  if (params.blockReason !== undefined) data.blockReason = params.blockReason;
  if (typeof params.consecutiveErrors === "number") data.consecutiveErrors = params.consecutiveErrors;
  if (params.status) data.status = params.status;
  return prisma.productEnrichmentRun.update({ where: { id: params.runId }, data });
};
