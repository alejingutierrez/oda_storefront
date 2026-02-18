import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer repo root .env so `cd services/worker && npm start` works locally.
dotenv.config({ path: path.join(__dirname, '../../.env') });
// Allow a local override in services/worker/.env if present.
dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: redisUrl };

const redis = new IORedis(redisUrl);
redis.on('error', (err) => console.error('[worker] redis error', err));

const startedAtIso = new Date().toISOString();
const hostname = os.hostname();
const pid = process.pid;

const heartbeatEnabled = process.env.WORKER_HEARTBEAT_DISABLED !== 'true';
const heartbeatTtlSeconds = Math.max(
  10,
  Number(process.env.WORKER_HEARTBEAT_TTL_SECONDS || 60),
);
const heartbeatIntervalMs = Math.max(
  5000,
  Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 20000),
);

const catalogEnabled = process.env.CATALOG_WORKER_DISABLED !== 'true';
const enrichEnabled = process.env.PRODUCT_ENRICHMENT_WORKER_DISABLED !== 'true';
const plpSeoEnabled = process.env.PLP_SEO_WORKER_DISABLED !== 'true';

const adminToken = process.env.ADMIN_TOKEN || '';

if ((catalogEnabled || enrichEnabled || plpSeoEnabled) && !adminToken) {
  throw new Error('Missing ADMIN_TOKEN for BullMQ workers');
}

const fetchTimeoutMs = Math.max(
  5000,
  Number(process.env.WORKER_FETCH_TIMEOUT_MS || 60000),
);

let lastCatalogCompletedAtIso = null;
let lastEnrichCompletedAtIso = null;
let lastPlpSeoCompletedAtIso = null;

const writeHeartbeats = async () => {
  if (!heartbeatEnabled) return;
  const payload = JSON.stringify({
    pid,
    hostname,
    startedAt: startedAtIso,
    now: new Date().toISOString(),
    lastCompletedAt: {
      catalog: lastCatalogCompletedAtIso,
      enrich: lastEnrichCompletedAtIso,
      plpSeo: lastPlpSeoCompletedAtIso,
    },
  });

  const ops = [];
  if (catalogEnabled) {
    ops.push(redis.set('workers:catalog:alive', payload, 'EX', heartbeatTtlSeconds));
  }
  if (enrichEnabled) {
    ops.push(redis.set('workers:enrich:alive', payload, 'EX', heartbeatTtlSeconds));
  }
  if (!ops.length) return;
  await Promise.all(ops);
};

writeHeartbeats().catch((err) => console.error('[worker] heartbeat failed', err));
const heartbeatTimer = setInterval(() => {
  writeHeartbeats().catch((err) => console.error('[worker] heartbeat failed', err));
}, heartbeatIntervalMs);

const postAdminJson = async (endpoint, body) => {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });

  const text = await res.text().catch(() => '');
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const snippet = text ? ` body=${text.slice(0, 500)}` : '';
    throw new Error(
      `worker request failed: status=${res.status} endpoint=${endpoint}${snippet}`,
    );
  }

  if (payload?.status === 'failed') {
    throw new Error(payload.error || payload.lastError || 'worker payload status=failed');
  }

  return payload;
};

const catalogQueueName = process.env.CATALOG_QUEUE_NAME || 'catalog';
const catalogConcurrency = Math.max(1, Number(process.env.CATALOG_WORKER_CONCURRENCY || 10));
const catalogEndpoint =
  process.env.CATALOG_WORKER_API_URL ||
  'http://localhost:3000/api/admin/catalog-extractor/process-item';

const catalogWorker = catalogEnabled
  ? new Worker(
      catalogQueueName,
      async (job) => {
        const itemId = job.data?.itemId;
        if (!itemId) return;
        await postAdminJson(catalogEndpoint, { itemId });
      },
      { connection, concurrency: catalogConcurrency },
    )
  : null;

catalogWorker?.on('completed', (job) => console.log('[catalog-worker] completed', job.id));
catalogWorker?.on('failed', (job, err) => console.error('[catalog-worker] failed', job?.id, err));
catalogWorker?.on('completed', () => {
  lastCatalogCompletedAtIso = new Date().toISOString();
});

const enrichmentQueueName = process.env.PRODUCT_ENRICHMENT_QUEUE_NAME || 'product-enrichment';
const enrichmentConcurrency = Math.max(
  1,
  Number(process.env.PRODUCT_ENRICHMENT_WORKER_CONCURRENCY || 30),
);
const enrichmentEndpoint =
  process.env.PRODUCT_ENRICHMENT_WORKER_API_URL ||
  'http://localhost:3000/api/admin/product-enrichment/process-item';

const enrichmentWorker = enrichEnabled
  ? new Worker(
      enrichmentQueueName,
      async (job) => {
        const itemId = job.data?.itemId;
        if (!itemId) return;
        await postAdminJson(enrichmentEndpoint, { itemId });
      },
      { connection, concurrency: enrichmentConcurrency },
    )
  : null;

enrichmentWorker?.on('completed', (job) =>
  console.log('[product-enrichment-worker] completed', job.id),
);
enrichmentWorker?.on('failed', (job, err) =>
  console.error('[product-enrichment-worker] failed', job?.id, err),
);
enrichmentWorker?.on('completed', () => {
  lastEnrichCompletedAtIso = new Date().toISOString();
});

const plpSeoQueueName = process.env.PLP_SEO_QUEUE_NAME || 'plp-seo';
const plpSeoConcurrency = Math.max(1, Number(process.env.PLP_SEO_WORKER_CONCURRENCY || 5));
const plpSeoEndpoint =
  process.env.PLP_SEO_WORKER_API_URL ||
  'http://localhost:3000/api/admin/plp-seo/process-item';

const plpSeoWorker = plpSeoEnabled
  ? new Worker(
      plpSeoQueueName,
      async (job) => {
        const itemId = job.data?.itemId;
        if (!itemId) return;
        await postAdminJson(plpSeoEndpoint, { itemId });
      },
      { connection, concurrency: plpSeoConcurrency },
    )
  : null;

plpSeoWorker?.on('completed', (job) => console.log('[plp-seo-worker] completed', job.id));
plpSeoWorker?.on('failed', (job, err) => console.error('[plp-seo-worker] failed', job?.id, err));
plpSeoWorker?.on('completed', () => {
  lastPlpSeoCompletedAtIso = new Date().toISOString();
});

const shutdown = async (signal) => {
  console.log(`[worker] shutdown requested (${signal})`);
  clearInterval(heartbeatTimer);
  await Promise.allSettled([
    catalogWorker?.close(),
    enrichmentWorker?.close(),
    plpSeoWorker?.close(),
    redis.quit(),
  ]);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[worker] unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('[worker] uncaughtException', err));

