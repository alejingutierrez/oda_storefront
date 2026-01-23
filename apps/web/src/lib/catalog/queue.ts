import { Queue } from "bullmq";

const queueName = process.env.CATALOG_QUEUE_NAME ?? "catalog";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const queueTimeoutMs = Math.max(1000, Number(process.env.CATALOG_QUEUE_TIMEOUT_MS ?? 8000));

let catalogQueue: Queue | null = null;

export const getCatalogQueue = () => {
  if (!catalogQueue) {
    catalogQueue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
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
