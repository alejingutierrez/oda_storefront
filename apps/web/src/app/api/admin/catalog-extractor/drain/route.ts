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

const resolveDrainConfig = () => {
  const batch = Math.max(1, Number(process.env.CATALOG_DRAIN_BATCH ?? 5));
  const concurrency = Math.max(1, Number(process.env.CATALOG_DRAIN_CONCURRENCY ?? 3));
  const maxMs = Math.max(2000, Number(process.env.CATALOG_DRAIN_MAX_RUNTIME_MS ?? 20000));
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

  const { batch, concurrency, maxMs, queuedStaleMs, stuckMs } = resolveDrainConfig();
  const startedAt = Date.now();
  let processed = 0;
  let lastResult: unknown = null;

  while (processed < batch && Date.now() - startedAt < maxMs) {
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
      batch,
      concurrency,
      maxMs,
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
