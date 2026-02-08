import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetQueuedItems, resetStuckItems } from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";
import { finalizeRefreshForRun } from "@/lib/catalog/refresh";

const readBrandMetadata = (brand: { metadata?: unknown }) =>
  brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
    ? (brand.metadata as Record<string, unknown>)
    : {};

const finalizeRunIfIdle = async (runId: string) => {
  const remaining = await prisma.catalogItem.count({
    where: {
      runId,
      status: { in: ["pending", "queued", "in_progress", "failed"] },
      attempts: { lt: CATALOG_MAX_ATTEMPTS },
    },
  });
  if (remaining > 0) return;

  const run = await prisma.catalogRun.findUnique({
    where: { id: runId },
    include: { brand: true },
  });
  if (!run || run.status === "completed") return;

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
  if (failedCount > 0 || !run.brand) return;

  const metadata = readBrandMetadata(run.brand);
  if (metadata.catalog_extract_finished) return;

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
};

export const runtime = "nodejs";
export const maxDuration = 60;

const allowCronRequest = (req: Request) => {
  const cronHeader = req.headers.get("x-vercel-cron");
  const userAgent = req.headers.get("user-agent") ?? "";
  return (
    cronHeader === "1" ||
    cronHeader === "true" ||
    userAgent.toLowerCase().includes("vercel-cron")
  );
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
  const maxRunsDefault = Number(process.env.CATALOG_DRAIN_MAX_RUNS ?? 1);
  const batch = Number.isFinite(requestedBatch) ? requestedBatch : batchDefault;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? requestedConcurrency
    : concurrencyDefault;
  const maxMs = Number.isFinite(requestedMaxMs) ? requestedMaxMs : maxMsDefault;
  const maxRuns = Number.isFinite(requestedMaxRuns) ? requestedMaxRuns : maxRunsDefault;
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );
  return { batch, concurrency, maxMs, maxRuns, queuedStaleMs, stuckMs };
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin && !allowCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;

  const { batch, concurrency, maxMs, maxRuns, queuedStaleMs, stuckMs } = resolveDrainConfig(body);
  const startedAt = Date.now();
  let processed = 0;
  let runsProcessed = 0;
  let lastResult: unknown = null;
  const seenRunIds = new Set<string>();

  const safeBatch = batch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, batch);
  const safeConcurrency = Math.max(1, concurrency);
  const safeMaxMs = Math.max(2000, maxMs);
  const safeMaxRuns = Math.max(1, maxRuns);
  const deadline = startedAt + safeMaxMs;

  while (
    processed < safeBatch &&
    runsProcessed < safeMaxRuns &&
    Date.now() < deadline
  ) {
    const run = await prisma.catalogRun.findFirst({
      where: {
        status: "processing",
        ...(brandId ? { brandId } : {}),
        ...(seenRunIds.size ? { id: { notIn: Array.from(seenRunIds) } } : {}),
      },
      orderBy: { updatedAt: "asc" },
    });
    if (!run) break;

    const runId = run.id;
    seenRunIds.add(runId);
    runsProcessed += 1;

    await resetQueuedItems(runId, queuedStaleMs);
    await resetStuckItems(runId, stuckMs);
    const remainingBatch =
      safeBatch === Number.MAX_SAFE_INTEGER ? safeBatch : Math.max(1, safeBatch - processed);
    const remainingMs = Math.max(2000, deadline - Date.now());
    lastResult = await drainCatalogRun({
      runId,
      batch: remainingBatch,
      concurrency: safeConcurrency,
      maxMs: remainingMs,
      queuedStaleMs,
      stuckMs,
    });
    await finalizeRunIfIdle(runId);
    processed += (lastResult as { processed?: number })?.processed ?? 0;

    if (brandId) break;
    if (processed >= safeBatch && safeBatch !== Number.MAX_SAFE_INTEGER) break;
  }

  return NextResponse.json({ processed, runsProcessed, lastResult });
}

export async function GET(req: Request) {
  return POST(req);
}
