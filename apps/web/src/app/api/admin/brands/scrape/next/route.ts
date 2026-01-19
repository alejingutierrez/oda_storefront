import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { runBrandScrapeJob } from "@/lib/brand-scrape";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await prisma.brandScrapeJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return NextResponse.json({ status: "empty" });
  }

  await prisma.brandScrapeJob.update({
    where: { id: job.id },
    data: {
      status: "processing",
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  try {
    const result = await runBrandScrapeJob(job.brandId);
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        result: {
          brandId: result.updated.id,
          brandName: result.updated.name,
          sources: result.enrichment.sources ?? null,
          usage: result.enrichment.usage ?? null,
        },
      },
    });

    return NextResponse.json({
      status: "completed",
      jobId: job.id,
      brandId: result.updated.id,
      brandName: result.updated.name,
    });
  } catch (error) {
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: String(error),
      },
    });

    return NextResponse.json(
      { status: "failed", jobId: job.id, error: String(error) },
      { status: 500 },
    );
  }
}
