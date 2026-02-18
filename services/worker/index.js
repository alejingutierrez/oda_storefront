import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };
const queueName = process.env.WORK_QUEUE || 'ingestion';

const redis = new IORedis(connection.url);
const heartbeatEnabled = process.env.WORKER_HEARTBEAT_DISABLED !== 'true';
const heartbeatTtlSeconds = Math.max(
  10,
  Number(process.env.WORKER_HEARTBEAT_TTL_SECONDS || 60),
);
const heartbeatIntervalMs = Math.max(
  5000,
  Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 20000),
);

let lastCatalogSuccessAt = 0;
let lastEnrichSuccessAt = 0;

const writeHeartbeats = async () => {
  if (!heartbeatEnabled) return;
  const now = Date.now();
  const healthyWindowMs = heartbeatTtlSeconds * 1000;
  const ops = [];
  if (lastCatalogSuccessAt && now - lastCatalogSuccessAt < healthyWindowMs) {
    ops.push(redis.set('workers:catalog:alive', '1', 'EX', heartbeatTtlSeconds));
  }
  if (lastEnrichSuccessAt && now - lastEnrichSuccessAt < healthyWindowMs) {
    ops.push(redis.set('workers:enrich:alive', '1', 'EX', heartbeatTtlSeconds));
  }
  if (!ops.length) return;
  await Promise.all(ops);
};

writeHeartbeats().catch((err) => console.error('[worker] heartbeat failed', err));
const heartbeatTimer = setInterval(() => {
  writeHeartbeats().catch((err) => console.error('[worker] heartbeat failed', err));
}, heartbeatIntervalMs);

const queue = new Queue(queueName, { connection });

const worker = new Worker(
  queueName,
  async (job) => {
    console.log('[worker-stub] processing job', job.id, job.name);
    // Placeholder: real pipeline will call GPT-5.1 and persist in Neon.
  },
  { connection },
);

worker.on('completed', (job) => console.log('[worker-stub] completed', job.id));
worker.on('failed', (job, err) => console.error('[worker-stub] failed', job?.id, err));

const catalogQueueName = process.env.CATALOG_QUEUE_NAME || 'catalog';
const catalogConcurrency = Number(process.env.CATALOG_WORKER_CONCURRENCY || 5);
const catalogWorker = new Worker(
  catalogQueueName,
  async (job) => {
    const itemId = job.data?.itemId;
    if (!itemId) return;
    const endpoint =
      process.env.CATALOG_WORKER_API_URL ||
      'http://web:3000/api/admin/catalog-extractor/process-item';
    const token = process.env.ADMIN_TOKEN || process.env.NEXTAUTH_SECRET || '';
    if (!token) throw new Error('Missing ADMIN_TOKEN for catalog worker');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) {
      throw new Error(`catalog worker failed: ${res.status}`);
    }
    const payload = await res.json().catch(() => ({}));
    if (payload.status === 'failed') {
      throw new Error(payload.error || 'catalog worker error');
    }
  },
  { connection, concurrency: catalogConcurrency },
);

catalogWorker.on('completed', (job) => console.log('[catalog-worker] completed', job.id));
catalogWorker.on('failed', (job, err) => console.error('[catalog-worker] failed', job?.id, err));
catalogWorker.on('completed', () => {
  lastCatalogSuccessAt = Date.now();
});

const enrichmentQueueName = process.env.PRODUCT_ENRICHMENT_QUEUE_NAME || 'product-enrichment';
const enrichmentConcurrency = Math.max(
  20,
  Number(process.env.PRODUCT_ENRICHMENT_WORKER_CONCURRENCY || 20),
);
const enrichmentWorker = new Worker(
  enrichmentQueueName,
  async (job) => {
    const itemId = job.data?.itemId;
    if (!itemId) return;
    const endpoint =
      process.env.PRODUCT_ENRICHMENT_WORKER_API_URL ||
      'http://web:3000/api/admin/product-enrichment/process-item';
    const token = process.env.ADMIN_TOKEN || process.env.NEXTAUTH_SECRET || '';
    if (!token) throw new Error('Missing ADMIN_TOKEN for product enrichment worker');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) {
      throw new Error(`product enrichment worker failed: ${res.status}`);
    }
    const payload = await res.json().catch(() => ({}));
    if (payload.status === 'failed') {
      throw new Error(payload.error || 'product enrichment worker error');
    }
  },
  { connection, concurrency: enrichmentConcurrency },
);

enrichmentWorker.on('completed', (job) => console.log('[product-enrichment-worker] completed', job.id));
enrichmentWorker.on('failed', (job, err) => console.error('[product-enrichment-worker] failed', job?.id, err));
enrichmentWorker.on('completed', () => {
  lastEnrichSuccessAt = Date.now();
});

const plpSeoQueueName = process.env.PLP_SEO_QUEUE_NAME || 'plp-seo';
const plpSeoConcurrency = Number(process.env.PLP_SEO_WORKER_CONCURRENCY || 5);
const plpSeoWorker = new Worker(
  plpSeoQueueName,
  async (job) => {
    const itemId = job.data?.itemId;
    if (!itemId) return;
    const endpoint =
      process.env.PLP_SEO_WORKER_API_URL ||
      'http://web:3000/api/admin/plp-seo/process-item';
    const token = process.env.ADMIN_TOKEN || process.env.NEXTAUTH_SECRET || '';
    if (!token) throw new Error('Missing ADMIN_TOKEN for PLP SEO worker');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) {
      throw new Error(`plp-seo worker failed: ${res.status}`);
    }
    const payload = await res.json().catch(() => ({}));
    if (payload.status === 'failed') {
      throw new Error(payload.error || 'plp-seo worker error');
    }
  },
  { connection, concurrency: plpSeoConcurrency },
);

plpSeoWorker.on('completed', (job) => console.log('[plp-seo-worker] completed', job.id));
plpSeoWorker.on('failed', (job, err) => console.error('[plp-seo-worker] failed', job?.id, err));

// seed a demo job
queue.add('demo', { hello: 'world' }).catch((err) => console.error('queue add error', err));

const shutdown = async (signal) => {
  console.log(`[worker] shutdown requested (${signal})`);
  clearInterval(heartbeatTimer);
  await Promise.allSettled([
    worker.close(),
    catalogWorker.close(),
    enrichmentWorker.close(),
    plpSeoWorker.close(),
    queue.close(),
    redis.quit(),
  ]);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
