import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetQueuedItems, resetStuckItems } from "@/lib/product-enrichment/run-store";
import { drainEnrichmentRun } from "@/lib/product-enrichment/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

const readJsonRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const isCatalogRefreshAutoStartDisabledRun = (metadata: unknown) => {
  const meta = readJsonRecord(metadata);
  const createdBy = typeof meta.created_by === "string" ? meta.created_by : null;
  const autoStart = meta.auto_start;
  const autoStartDisabled =
    autoStart === false ||
    autoStart === "false" ||
    autoStart === null ||
    autoStart === undefined;
  return createdBy === "catalog_refresh" && autoStartDisabled;
};

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
  const batchDefault = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_BATCH ?? 0);
  const concurrencyDefault = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY ?? 20);
  const maxMsDefault = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_MAX_RUNTIME_MS ?? 20000);
  const maxRunsDefault = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_MAX_RUNS ?? 1);
  const batch = Number.isFinite(requestedBatch) ? requestedBatch : batchDefault;
  const concurrencyRaw = Number.isFinite(requestedConcurrency) ? requestedConcurrency : concurrencyDefault;
  const concurrency = Math.max(20, concurrencyRaw);
  const workerConcurrency = Number(process.env.PRODUCT_ENRICHMENT_WORKER_CONCURRENCY ?? NaN);
  const minConcurrency = Math.max(
    20,
    concurrency,
    Number.isFinite(workerConcurrency) ? workerConcurrency : 0,
  );
  const batchFloor = batch <= 0 ? batch : Math.max(batch, minConcurrency);
  const maxMs = Number.isFinite(requestedMaxMs) ? requestedMaxMs : maxMsDefault;
  const maxRuns = Number.isFinite(requestedMaxRuns) ? requestedMaxRuns : maxRunsDefault;
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );
  return { batch: batchFloor, concurrency, maxMs, maxRuns, queuedStaleMs, stuckMs };
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin && !allowCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;

  const { batch, concurrency, maxMs, maxRuns, queuedStaleMs, stuckMs } = resolveDrainConfig(body);
  const safeBatch = batch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, batch);
  const safeConcurrency = Math.max(1, concurrency);
  const safeMaxMs = Math.max(2000, maxMs);
  const safeMaxRuns = Math.max(1, maxRuns);
  const deadline = Date.now() + safeMaxMs;

  let processed = 0;
  let lastResult: unknown = null;
  let runId: string | null = null;
  let runsProcessed = 0;
  const seenRunIds = new Set<string>();

  while (
    processed < safeBatch &&
    runsProcessed < safeMaxRuns &&
    Date.now() < deadline
  ) {
    const run = await prisma.productEnrichmentRun.findFirst({
      where: {
        status: "processing",
        ...(brandId ? { brandId } : {}),
        ...(seenRunIds.size ? { id: { notIn: Array.from(seenRunIds) } } : {}),
      },
      orderBy: { updatedAt: "asc" },
    });
    if (!run) break;
    runId = run.id;
    if (isCatalogRefreshAutoStartDisabledRun(run.metadata)) {
      const now = new Date();
      await prisma.productEnrichmentItem.updateMany({
        where: { runId, status: { in: ["queued", "in_progress"] } },
        data: { status: "pending", startedAt: null, updatedAt: now },
      });
      await prisma.productEnrichmentRun.update({
        where: { id: runId },
        data: {
          status: "paused",
          blockReason: "auto_start_disabled",
          lastError: run.lastError ?? "catalog_refresh_auto_start_disabled",
          updatedAt: now,
        },
      });
      continue;
    }
    seenRunIds.add(runId);
    runsProcessed += 1;

    await resetQueuedItems(runId, queuedStaleMs);
    await resetStuckItems(runId, stuckMs);
    const remainingBatch =
      safeBatch === Number.MAX_SAFE_INTEGER ? safeBatch : Math.max(1, safeBatch - processed);
    const remainingMs = Math.max(2000, deadline - Date.now());
    lastResult = await drainEnrichmentRun({
      runId,
      batch: remainingBatch,
      concurrency: safeConcurrency,
      maxMs: remainingMs,
      queuedStaleMs,
      stuckMs,
    });
    processed += (lastResult as { processed?: number })?.processed ?? 0;

    if (brandId) break;
    if (processed >= safeBatch && safeBatch !== Number.MAX_SAFE_INTEGER) break;
  }

  return NextResponse.json({ runId, runsProcessed, processed, lastResult });
}

export async function GET(req: Request) {
  return POST(req);
}
