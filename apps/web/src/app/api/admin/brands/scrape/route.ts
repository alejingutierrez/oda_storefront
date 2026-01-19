import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

const ALLOWED_COUNTS = new Set([1, 5, 10, 25, 50]);

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const counts = await prisma.brandScrapeJob.groupBy({
    by: ["status"],
    _count: true,
  });

  const summary = counts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count;
    return acc;
  }, {});

  const queued = await prisma.brandScrapeJob.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 8,
    include: {
      brand: { select: { id: true, name: true, slug: true } },
    },
  });

  const processing = await prisma.brandScrapeJob.findFirst({
    where: { status: "processing" },
    orderBy: { startedAt: "desc" },
    include: {
      brand: { select: { id: true, name: true, slug: true } },
    },
  });

  return NextResponse.json({
    counts: summary,
    queued,
    processing,
  });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const count = typeof body?.count === "number" ? body.count : 0;

  if (!ALLOWED_COUNTS.has(count)) {
    return NextResponse.json({ error: "invalid_count" }, { status: 400 });
  }

  const inQueue = await prisma.brandScrapeJob.findMany({
    where: { status: { in: ["queued", "processing"] } },
    select: { brandId: true },
  });

  const queuedIds = inQueue.map((job) => job.brandId);

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      id: queuedIds.length ? { notIn: queuedIds } : undefined,
    },
    orderBy: { updatedAt: "asc" },
    take: count,
    select: { id: true, name: true, slug: true },
  });

  if (!brands.length) {
    return NextResponse.json({ batchId: null, enqueued: 0, brands: [] });
  }

  const batchId = crypto.randomUUID();
  await prisma.brandScrapeJob.createMany({
    data: brands.map((brand) => ({
      brandId: brand.id,
      batchId,
      status: "queued",
    })),
  });

  return NextResponse.json({ batchId, enqueued: brands.length, brands });
}
