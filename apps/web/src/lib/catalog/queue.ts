import { Queue } from "bullmq";

const queueName = process.env.CATALOG_QUEUE_NAME ?? "catalog";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

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

  try {
    await queue.addBulk(jobs);
  } catch (error) {
    const results = await Promise.allSettled(
      jobs.map((job) =>
        queue.add(job.name, job.data, {
          jobId: job.jobId,
          removeOnComplete: true,
          removeOnFail: true,
        }),
      ),
    );
    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length) {
      throw new Error(`Failed to enqueue ${rejected.length} catalog jobs`);
    }
  }
};
