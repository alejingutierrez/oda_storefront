import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { Queue } from "bullmq";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const yes = process.argv.includes("--yes");
const dryRun = process.argv.includes("--dry-run") || !yes;

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Missing REDIS_URL");

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!databaseUrl) throw new Error("Missing DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");

const catalogQueueName = process.env.CATALOG_QUEUE_NAME || "catalog";
const enrichmentQueueName = process.env.PRODUCT_ENRICHMENT_QUEUE_NAME || "product-enrichment";

const catalogWorkerConcurrency = Math.max(
  1,
  Number(process.env.CATALOG_WORKER_CONCURRENCY || 10),
);
const enrichmentWorkerConcurrency = Math.max(
  1,
  Number(process.env.PRODUCT_ENRICHMENT_WORKER_CONCURRENCY || 30),
);

const catalogEnqueueLimit = Math.max(
  1,
  Number(process.env.RECOVER_CATALOG_ENQUEUE_LIMIT || 200),
);
const enrichmentEnqueueLimit = Math.max(
  1,
  Number(process.env.RECOVER_ENRICH_ENQUEUE_LIMIT || 200),
);

const catalogMaxAttempts = Math.max(1, Number(process.env.CATALOG_MAX_ATTEMPTS ?? 3));
const enrichmentMaxAttempts = Math.max(
  1,
  Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS || 5),
);

const catalogPerRun = Math.max(catalogEnqueueLimit, catalogWorkerConcurrency * 5);
const enrichPerRun = Math.max(enrichmentEnqueueLimit, enrichmentWorkerConcurrency * 5);

const stuckMinutesCatalog = Math.max(
  5,
  Number(process.env.CATALOG_ITEM_STUCK_MINUTES || 30),
);
const stuckMinutesEnrich = Math.max(
  5,
  Number(process.env.PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES || 30),
);

const connection = { url: redisUrl };

const log = (...args) => process.stdout.write(`${args.join(" ")}\n`);

const printQueueCounts = async () => {
  const q1 = new Queue(catalogQueueName, { connection });
  const q2 = new Queue(enrichmentQueueName, { connection });
  try {
    const [c1, c2] = await Promise.all([
      q1.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused"),
      q2.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused"),
    ]);
    return { catalog: c1, enrichment: c2 };
  } finally {
    await Promise.allSettled([q1.close(), q2.close()]);
  }
};

const obliterateQueues = async () => {
  const q1 = new Queue(catalogQueueName, { connection });
  const q2 = new Queue(enrichmentQueueName, { connection });
  try {
    await Promise.all([
      q1.obliterate({ force: true }),
      q2.obliterate({ force: true }),
    ]);
  } finally {
    await Promise.allSettled([q1.close(), q2.close()]);
  }
};

const resetDbStates = async (client) => {
  const result = {};

  const catalogQueued = await client.query(
    `
      UPDATE catalog_items
      SET status = 'pending', "startedAt" = NULL, "updatedAt" = NOW()
      WHERE status = 'queued'
    `,
  );
  result.catalog_queued_to_pending = catalogQueued.rowCount;

  const catalogStuck = await client.query(
    `
      UPDATE catalog_items
      SET status = 'pending', "startedAt" = NULL, "updatedAt" = NOW()
      WHERE status = 'in_progress'
        AND "startedAt" IS NOT NULL
        AND "startedAt" < NOW() - ($1::text || ' minutes')::interval
    `,
    [String(stuckMinutesCatalog)],
  );
  result.catalog_stuck_to_pending = catalogStuck.rowCount;

  const enrichQueued = await client.query(
    `
      UPDATE product_enrichment_items
      SET status = 'pending', "startedAt" = NULL, "updatedAt" = NOW()
      WHERE status = 'queued'
    `,
  );
  result.enrich_queued_to_pending = enrichQueued.rowCount;

  const enrichStuck = await client.query(
    `
      UPDATE product_enrichment_items
      SET status = 'pending', "startedAt" = NULL, "updatedAt" = NOW()
      WHERE status = 'in_progress'
        AND "startedAt" IS NOT NULL
        AND "startedAt" < NOW() - ($1::text || ' minutes')::interval
    `,
    [String(stuckMinutesEnrich)],
  );
  result.enrich_stuck_to_pending = enrichStuck.rowCount;

  return result;
};

const reseedCatalog = async (client) => {
  const runs = await client.query(
    `
      SELECT id
      FROM catalog_runs
      WHERE status = 'processing'
      ORDER BY "updatedAt" ASC
    `,
  );
  const q = new Queue(catalogQueueName, { connection });
  let runsTouched = 0;
  let itemsQueued = 0;
  try {
    for (const row of runs.rows) {
      const runId = row.id;
      const items = await client.query(
        `
          SELECT id
          FROM catalog_items
          WHERE "runId" = $1
            AND status IN ('pending', 'failed')
            AND attempts < $2
          ORDER BY "updatedAt" ASC
          LIMIT $3
        `,
        [runId, catalogMaxAttempts, catalogPerRun],
      );
      const ids = items.rows.map((r) => r.id);
      if (!ids.length) continue;
      runsTouched += 1;

      await client.query(
        `
          UPDATE catalog_items
          SET status = 'queued', "startedAt" = NULL, "updatedAt" = NOW()
          WHERE id = ANY($1::uuid[])
            AND status IN ('pending', 'failed')
        `,
        [ids],
      );

      await q.addBulk(
        ids.map((id) => ({
          name: "catalog-item",
          data: { itemId: id },
          opts: {
            jobId: id,
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );

      itemsQueued += ids.length;
    }
  } finally {
    await q.close().catch(() => null);
  }
  return { runsTouched, itemsQueued };
};

const reseedEnrichment = async (client) => {
  const runs = await client.query(
    `
      SELECT id
      FROM product_enrichment_runs
      WHERE status = 'processing'
      ORDER BY "updatedAt" DESC
    `,
  );
  const q = new Queue(enrichmentQueueName, { connection });
  let runsTouched = 0;
  let itemsQueued = 0;
  try {
    for (const row of runs.rows) {
      const runId = row.id;
      const items = await client.query(
        `
          SELECT id
          FROM product_enrichment_items
          WHERE "runId" = $1
            AND status IN ('pending', 'failed')
            AND attempts < $2
          ORDER BY "updatedAt" ASC
          LIMIT $3
        `,
        [runId, enrichmentMaxAttempts, enrichPerRun],
      );
      const ids = items.rows.map((r) => r.id);
      if (!ids.length) continue;
      runsTouched += 1;

      await client.query(
        `
          UPDATE product_enrichment_items
          SET status = 'queued', "startedAt" = NULL, "updatedAt" = NOW()
          WHERE id = ANY($1::uuid[])
            AND status IN ('pending', 'failed')
        `,
        [ids],
      );

      await q.addBulk(
        ids.map((id) => ({
          name: "product-enrichment",
          data: { itemId: id },
          opts: {
            jobId: id,
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );

      itemsQueued += ids.length;
    }
  } finally {
    await q.close().catch(() => null);
  }
  return { runsTouched, itemsQueued };
};

log(
  JSON.stringify(
    {
      dryRun,
      catalogQueueName,
      enrichmentQueueName,
      catalogPerRun,
      enrichPerRun,
      stuckMinutesCatalog,
      stuckMinutesEnrich,
    },
    null,
    2,
  ),
);

log("queue.counts.before", JSON.stringify(await printQueueCounts()));

if (dryRun) {
  log("dry_run", "Pass --yes to obliterate queues, reset DB states, and reseed.");
  process.exit(0);
}

log("queue.obliterate.start");
await obliterateQueues();
log("queue.obliterate.done", JSON.stringify(await printQueueCounts()));

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  log("db.reset.start");
  const resetResult = await resetDbStates(client);
  log("db.reset.done", JSON.stringify(resetResult));

  log("db.reseed.catalog.start");
  const reseedCatalogResult = await reseedCatalog(client);
  log("db.reseed.catalog.done", JSON.stringify(reseedCatalogResult));

  log("db.reseed.enrichment.start");
  const reseedEnrichResult = await reseedEnrichment(client);
  log("db.reseed.enrichment.done", JSON.stringify(reseedEnrichResult));
} finally {
  await client.end();
}

log("queue.counts.after", JSON.stringify(await printQueueCounts()));
