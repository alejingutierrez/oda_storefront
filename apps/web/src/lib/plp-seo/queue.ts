import { Queue } from "bullmq";

const queueName = process.env.PLP_SEO_QUEUE_NAME ?? "plp-seo";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const queueTimeoutMs = Math.max(1000, Number(process.env.PLP_SEO_QUEUE_TIMEOUT_MS ?? 8000));

export const isPlpSeoQueueEnabled = () => {
  if (process.env.PLP_SEO_QUEUE_DISABLED === "true") return false;
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

let plpSeoQueue: Queue | null = null;

export const getPlpSeoQueue = () => {
  if (!plpSeoQueue) {
    plpSeoQueue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }
  return plpSeoQueue;
};

export const enqueuePlpSeoItems = async (items: Array<{ id: string }>) => {
  if (!items.length) return;
  const queue = getPlpSeoQueue();
  const jobs = items.map((item) => ({
    name: "plp-seo",
    data: { itemId: item.id },
    opts: {
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
    await withTimeout(queue.addBulk(jobs), "plpSeo.queue.addBulk");
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
      "plpSeo.queue.add",
    );
    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length) {
      throw new Error(`Failed to enqueue ${rejected.length} plp-seo jobs`);
    }
  }
};

