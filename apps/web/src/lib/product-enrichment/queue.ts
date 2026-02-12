import { Queue } from "bullmq";

const queueName = process.env.PRODUCT_ENRICHMENT_QUEUE_NAME ?? "product-enrichment";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const queueTimeoutMs = Math.max(
  1000,
  Number(process.env.PRODUCT_ENRICHMENT_QUEUE_TIMEOUT_MS ?? 8000),
);

export const isEnrichmentQueueEnabled = () => {
  if (process.env.PRODUCT_ENRICHMENT_QUEUE_DISABLED === "true") return false;
  const url = process.env.REDIS_URL ?? "";
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    if (process.env.VERCEL) {
      if (!hostname) return false;
      const host = hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "redis") {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
};

let enrichmentQueue: Queue | null = null;

export const getEnrichmentQueue = () => {
  if (!enrichmentQueue) {
    enrichmentQueue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }
  return enrichmentQueue;
};

export const enqueueEnrichmentItems = async (items: Array<{ id: string }>) => {
  if (!items.length) return;
  const queue = getEnrichmentQueue();
  const jobs = items.map((item) => ({
    name: "product-enrichment",
    data: { itemId: item.id },
    opts: {
      // Ensure idempotency: re-enqueueing the same item should not create duplicates.
      jobId: item.id,
      removeOnComplete: true,
      removeOnFail: true,
    },
  }));

  const withTimeout = async <T>(promise: Promise<T>, label: string) => {
    let timeout: NodeJS.Timeout | null = null;
    const timer = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out`)), queueTimeoutMs);
    });
    try {
      return await Promise.race([promise, timer]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  try {
    await withTimeout(queue.addBulk(jobs), "enrichment.queue.addBulk");
  } catch {
    const results = await withTimeout(
      Promise.allSettled(
        jobs.map((job) =>
          queue.add(job.name, job.data, {
            jobId: job.opts.jobId,
            removeOnComplete: true,
            removeOnFail: true,
          }),
        ),
      ),
      "enrichment.queue.add",
    );
    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length) {
      throw new Error(`Failed to enqueue ${rejected.length} enrichment jobs`);
    }
  }
};

export const clearEnrichmentQueue = async () => {
  if (!isEnrichmentQueueEnabled()) {
    return { cleared: false, reason: "queue_disabled" as const };
  }
  try {
    const queue = getEnrichmentQueue();
    await queue.obliterate({ force: true });
    return { cleared: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { cleared: false as const, reason: message };
  }
};
