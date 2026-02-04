import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { findActiveRun, markRunStatus } from "@/lib/catalog/run-store";
import { getCatalogQueue, isCatalogQueueEnabled } from "@/lib/catalog/queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const run = await findActiveRun(brandId);
  if (!run) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  await markRunStatus(run.id, "stopped");
  const queuedItems = await prisma.catalogItem.findMany({
    where: { runId: run.id, status: "queued" },
    select: { id: true },
  });
  await prisma.catalogItem.updateMany({
    where: { runId: run.id, status: { in: ["queued", "in_progress"] } },
    data: { status: "pending", startedAt: null, updatedAt: new Date() },
  });
  if (queuedItems.length && isCatalogQueueEnabled()) {
    const queue = getCatalogQueue();
    const jobIds = queuedItems.map((item) => item.id);
    const removeJobs = (queue as any).removeJobs as ((ids: string[]) => Promise<void>) | undefined;
    try {
      if (removeJobs) {
        await removeJobs.call(queue, jobIds);
      } else {
        await Promise.allSettled(jobIds.map((id) => queue.remove(id)));
      }
    } catch (error) {
      console.warn("catalog.stop.remove_jobs_failed", error);
    }
  }
  return NextResponse.json({ status: "stopped" });
}
