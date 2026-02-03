import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clearEnrichmentQueue } from "@/lib/product-enrichment/queue";

export const runtime = "nodejs";

const ACTIVE_STATUSES: string[] = ["processing", "paused", "blocked", "stopped"];

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const scope = body?.scope === "all" || body?.scope === "brand" ? body.scope : "all";
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const mode =
    body?.mode === "pause"
      ? "pause"
      : body?.mode === "retry_failed"
        ? "retry_failed"
        : "delete";

  if (scope === "brand" && !brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const where: Prisma.ProductEnrichmentRunWhereInput = {
    status: { in: ACTIVE_STATUSES },
    ...(scope === "brand" ? { brandId } : {}),
  };

  const runs = await prisma.productEnrichmentRun.findMany({
    where,
    select: { id: true },
  });

  const runIds = runs.map((run) => run.id);
  let updatedRuns = 0;
  let deletedRuns = 0;
  let deletedItems = 0;
  let retriedItems = 0;

  if (runIds.length) {
    if (mode === "pause") {
      const now = new Date();
      const paused = await prisma.productEnrichmentRun.updateMany({
        where: { id: { in: runIds } },
        data: { status: "paused", updatedAt: now },
      });
      updatedRuns = paused.count;
      await prisma.productEnrichmentItem.updateMany({
        where: { runId: { in: runIds }, status: { in: ["queued", "in_progress"] } },
        data: { status: "pending", startedAt: null, updatedAt: now },
      });
    } else if (mode === "retry_failed") {
      const now = new Date();
      const attemptLimit = Math.max(
        1,
        Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 3),
      );
      const items = await prisma.productEnrichmentItem.updateMany({
        where: {
          runId: { in: runIds },
          status: "failed",
          attempts: { gte: attemptLimit },
        },
        data: {
          status: "pending",
          attempts: 0,
          lastError: null,
          lastStage: null,
          startedAt: null,
          updatedAt: now,
        },
      });
      retriedItems = items.count;
      const resumed = await prisma.productEnrichmentRun.updateMany({
        where: { id: { in: runIds } },
        data: {
          status: "processing",
          blockReason: null,
          lastError: null,
          consecutiveErrors: 0,
          finishedAt: null,
          updatedAt: now,
        },
      });
      updatedRuns = resumed.count;
    } else {
      const items = await prisma.productEnrichmentItem.deleteMany({
        where: { runId: { in: runIds } },
      });
      deletedItems = items.count;
      const runsDeleted = await prisma.productEnrichmentRun.deleteMany({
        where: { id: { in: runIds } },
      });
      deletedRuns = runsDeleted.count;
    }
  }

  const queueResult = await clearEnrichmentQueue();

  return NextResponse.json({
    scope,
    brandId,
    mode,
    runIds,
    updatedRuns,
    deletedRuns,
    deletedItems,
    retriedItems,
    queueCleared: queueResult.cleared,
    queueReason: queueResult.cleared ? null : queueResult.reason,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
