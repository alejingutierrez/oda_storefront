import { Queue } from "bullmq";

const queueName = process.env.CATALOG_QUEUE_NAME ?? "catalog";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

let catalogQueue: Queue | null = null;

export const getCatalogQueue = () => {
  if (!catalogQueue) {
    catalogQueue = new Queue(queueName, { connection });
  }
  return catalogQueue;
};

export const enqueueCatalogItems = async (items: Array<{ id: string }>) => {
  if (!items.length) return;
  const queue = getCatalogQueue();
  await queue.addBulk(
    items.map((item) => ({
      name: "catalog-item",
      data: { itemId: item.id },
      jobId: item.id,
    })),
  );
};
