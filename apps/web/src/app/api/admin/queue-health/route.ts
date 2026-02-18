import { NextResponse } from "next/server";
import { Queue } from "bullmq";
import { validateAdminRequest } from "@/lib/auth";
import { isRedisEnabled, readHeartbeat } from "@/lib/redis";

export const runtime = "nodejs";

const connection = { url: process.env.REDIS_URL ?? "" };

const queueNames = {
  catalog: process.env.CATALOG_QUEUE_NAME ?? "catalog",
  enrichment: process.env.PRODUCT_ENRICHMENT_QUEUE_NAME ?? "product-enrichment",
  plpSeo: process.env.PLP_SEO_QUEUE_NAME ?? "plp-seo",
};

const readQueueCounts = async (name: string) => {
  const queue = new Queue(name, { connection });
  try {
    return await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
    );
  } finally {
    await queue.close().catch(() => null);
  }
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const redisEnabled = isRedisEnabled();
  const now = new Date().toISOString();

  if (!redisEnabled) {
    return NextResponse.json({
      ok: true,
      now,
      redisEnabled: false,
      workerAlive: {
        catalog: { online: false, ttlSeconds: null },
        enrich: { online: false, ttlSeconds: null },
      },
      queues: null,
    });
  }

  const [catalogAlive, enrichAlive, catalogCounts, enrichCounts, plpCounts] = await Promise.all([
    readHeartbeat("workers:catalog:alive"),
    readHeartbeat("workers:enrich:alive"),
    readQueueCounts(queueNames.catalog),
    readQueueCounts(queueNames.enrichment),
    readQueueCounts(queueNames.plpSeo),
  ]);

  return NextResponse.json({
    ok: true,
    now,
    redisEnabled: true,
    queueNames,
    workerAlive: { catalog: catalogAlive, enrich: enrichAlive },
    queues: {
      catalog: catalogCounts,
      enrichment: enrichCounts,
      plpSeo: plpCounts,
    },
  });
}

