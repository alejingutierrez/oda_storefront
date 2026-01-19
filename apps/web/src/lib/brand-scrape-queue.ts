import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runBrandScrapeJob } from "@/lib/brand-scrape";

export type BrandScrapeResult = {
  status: "completed" | "failed" | "empty";
  jobId?: string;
  brandId?: string;
  brandName?: string;
  changes?: Array<{ field: string; before: unknown; after: unknown }>;
  error?: string;
};

export async function processNextBrandScrapeJob(): Promise<BrandScrapeResult> {
  const job = await prisma.brandScrapeJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return { status: "empty" };
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
          changes: result.changes ?? [],
          before: result.before ?? null,
          after: result.after ?? null,
          sources: result.enrichment.sources ?? null,
          usage: result.enrichment.usage ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      status: "completed",
      jobId: job.id,
      brandId: result.updated.id,
      brandName: result.updated.name,
      changes: result.changes,
    };
  } catch (error) {
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: String(error),
        result: {
          error: String(error),
        } as Prisma.InputJsonValue,
      },
    });

    return { status: "failed", jobId: job.id, error: String(error) };
  }
}

export async function processBrandScrapeBatch({
  maxJobs,
  maxRuntimeMs,
}: {
  maxJobs: number;
  maxRuntimeMs: number;
}) {
  const startedAt = Date.now();
  const results: BrandScrapeResult[] = [];

  for (let i = 0; i < maxJobs; i += 1) {
    if (Date.now() - startedAt > maxRuntimeMs) break;
    const result = await processNextBrandScrapeJob();
    results.push(result);
    if (result.status === "empty") break;
    if (result.status === "failed") break;
  }

  return results;
}
