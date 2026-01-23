import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import { enqueueCatalogItems } from "@/lib/catalog/queue";
import {
  createRunWithItems,
  findActiveRun,
  listPendingItems,
  markItemsQueued,
  resetQueuedItems,
  resetStuckItems,
  summarizeRun,
} from "@/lib/catalog/run-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const batchSize = Number(body?.batchSize ?? body?.limit ?? 1);
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

  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || !brand.siteUrl) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }

    const existing = await findActiveRun(brandId);
    if (existing) {
      if (existing.status === "paused" || existing.status === "stopped") {
        await prisma.catalogRun.update({
          where: { id: existing.id },
          data: { status: "processing", updatedAt: new Date() },
        });
      }
      await resetQueuedItems(existing.id, queuedStaleMs);
      await resetStuckItems(existing.id, stuckMs);
      const pendingItems = await listPendingItems(
        existing.id,
        Number.isFinite(batchSize) ? Math.max(batchSize, enqueueLimit) : enqueueLimit,
      );
      await markItemsQueued(pendingItems.map((item) => item.id));
      await enqueueCatalogItems(pendingItems);
      const summary = await summarizeRun(existing.id);
      return NextResponse.json({ summary });
    }

    const { refs, platformForRun } = await discoverCatalogRefs({
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        siteUrl: brand.siteUrl,
        ecommercePlatform: brand.ecommercePlatform,
      },
      limit: Number.isFinite(batchSize) ? Math.max(10, batchSize * 10) : 50,
      forceSitemap: true,
    });

    if (!refs.length) {
      const run = await prisma.catalogRun.create({
        data: {
          brandId: brand.id,
          status: "blocked",
          platform: platformForRun ?? brand.ecommercePlatform,
          totalItems: 0,
          lastError: "manual_review_no_products",
          blockReason: "manual_review_no_products",
        },
      });
      await prisma.brand.update({
        where: { id: brand.id },
        data: { manualReview: true },
      });
      const summary = await summarizeRun(run.id);
      return NextResponse.json({ summary });
    }

    const run = await createRunWithItems({
      brandId: brand.id,
      platform: platformForRun ?? brand.ecommercePlatform,
      refs,
      status: "processing",
    });
    const items = await listPendingItems(
      run.id,
      Number.isFinite(batchSize) ? Math.max(batchSize, enqueueLimit) : enqueueLimit,
    );
    await markItemsQueued(items.map((item) => item.id));
    await enqueueCatalogItems(items);
    const summary = await summarizeRun(run.id);
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}
