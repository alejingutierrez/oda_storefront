import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetQueuedItems, resetStuckItems } from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

const allowCronRequest = (req: Request) => {
  const cronHeader = req.headers.get("x-vercel-cron");
  return cronHeader === "1" || cronHeader === "true";
};

const resolveDrainConfig = (body: unknown) => {
  const payload =
    body && typeof body === "object" ? (body as Record<string, unknown>) : ({} as Record<string, unknown>);
  const requestedBatch = Number(payload.drainBatch ?? payload.batch ?? payload.limit);
  const requestedConcurrency = Number(payload.drainConcurrency ?? payload.concurrency ?? payload.workers);
  const requestedMaxMs = Number(payload.drainMaxMs ?? payload.maxMs ?? payload.timeoutMs);
  const batchDefault = Number(process.env.CATALOG_DRAIN_BATCH ?? 0);
  const concurrencyDefault = Number(process.env.CATALOG_DRAIN_CONCURRENCY ?? 5);
  const maxMsDefault = Number(process.env.CATALOG_DRAIN_MAX_RUNTIME_MS ?? 20000);
  const batch = Number.isFinite(requestedBatch) ? requestedBatch : batchDefault;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? requestedConcurrency
    : concurrencyDefault;
  const maxMs = Number.isFinite(requestedMaxMs) ? requestedMaxMs : maxMsDefault;
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );
  return { batch, concurrency, maxMs, queuedStaleMs, stuckMs };
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin && !allowCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;

  const { batch, concurrency, maxMs, queuedStaleMs, stuckMs } = resolveDrainConfig(body);
  const startedAt = Date.now();
  let processed = 0;
  let lastResult: unknown = null;

  const safeBatch = batch <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, batch);
  const safeConcurrency = Math.max(1, concurrency);
  const safeMaxMs = Math.max(2000, maxMs);

  while (processed < safeBatch && Date.now() - startedAt < safeMaxMs) {
    let runId: string | null = null;
    if (brandId) {
      const run = await prisma.catalogRun.findFirst({
        where: { brandId, status: "processing" },
        orderBy: { updatedAt: "asc" },
      });
      runId = run?.id ?? null;
    } else {
      const run = await prisma.catalogRun.findFirst({
        where: { status: "processing" },
        orderBy: { updatedAt: "asc" },
      });
      runId = run?.id ?? null;
    }

    if (!runId) break;

    await resetQueuedItems(runId, queuedStaleMs);
    await resetStuckItems(runId, stuckMs);
    lastResult = await drainCatalogRun({
      runId,
      batch: safeBatch,
      concurrency: safeConcurrency,
      maxMs: safeMaxMs,
      queuedStaleMs,
      stuckMs,
    });
    processed += (lastResult as { processed?: number })?.processed ?? 0;
    break;
  }

  return NextResponse.json({ processed, lastResult });
}

export async function GET(req: Request) {
  return POST(req);
}
