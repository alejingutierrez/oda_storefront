import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.PLP_SEO_MAX_ATTEMPTS ?? 3));

export type PlpSeoRunSummary = {
  runId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  lastError?: string | null;
};

export const findLatestRun = async () => {
  return prisma.plpSeoRun.findFirst({
    orderBy: { updatedAt: "desc" },
  });
};

export const findActiveRun = async () => {
  return prisma.plpSeoRun.findFirst({
    where: { status: { in: ["processing", "paused", "stopped", "blocked"] } },
    orderBy: { updatedAt: "desc" },
  });
};

export const summarizeRun = async (runId: string): Promise<PlpSeoRunSummary | null> => {
  const run = await prisma.plpSeoRun.findUnique({ where: { id: runId } });
  if (!run) return null;

  const counts = await prisma.plpSeoItem.groupBy({
    by: ["status"],
    where: { runId },
    _count: { _all: true },
  });

  const map = new Map<string, number>();
  counts.forEach((row) => map.set(row.status, row._count._all));
  const completed = map.get("completed") ?? 0;
  const failed = map.get("failed") ?? 0;
  const totalFromItems = counts.reduce((sum, row) => sum + row._count._all, 0);
  const total = totalFromItems || run.totalItems || 0;
  const pending = Math.max(0, total - completed - failed);

  return {
    runId: run.id,
    status: run.status,
    total,
    completed,
    failed,
    pending,
    lastError: run.lastError ?? null,
  };
};

export const getItemCounts = async (runId: string) => {
  const grouped = await prisma.plpSeoItem.groupBy({
    by: ["status"],
    where: { runId },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const row of grouped) out[row.status] = row._count._all;
  return out;
};

export const createRunWithItems = async (params: {
  items: Array<{
    path: string;
    genderSlug: string;
    categoryKey: string | null;
    subcategoryKey: string | null;
  }>;
  metadata?: Prisma.InputJsonValue;
}) => {
  const now = new Date();
  return prisma.plpSeoRun.create({
    data: {
      status: "processing",
      totalItems: params.items.length,
      startedAt: now,
      updatedAt: now,
      metadata: params.metadata ?? undefined,
      items: {
        createMany: {
          data: params.items.map((item) => ({
            path: item.path,
            genderSlug: item.genderSlug,
            categoryKey: item.categoryKey,
            subcategoryKey: item.subcategoryKey,
            status: "pending",
            attempts: 0,
          })),
        },
      },
    },
  });
};

export const listPendingItems = async (runId: string, limit?: number) => {
  return prisma.plpSeoItem.findMany({
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
  return prisma.plpSeoItem.findMany({
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
  return prisma.plpSeoItem.updateMany({
    where: { id: { in: ids }, status: { in: ["pending", "failed"] } },
    data: { status: "queued", updatedAt: new Date() },
  });
};

export const resetQueuedItems = async (runId: string, olderThanMs: number) => {
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) return { count: 0 };
  const cutoff = new Date(Date.now() - olderThanMs);
  return prisma.plpSeoItem.updateMany({
    where: { runId, status: "queued", updatedAt: { lt: cutoff } },
    data: { status: "pending", updatedAt: new Date() },
  });
};

export const resetStuckItems = async (runId: string, olderThanMs: number) => {
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) return { count: 0 };
  const cutoff = new Date(Date.now() - olderThanMs);
  return prisma.plpSeoItem.updateMany({
    where: { runId, status: "in_progress", startedAt: { lt: cutoff } },
    data: { status: "pending", updatedAt: new Date() },
  });
};

export const markRunStatus = async (runId: string, status: string, extra?: Prisma.PlpSeoRunUpdateInput) => {
  return prisma.plpSeoRun.update({
    where: { id: runId },
    data: { status, updatedAt: new Date(), ...(extra ?? {}) },
  });
};
