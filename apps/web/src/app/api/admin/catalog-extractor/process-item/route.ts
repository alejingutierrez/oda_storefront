import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { getCatalogAdapter } from "@/lib/catalog/registry";
import { processCatalogRef } from "@/lib/catalog/extractor";
import { CATALOG_MAX_ATTEMPTS, getCatalogConsecutiveErrorLimit } from "@/lib/catalog/constants";
import { enqueueCatalogItems } from "@/lib/catalog/queue";
import { listPendingItems, markItemsQueued, resetQueuedItems, resetStuckItems } from "@/lib/catalog/run-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const itemId = typeof body?.itemId === "string" ? body.itemId : null;
  if (!itemId) {
    return NextResponse.json({ error: "missing_item" }, { status: 400 });
  }

  const item = await prisma.catalogItem.findUnique({
    where: { id: itemId },
    include: { run: { include: { brand: true } } },
  });
  if (!item) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const run = item.run;
  if (!run || run.status !== "processing") {
    if (item.status === "queued" || item.status === "in_progress") {
      await prisma.catalogItem.update({
        where: { id: item.id },
        data: { status: "pending", updatedAt: new Date() },
      });
    }
    return NextResponse.json({ status: "skipped", reason: run?.status ?? "missing_run" });
  }
  if (item.status === "completed") {
    return NextResponse.json({ status: "already_completed" });
  }
  if (item.attempts >= CATALOG_MAX_ATTEMPTS) {
    return NextResponse.json({ status: "max_attempts" });
  }

  const brand = run.brand;
  if (!brand?.siteUrl) {
    await prisma.catalogItem.update({
      where: { id: item.id },
      data: { status: "failed", attempts: item.attempts + 1, lastError: "missing_site_url" },
    });
    return NextResponse.json({ status: "failed", error: "missing_site_url" });
  }

  const adapter = getCatalogAdapter(run.platform ?? brand.ecommercePlatform);
  const ctx = {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: run.platform ?? brand.ecommercePlatform,
    },
  };
  const canUseLlmPdp =
    process.env.CATALOG_PDP_LLM_ENABLED !== "false" &&
    (adapter.platform === "custom" || (brand.ecommercePlatform ?? "").toLowerCase() === "unknown");
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const queuedStaleMs = Math.max(
    0,
    Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
  );
  const stuckMs = Math.max(
    0,
    Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );

  const now = new Date();
  await prisma.catalogItem.update({
    where: { id: item.id },
    data: { status: "in_progress", startedAt: now, updatedAt: now },
  });

  let lastStage: string | null = null;
  try {
    const result = await processCatalogRef({
      brand: { id: brand.id, slug: brand.slug },
      adapter,
      ctx,
      ref: { url: item.url },
      canUseLlmPdp,
      onStage: (stage) => {
        lastStage = stage;
      },
    });

    await prisma.catalogItem.update({
      where: { id: item.id },
      data: {
        status: "completed",
        attempts: item.attempts + 1,
        lastError: null,
        lastStage: lastStage ?? "completed",
        completedAt: new Date(),
      },
    });

    await prisma.catalogRun.update({
      where: { id: run.id },
      data: {
        lastUrl: item.url,
        lastStage: lastStage ?? "completed",
        lastError: null,
        consecutiveErrors: 0,
        updatedAt: new Date(),
      },
    });

    await resetQueuedItems(run.id, queuedStaleMs);
    await resetStuckItems(run.id, stuckMs);
    const remaining = await prisma.catalogItem.count({
      where: {
        runId: run.id,
        status: { in: ["pending", "queued", "in_progress", "failed"] },
        attempts: { lt: CATALOG_MAX_ATTEMPTS },
      },
    });
    if (remaining === 0) {
      await prisma.catalogRun.update({
        where: { id: run.id },
        data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      const pendingItems = await listPendingItems(run.id, enqueueLimit);
      await markItemsQueued(pendingItems.map((candidate) => candidate.id));
      await enqueueCatalogItems(pendingItems);
    }

    return NextResponse.json({ status: "completed", created: result.created, createdVariants: result.createdVariants });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts + 1;
    await prisma.catalogItem.update({
      where: { id: item.id },
      data: {
        status: "failed",
        attempts,
        lastError: message,
        lastStage: lastStage ?? "error",
      },
    });

    const consecutiveErrors = (run.consecutiveErrors ?? 0) + 1;
    const limit = getCatalogConsecutiveErrorLimit();
    const shouldPause = consecutiveErrors >= limit;

    await prisma.catalogRun.update({
      where: { id: run.id },
      data: {
        lastUrl: item.url,
        lastStage: lastStage ?? "error",
        lastError: message,
        blockReason: shouldPause ? `consecutive_errors:${consecutiveErrors}` : run.blockReason,
        consecutiveErrors,
        status: shouldPause ? "paused" : run.status,
        updatedAt: new Date(),
      },
    });

    if (!shouldPause) {
      await resetQueuedItems(run.id, queuedStaleMs);
      await resetStuckItems(run.id, stuckMs);
      const remaining = await prisma.catalogItem.count({
        where: {
          runId: run.id,
          status: { in: ["pending", "queued", "in_progress", "failed"] },
          attempts: { lt: CATALOG_MAX_ATTEMPTS },
        },
      });
      if (remaining === 0) {
        await prisma.catalogRun.update({
          where: { id: run.id },
          data: { status: "completed", finishedAt: new Date(), updatedAt: new Date() },
        });
      } else {
        const pendingItems = await listPendingItems(run.id, enqueueLimit);
        await markItemsQueued(pendingItems.map((candidate) => candidate.id));
        await enqueueCatalogItems(pendingItems);
      }
    }

    return NextResponse.json({ status: "failed", error: message });
  }
}
