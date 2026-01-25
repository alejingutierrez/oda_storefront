import { Queue } from "bullmq";

const queueName = process.env.CATALOG_QUEUE_NAME ?? "catalog";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const queueTimeoutMs = Math.max(1000, Number(process.env.CATALOG_QUEUE_TIMEOUT_MS ?? 8000));
const queueAttempts = Math.max(1, Number(process.env.CATALOG_QUEUE_ATTEMPTS ?? 3));
const queueBackoffMs = Math.max(200, Number(process.env.CATALOG_QUEUE_BACKOFF_MS ?? 5000));

export const isCatalogQueueEnabled = () => {
  if (process.env.CATALOG_QUEUE_DISABLED === "true") return false;
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

let catalogQueue: Queue | null = null;

export const getCatalogQueue = () => {
  if (!catalogQueue) {
    catalogQueue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: queueAttempts,
        backoff: { type: "exponential", delay: queueBackoffMs },
      },
    });
  }
  return catalogQueue;
};

export const enqueueCatalogItems = async (items: Array<{ id: string }>) => {
  if (!items.length) return;
  const queue = getCatalogQueue();
  const jobs = items.map((item) => ({
    name: "catalog-item",
    data: { itemId: item.id },
    jobId: item.id,
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
    await withTimeout(queue.addBulk(jobs), "catalog.queue.addBulk");
  } catch (error) {
    const results = await withTimeout(
      Promise.allSettled(
        jobs.map((job) =>
          queue.add(job.name, job.data, {
            jobId: job.jobId,
            removeOnComplete: true,
            removeOnFail: true,
            attempts: queueAttempts,
            backoff: { type: "exponential", delay: queueBackoffMs },
          }),
        ),
      ),
      "catalog.queue.add",
    );
    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length) {
      throw new Error(`Failed to enqueue ${rejected.length} catalog jobs`);
    }
  }
};
