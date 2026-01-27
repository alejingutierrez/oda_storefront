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

const getStaleThreshold = () => {
  const rawMinutes = Number(process.env.BRAND_SCRAPE_STALE_MINUTES ?? 20);
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 20;
  return new Date(Date.now() - minutes * 60 * 1000);
};

export async function recoverStaleBrandScrapeJobs() {
  const threshold = getStaleThreshold();
  const result = await prisma.brandScrapeJob.updateMany({
    where: {
      status: "processing",
      OR: [{ startedAt: { lt: threshold } }, { startedAt: null }],
    },
    data: {
      status: "queued",
      startedAt: null,
      finishedAt: null,
      lastError: "stale_reset",
    },
  });

  return result.count;
}

export async function processNextBrandScrapeJob(
  batchId?: string | null,
): Promise<BrandScrapeResult> {
  await recoverStaleBrandScrapeJobs();

  const job = await prisma.brandScrapeJob.findFirst({
    where: {
      status: "queued",
      ...(batchId ? { batchId } : {}),
    },
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
          searchSources: result.enrichment.searchSources ?? null,
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
  const maxFailuresRaw = Number(process.env.BRAND_SCRAPE_MAX_FAILURES ?? 3);
  const maxFailures =
    Number.isFinite(maxFailuresRaw) && maxFailuresRaw > 0 ? maxFailuresRaw : 3;
  let consecutiveFailures = 0;
  const startedAt = Date.now();
  const results: BrandScrapeResult[] = [];

  for (let i = 0; i < maxJobs; i += 1) {
    if (Date.now() - startedAt > maxRuntimeMs) break;
    const result = await processNextBrandScrapeJob();
    results.push(result);
    if (result.status === "empty") break;
    if (result.status === "failed") {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxFailures) break;
    } else {
      consecutiveFailures = 0;
    }
  }

  return results;
}
