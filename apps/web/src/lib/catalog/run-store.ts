import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProductRef } from "@/lib/catalog/types";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";

export type CatalogRunSummary = {
  runId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  lastError?: string | null;
  blockReason?: string | null;
  lastUrl?: string | null;
  lastStage?: string | null;
  consecutiveErrors?: number;
};

export const findLatestRun = async (brandId: string) =>
  prisma.catalogRun.findFirst({
    where: { brandId },
    orderBy: { updatedAt: "desc" },
  });

export const findActiveRun = async (brandId: string) =>
  prisma.catalogRun.findFirst({
    where: { brandId, status: { in: ["processing", "paused", "stopped", "blocked"] } },
    orderBy: { updatedAt: "desc" },
  });

export const summarizeRun = async (runId: string): Promise<CatalogRunSummary | null> => {
  const run = await prisma.catalogRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const counts = await prisma.catalogItem.groupBy({
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
    lastUrl: run.lastUrl ?? null,
    lastStage: run.lastStage ?? null,
    consecutiveErrors: run.consecutiveErrors ?? 0,
  };
};

export const createRunWithItems = async ({
  brandId,
  platform,
  refs,
  status = "processing",
}: {
  brandId: string;
  platform?: string | null;
  refs: ProductRef[];
  status?: string;
}) => {
  const now = new Date();
  return prisma.catalogRun.create({
    data: {
      brandId,
      status,
      platform: platform ?? null,
      totalItems: refs.length,
      startedAt: now,
      updatedAt: now,
      items: {
        createMany: {
          data: refs.map((ref) => ({
            url: ref.url,
            status: "pending",
            attempts: 0,
          })),
        },
      },
    },
  });
};

export const listPendingItems = async (runId: string, limit?: number) => {
  return prisma.catalogItem.findMany({
    where: {
      runId,
      status: { in: ["pending", "failed"] },
      attempts: { lt: CATALOG_MAX_ATTEMPTS },
    },
    orderBy: { updatedAt: "asc" },
    take: limit ?? 1000,
  });
};

export const markRunStatus = async (runId: string, status: string) => {
  return prisma.catalogRun.update({
    where: { id: runId },
    data: { status, updatedAt: new Date() },
  });
};

export const updateRunAfterItem = async ({
  runId,
  lastUrl,
  lastStage,
  lastError,
  blockReason,
  consecutiveErrors,
  status,
}: {
  runId: string;
  lastUrl?: string | null;
  lastStage?: string | null;
  lastError?: string | null;
  blockReason?: string | null;
  consecutiveErrors?: number | null;
  status?: string | null;
}) => {
  const data: Prisma.CatalogRunUpdateInput = {
    updatedAt: new Date(),
  };
  if (lastUrl !== undefined) data.lastUrl = lastUrl;
  if (lastStage !== undefined) data.lastStage = lastStage;
  if (lastError !== undefined) data.lastError = lastError;
  if (blockReason !== undefined) data.blockReason = blockReason;
  if (typeof consecutiveErrors === "number") data.consecutiveErrors = consecutiveErrors;
  if (status) data.status = status;

  return prisma.catalogRun.update({ where: { id: runId }, data });
};
