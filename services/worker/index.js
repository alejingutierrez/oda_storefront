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

const parseTimeoutMs = (value, fallbackMs) => {
  if (value === undefined || value === null || value === '') return fallbackMs;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackMs;
  if (parsed <= 0) return null;
  return Math.max(10000, parsed);
};

const defaultFetchTimeoutMs = parseTimeoutMs(process.env.WORKER_FETCH_TIMEOUT_MS, null);
const catalogFetchTimeoutMs = parseTimeoutMs(
  process.env.CATALOG_WORKER_FETCH_TIMEOUT_MS,
  defaultFetchTimeoutMs,
);
const enrichmentFetchTimeoutMs = parseTimeoutMs(
  process.env.PRODUCT_ENRICHMENT_WORKER_FETCH_TIMEOUT_MS,
  defaultFetchTimeoutMs,
);
const plpSeoFetchTimeoutMs = parseTimeoutMs(
  process.env.PLP_SEO_WORKER_FETCH_TIMEOUT_MS,
  defaultFetchTimeoutMs,
);

let isShuttingDown = false;
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

const requestAdminJson = async ({ endpoint, method, body, timeoutMs }) => {
  const requestInit = {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  };
  if (body !== undefined) {
    requestInit.headers['Content-Type'] = 'application/json';
    requestInit.body = JSON.stringify(body);
  }
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    requestInit.signal = AbortSignal.timeout(timeoutMs);
  }

  const res = await fetch(endpoint, requestInit);

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

const postAdminJson = async (endpoint, body, timeoutMs) =>
  requestAdminJson({ endpoint, method: 'POST', body, timeoutMs });
const getAdminJson = async (endpoint, timeoutMs) =>
  requestAdminJson({ endpoint, method: 'GET', timeoutMs });

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
        await postAdminJson(catalogEndpoint, { itemId }, catalogFetchTimeoutMs);
      },
      { connection, concurrency: catalogConcurrency },
    )
  : null;

if (catalogWorker) {
  console.log(
    `[catalog-worker] enabled queue=${catalogQueueName} concurrency=${catalogConcurrency} endpoint=${catalogEndpoint}`,
  );
}
catalogWorker?.on('completed', (job) => console.log('[catalog-worker] completed', job.id));
catalogWorker?.on('failed', (job, err) => console.error('[catalog-worker] failed', job?.id, err));
catalogWorker?.on('error', (err) => console.error('[catalog-worker] error', err));
catalogWorker?.on('stalled', (jobId) => console.warn('[catalog-worker] stalled', jobId));
catalogWorker?.on('ready', () => console.log('[catalog-worker] ready'));
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
        await postAdminJson(enrichmentEndpoint, { itemId }, enrichmentFetchTimeoutMs);
      },
      { connection, concurrency: enrichmentConcurrency },
    )
  : null;

if (enrichmentWorker) {
  console.log(
    `[product-enrichment-worker] enabled queue=${enrichmentQueueName} concurrency=${enrichmentConcurrency} endpoint=${enrichmentEndpoint}`,
  );
}
enrichmentWorker?.on('completed', (job) =>
  console.log('[product-enrichment-worker] completed', job.id),
);
enrichmentWorker?.on('failed', (job, err) =>
  console.error('[product-enrichment-worker] failed', job?.id, err),
);
enrichmentWorker?.on('error', (err) => console.error('[product-enrichment-worker] error', err));
enrichmentWorker?.on('stalled', (jobId) => console.warn('[product-enrichment-worker] stalled', jobId));
enrichmentWorker?.on('ready', () => console.log('[product-enrichment-worker] ready'));
enrichmentWorker?.on('completed', () => {
  lastEnrichCompletedAtIso = new Date().toISOString();
});

const plpSeoQueueName = process.env.PLP_SEO_QUEUE_NAME || 'plp-seo';
const plpSeoConcurrency = Math.max(1, Number(process.env.PLP_SEO_WORKER_CONCURRENCY || 5));
const plpSeoEndpoint =
  process.env.PLP_SEO_WORKER_API_URL ||
  'http://localhost:3000/api/admin/plp-seo/process-item';

const deriveEndpoint = (fromEndpoint, pathname) => {
  if (!fromEndpoint) return null;
  try {
    const url = new URL(fromEndpoint);
    url.pathname = pathname;
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
};

const queueHealthEndpoint =
  process.env.WORKER_QUEUE_HEALTH_URL ||
  deriveEndpoint(catalogEndpoint, '/api/admin/queue-health') ||
  deriveEndpoint(enrichmentEndpoint, '/api/admin/queue-health');
const catalogDrainEndpoint =
  process.env.CATALOG_WORKER_DRAIN_URL ||
  deriveEndpoint(catalogEndpoint, '/api/admin/catalog-extractor/drain');
const enrichmentDrainEndpoint =
  process.env.PRODUCT_ENRICHMENT_WORKER_DRAIN_URL ||
  deriveEndpoint(enrichmentEndpoint, '/api/admin/product-enrichment/drain');

const autonomousEnabled =
  process.env.WORKER_AUTONOMOUS_DISABLED !== 'true' &&
  Boolean(queueHealthEndpoint) &&
  (catalogEnabled || enrichEnabled);
const autonomousIntervalMs = Math.max(
  10000,
  Number(process.env.WORKER_AUTONOMOUS_INTERVAL_MS || 30000),
);
const autonomousProbeTimeoutMs = parseTimeoutMs(
  process.env.WORKER_AUTONOMOUS_PROBE_TIMEOUT_MS,
  10000,
);
const autonomousDrainTimeoutMs = parseTimeoutMs(
  process.env.WORKER_AUTONOMOUS_DRAIN_TIMEOUT_MS,
  60000,
);
const autonomousDrainLimitCatalog = Math.max(
  1,
  Number(process.env.WORKER_AUTONOMOUS_CATALOG_LIMIT || 8),
);
const autonomousDrainLimitEnrich = Math.max(
  1,
  Number(process.env.WORKER_AUTONOMOUS_ENRICH_LIMIT || 20),
);

const plpSeoWorker = plpSeoEnabled
  ? new Worker(
      plpSeoQueueName,
      async (job) => {
        const itemId = job.data?.itemId;
        if (!itemId) return;
        await postAdminJson(plpSeoEndpoint, { itemId }, plpSeoFetchTimeoutMs);
      },
      { connection, concurrency: plpSeoConcurrency },
    )
  : null;

if (plpSeoWorker) {
  console.log(
    `[plp-seo-worker] enabled queue=${plpSeoQueueName} concurrency=${plpSeoConcurrency} endpoint=${plpSeoEndpoint}`,
  );
}
plpSeoWorker?.on('completed', (job) => console.log('[plp-seo-worker] completed', job.id));
plpSeoWorker?.on('failed', (job, err) => console.error('[plp-seo-worker] failed', job?.id, err));
plpSeoWorker?.on('error', (err) => console.error('[plp-seo-worker] error', err));
plpSeoWorker?.on('stalled', (jobId) => console.warn('[plp-seo-worker] stalled', jobId));
plpSeoWorker?.on('ready', () => console.log('[plp-seo-worker] ready'));
plpSeoWorker?.on('completed', () => {
  lastPlpSeoCompletedAtIso = new Date().toISOString();
});

let autonomousTickInFlight = false;
const runAutonomousTick = async () => {
  if (!autonomousEnabled || autonomousTickInFlight || isShuttingDown) return;
  autonomousTickInFlight = true;
  try {
    const health = await getAdminJson(queueHealthEndpoint, autonomousProbeTimeoutMs);
    const workerStatus = (health?.workerStatus ?? {});
    const actions = [];

    if (catalogEnabled && catalogDrainEndpoint) {
      const catalogStatus = workerStatus.catalog ?? {};
      const reason = catalogStatus.queueEmptyButDbRunnable
        ? 'queue_empty_db_runnable'
        : catalogStatus.staleNoProgress
          ? 'stale_no_progress'
          : null;
      if (reason) {
        actions.push({
          queue: 'catalog',
          endpoint: catalogDrainEndpoint,
          reason,
          limit: autonomousDrainLimitCatalog,
        });
      }
    }

    if (enrichEnabled && enrichmentDrainEndpoint) {
      const enrichStatus = workerStatus.enrich ?? workerStatus.enrichment ?? {};
      const reason = enrichStatus.queueEmptyButDbRunnable
        ? 'queue_empty_db_runnable'
        : enrichStatus.staleNoProgress
          ? 'stale_no_progress'
          : null;
      if (reason) {
        actions.push({
          queue: 'enrichment',
          endpoint: enrichmentDrainEndpoint,
          reason,
          limit: autonomousDrainLimitEnrich,
        });
      }
    }

    for (const action of actions) {
      const payload = await postAdminJson(
        action.endpoint,
        {
          limit: action.limit,
          maxMs: autonomousDrainTimeoutMs ?? 60000,
          maxRuns: 1,
        },
        autonomousDrainTimeoutMs,
      );
      if ((payload?.processed ?? 0) > 0) {
        if (action.queue === 'catalog') {
          lastCatalogCompletedAtIso = new Date().toISOString();
        } else if (action.queue === 'enrichment') {
          lastEnrichCompletedAtIso = new Date().toISOString();
        }
      }
      console.warn(
        `[worker-autonomy] triggered queue=${action.queue} reason=${action.reason} processed=${payload?.processed ?? 0} runs=${payload?.runsProcessed ?? 0} skipped=${payload?.skipped ?? 'no'}`,
      );
    }
  } catch (error) {
    console.error('[worker-autonomy] tick failed', error);
  } finally {
    autonomousTickInFlight = false;
  }
};

if (autonomousEnabled) {
  console.log(
    `[worker-autonomy] enabled interval=${autonomousIntervalMs}ms queueHealth=${queueHealthEndpoint} catalogDrain=${catalogDrainEndpoint ?? 'n/a'} enrichDrain=${enrichmentDrainEndpoint ?? 'n/a'}`,
  );
} else {
  const reason = queueHealthEndpoint ? 'disabled_by_env_or_queue_flags' : 'missing_queue_health_url';
  console.log(`[worker-autonomy] disabled reason=${reason}`);
}
runAutonomousTick().catch((err) => console.error('[worker-autonomy] startup failed', err));
const autonomousTimer = autonomousEnabled
  ? setInterval(() => {
      runAutonomousTick().catch((err) => console.error('[worker-autonomy] tick failed', err));
    }, autonomousIntervalMs)
  : null;

const shutdown = async (signal, code = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[worker] shutdown requested (${signal})`);
  clearInterval(heartbeatTimer);
  if (autonomousTimer) clearInterval(autonomousTimer);
  await Promise.allSettled([
    catalogWorker?.close(),
    enrichmentWorker?.close(),
    plpSeoWorker?.close(),
    redis.quit(),
  ]);
  process.exit(code);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[worker] unhandledRejection', err);
  shutdown('unhandledRejection', 1).catch(() => process.exit(1));
});
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException', err);
  shutdown('uncaughtException', 1).catch(() => process.exit(1));
});

console.log(
  `[worker] boot ok pid=${pid} host=${hostname} heartbeat=${heartbeatEnabled} ttl=${heartbeatTtlSeconds}s interval=${heartbeatIntervalMs}ms timeout_default=${defaultFetchTimeoutMs ?? 'none'} timeout_catalog=${catalogFetchTimeoutMs ?? 'none'} timeout_enrich=${enrichmentFetchTimeoutMs ?? 'none'} timeout_plp=${plpSeoFetchTimeoutMs ?? 'none'}`,
);
