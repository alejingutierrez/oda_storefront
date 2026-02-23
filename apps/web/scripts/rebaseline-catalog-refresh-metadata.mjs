import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const args = new Set(process.argv.slice(2));
if (args.has("--dry-run") && args.has("--apply")) {
  throw new Error("Use only one mode: --dry-run or --apply");
}
const apply = args.has("--apply");
const dryRun = !apply;

const readEnvNumber = (key, fallback) => {
  const raw = Number(process.env[key] ?? fallback);
  return Number.isFinite(raw) ? raw : fallback;
};

const parseDate = (value) => {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const readRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const readRefreshMeta = (metadata) => {
  const record = readRecord(metadata);
  return readRecord(record.catalog_refresh);
};

const computeSuccessByGate = (failedItems, totalItems, maxFailedItems, maxFailedRate) => {
  const failedRate = totalItems > 0 ? failedItems / totalItems : failedItems > 0 ? 1 : 0;
  const shouldFail = failedItems > maxFailedItems && failedRate > maxFailedRate;
  return { success: !shouldFail, failedRate };
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const computeNextDueAt = (baseDate, intervalDays, jitterHours, seed) => {
  const baseMs = intervalDays * 24 * 60 * 60 * 1000;
  const jitterMs = Math.max(0, jitterHours) * 60 * 60 * 1000;
  const offset = jitterMs > 0 ? hashString(seed) % (jitterMs + 1) : 0;
  return new Date(baseDate.getTime() + baseMs + offset).toISOString();
};

const asInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");
}

const maxFailedItems = Math.max(0, readEnvNumber("CATALOG_REFRESH_MAX_FAILED_ITEMS", 30));
const maxFailedRate = Math.max(0, Math.min(1, readEnvNumber("CATALOG_REFRESH_MAX_FAILED_RATE", 0.1)));
const intervalDays = Math.max(1, readEnvNumber("CATALOG_REFRESH_INTERVAL_DAYS", 7));
const jitterHours = Math.max(0, readEnvNumber("CATALOG_REFRESH_JITTER_HOURS", 12));

const reportDir = path.join(repoRoot, "reports", "catalog_refresh_diagnostics");
await fs.mkdir(reportDir, { recursive: true });
const reportTimestamp = new Date().toISOString().replaceAll(":", "-");
const reportPath = path.join(reportDir, `rebaseline-${reportTimestamp}.json`);

const client = new Client({ connectionString });
await client.connect();

try {
  const rows = await client.query(
    `
      SELECT
        b.id,
        b.name,
        b.metadata,
        lr.id AS run_id,
        lr.status AS run_status,
        COALESCE(lr."finishedAt", lr."updatedAt") AS run_finished_at,
        lr."startedAt" AS run_started_at,
        lr."totalItems"::int AS run_total_items,
        lr."lastError" AS run_last_error,
        COALESCE(agg.completed_items, 0)::int AS completed_items,
        COALESCE(agg.failed_items, 0)::int AS failed_items,
        COALESCE(agg.total_items, 0)::int AS agg_total_items
      FROM "brands" b
      LEFT JOIN LATERAL (
        SELECT
          cr.id,
          cr.status,
          cr."finishedAt",
          cr."updatedAt",
          cr."startedAt",
          cr."totalItems",
          cr."lastError"
        FROM "catalog_runs" cr
        WHERE cr."brandId" = b.id
          AND cr.status IN ('completed', 'failed')
        ORDER BY COALESCE(cr."finishedAt", cr."updatedAt") DESC
        LIMIT 1
      ) lr ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE ci.status = 'completed')::int AS completed_items,
          COUNT(*) FILTER (WHERE ci.status = 'failed')::int AS failed_items,
          COUNT(*)::int AS total_items
        FROM "catalog_items" ci
        WHERE ci."runId" = lr.id
      ) agg ON true
      WHERE b."isActive" = true
        AND b."siteUrl" IS NOT NULL
        AND b."manualReview" = false
      ORDER BY b.name ASC
    `,
  );

  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    thresholds: { maxFailedItems, maxFailedRate, intervalDays, jitterHours },
    autoEligibleBrands: rows.rowCount ?? 0,
    brandsWithFinalRun: 0,
    reclassifiedCompleted: 0,
    preservedFailed: 0,
    normalizedFinishedAt: 0,
    updatedBrands: 0,
    unchangedBrands: 0,
  };

  const changes = [];

  for (const row of rows.rows) {
    const metadata = readRecord(row.metadata);
    const refresh = readRefreshMeta(metadata);
    const runId = typeof row.run_id === "string" ? row.run_id : null;
    const finishedAt =
      row.run_finished_at instanceof Date
        ? row.run_finished_at
        : parseDate(typeof row.run_finished_at === "string" ? row.run_finished_at : null);
    const existingFinishedAt = parseDate(refresh.lastFinishedAt);
    const existingCompletedAt = parseDate(refresh.lastCompletedAt);
    const normalizedFinishedAt = finishedAt ?? existingFinishedAt ?? existingCompletedAt;

    const completedItems = asInt(row.completed_items);
    const failedItems = asInt(row.failed_items);
    const totalItemsRaw = asInt(row.run_total_items);
    const totalItemsFromAgg = asInt(row.agg_total_items);
    const totalItems = totalItemsRaw > 0 ? totalItemsRaw : totalItemsFromAgg;
    const gate = computeSuccessByGate(failedItems, totalItems, maxFailedItems, maxFailedRate);

    const nextRefresh = { ...refresh };
    let changed = false;

    if (runId) {
      summary.brandsWithFinalRun += 1;
      if (gate.success && normalizedFinishedAt) {
        const normalizedIso = normalizedFinishedAt.toISOString();
        const previousStatus =
          typeof nextRefresh.lastStatus === "string" ? nextRefresh.lastStatus : null;
        if (nextRefresh.lastStatus !== "completed") {
          nextRefresh.lastStatus = "completed";
          summary.reclassifiedCompleted += 1;
        }
        const currentCompleted = parseDate(nextRefresh.lastCompletedAt);
        if (!currentCompleted || currentCompleted < normalizedFinishedAt) {
          nextRefresh.lastCompletedAt = normalizedIso;
        }
        const currentFinished = parseDate(nextRefresh.lastFinishedAt);
        if (!currentFinished || currentFinished < normalizedFinishedAt) {
          nextRefresh.lastFinishedAt = normalizedIso;
          if (!currentFinished) summary.normalizedFinishedAt += 1;
        }
        if (asInt(nextRefresh.consecutiveFailedRuns) > 0) {
          nextRefresh.consecutiveFailedRuns = 0;
        }
        if (nextRefresh.failedBackoffUntil !== null && nextRefresh.failedBackoffUntil !== undefined) {
          nextRefresh.failedBackoffUntil = null;
        }
        if (previousStatus === "failed" && typeof nextRefresh.lastError === "string") {
          nextRefresh.lastError = null;
        }
        if (!parseDate(nextRefresh.nextDueAt)) {
          nextRefresh.nextDueAt = computeNextDueAt(
            normalizedFinishedAt,
            intervalDays,
            jitterHours,
            `${row.id}:${normalizedFinishedAt.toISOString()}`,
          );
        }
      } else if (!gate.success) {
        summary.preservedFailed += 1;
        if (nextRefresh.lastStatus !== "failed") {
          nextRefresh.lastStatus = "failed";
        }
        if (normalizedFinishedAt && !existingFinishedAt) {
          nextRefresh.lastFinishedAt = normalizedFinishedAt.toISOString();
          summary.normalizedFinishedAt += 1;
        }
        if (typeof row.run_last_error === "string" && row.run_last_error) {
          nextRefresh.lastError = row.run_last_error;
        }
      }
    } else if (normalizedFinishedAt && !existingFinishedAt) {
      nextRefresh.lastFinishedAt = normalizedFinishedAt.toISOString();
      summary.normalizedFinishedAt += 1;
    }

    const catalogRefreshBefore = JSON.stringify(refresh);
    const catalogRefreshAfter = JSON.stringify(nextRefresh);
    changed = catalogRefreshBefore !== catalogRefreshAfter;

    if (!changed) {
      summary.unchangedBrands += 1;
      continue;
    }

    const nextMetadata = {
      ...metadata,
      catalog_refresh: nextRefresh,
    };

    summary.updatedBrands += 1;
    if (changes.length < 200) {
      changes.push({
        brandId: row.id,
        brandName: row.name,
        runId,
        gateSuccess: gate.success,
        failedItems,
        totalItems,
        failedRate: gate.failedRate,
        before: refresh,
        after: nextRefresh,
      });
    }

    if (!dryRun) {
      await client.query(
        `
          UPDATE "brands"
          SET "metadata" = $2::jsonb
          WHERE id = $1
        `,
        [row.id, JSON.stringify(nextMetadata)],
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: summary.mode,
    thresholds: summary.thresholds,
    summary: {
      autoEligibleBrands: summary.autoEligibleBrands,
      brandsWithFinalRun: summary.brandsWithFinalRun,
      reclassifiedCompleted: summary.reclassifiedCompleted,
      preservedFailed: summary.preservedFailed,
      normalizedFinishedAt: summary.normalizedFinishedAt,
      updatedBrands: summary.updatedBrands,
      unchangedBrands: summary.unchangedBrands,
    },
    changes,
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ...summary, reportPath }, null, 2)}\n`);
} finally {
  await client.end();
}
