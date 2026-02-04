import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { runBrandScrapeJobV2 } from "@/lib/brand-scrape";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ brandId: string }>;
};

export async function POST(req: NextRequest, { params }: RouteParams) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { brandId } = await params;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const inProgress = await prisma.brandScrapeJob.findFirst({
    where: {
      brandId,
      status: { in: ["queued", "processing"] },
    },
    select: { id: true, status: true },
  });

  if (inProgress) {
    return NextResponse.json({ error: "job_in_progress" }, { status: 409 });
  }

  const job = await prisma.brandScrapeJob.create({
    data: {
      brandId,
      status: "processing",
      startedAt: new Date(),
      attempts: 1,
      result: { method: "v2" } as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await runBrandScrapeJobV2(brandId);
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        result: {
          method: "v2",
          brandId: result.updated.id,
          brandName: result.updated.name,
          changes: result.changes ?? [],
          before: result.before ?? null,
          after: result.after ?? null,
          sources: result.enrichment.sources ?? null,
          searchSources: result.enrichment.searchSources ?? null,
          evidenceSources: result.enrichment.evidenceSources ?? null,
          usage: result.enrichment.usage ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      status: "completed",
      jobId: job.id,
      brandId: result.updated.id,
      brandName: result.updated.name,
      changes: result.changes ?? [],
    });
  } catch (error) {
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: String(error),
        result: {
          method: "v2",
          error: String(error),
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json(
      { error: String(error), jobId: job.id },
      { status: 500 },
    );
  }
}
