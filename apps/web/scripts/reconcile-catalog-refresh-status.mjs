import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");
const webRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(webRoot, ".env.local") });
dotenv.config({ path: path.join(webRoot, ".env") });

const getArg = (flag, fallback = null) => {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
};

const hasFlag = (flag) => process.argv.includes(flag);

if (hasFlag("--dry-run") && hasFlag("--apply")) {
  throw new Error("Use solo un modo: --dry-run o --apply");
}

const apply = hasFlag("--apply");
const dryRun = !apply;
const brandId = getArg("--brandId", null);
const days = Math.max(1, Number(getArg("--days", "45")));

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");
}

const readRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeStatus = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

// Debe reflejar exactamente la misma precedencia usada en src/lib/catalog/refresh-status.ts.
const deriveCatalogStatus = (runStatusRaw, refreshStatusRaw) => {
  const runStatus = normalizeStatus(runStatusRaw);
  const refreshStatus = normalizeStatus(refreshStatusRaw);
  const activeRunStatuses = new Set(["processing", "paused", "blocked", "stopped"]);

  if (runStatus && activeRunStatuses.has(runStatus)) {
    return { catalogStatus: runStatus, source: "run", runStatus, refreshStatus };
  }
  if (refreshStatus === "failed") {
    return { catalogStatus: "failed", source: "refresh", runStatus, refreshStatus };
  }
  if (runStatus === "failed") {
    return { catalogStatus: "failed", source: "run", runStatus, refreshStatus };
  }
  if (refreshStatus === "completed") {
    return { catalogStatus: "completed", source: "refresh", runStatus, refreshStatus };
  }
  if (runStatus === "completed") {
    return { catalogStatus: "completed", source: "run", runStatus, refreshStatus };
  }
  if (refreshStatus) {
    return { catalogStatus: refreshStatus, source: "refresh", runStatus, refreshStatus };
  }
  return { catalogStatus: "unknown", source: "derived", runStatus, refreshStatus };
};

const reportDir = path.join(repoRoot, "reports", "catalog_refresh_diagnostics");
await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(
  reportDir,
  `reconcile-status-${new Date().toISOString().replaceAll(":", "-")}.json`,
);

const client = new Client({ connectionString: databaseUrl });
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
        lr."updatedAt" AS run_updated_at,
        lr."finishedAt" AS run_finished_at,
        lr."lastError" AS run_last_error
      FROM "brands" b
      LEFT JOIN LATERAL (
        SELECT
          cr.id,
          cr.status,
          cr."updatedAt",
          cr."finishedAt",
          cr."lastError"
        FROM "catalog_runs" cr
        WHERE cr."brandId" = b.id
        ORDER BY cr."updatedAt" DESC
        LIMIT 1
      ) lr ON true
      WHERE b."isActive" = true
        AND b."siteUrl" IS NOT NULL
        AND ($1::text IS NULL OR b.id = $1::text)
      ORDER BY b.name ASC
    `,
    [brandId],
  );

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    days,
    brandId,
    evaluatedBrands: rows.rowCount ?? 0,
    scopedBrands: 0,
    skippedByDays: 0,
    mismatchDetected: 0,
    updatedBrands: 0,
    unchangedBrands: 0,
  };

  const changes = [];

  for (const row of rows.rows) {
    const metadata = readRecord(row.metadata);
    const refresh = readRecord(metadata.catalog_refresh);

    const runStatus = normalizeStatus(row.run_status);
    const refreshStatus = normalizeStatus(refresh.lastStatus);
    const derived = deriveCatalogStatus(runStatus, refreshStatus);

    const runUpdatedAt = parseDate(row.run_updated_at);
    const refreshFinishedAt = parseDate(refresh.lastFinishedAt);
    const refreshCompletedAt = parseDate(refresh.lastCompletedAt);
    const lastSignalAt = runUpdatedAt ?? refreshFinishedAt ?? refreshCompletedAt;

    if (!brandId && lastSignalAt && lastSignalAt < cutoff) {
      summary.skippedByDays += 1;
      continue;
    }

    summary.scopedBrands += 1;
    if (runStatus && refreshStatus && runStatus !== refreshStatus) {
      summary.mismatchDetected += 1;
    }

    const terminalRun = runStatus === "completed" || runStatus === "failed";
    const runFinishedAt = parseDate(row.run_finished_at) ?? (terminalRun ? runUpdatedAt : null);
    const nextRefresh = { ...refresh };
    let changed = false;

    if (
      (derived.catalogStatus !== "unknown" || refreshStatus || runStatus) &&
      nextRefresh.lastStatus !== derived.catalogStatus
    ) {
      nextRefresh.lastStatus = derived.catalogStatus;
      changed = true;
    }

    if (runFinishedAt) {
      const existing = parseDate(nextRefresh.lastFinishedAt);
      if (!existing || existing.getTime() < runFinishedAt.getTime()) {
        nextRefresh.lastFinishedAt = runFinishedAt.toISOString();
        changed = true;
      }
    }

    if (derived.catalogStatus === "failed") {
      const runLastError =
        typeof row.run_last_error === "string" && row.run_last_error.trim().length > 0
          ? row.run_last_error.trim()
          : null;
      if (runLastError && nextRefresh.lastError !== runLastError) {
        nextRefresh.lastError = runLastError;
        changed = true;
      }
    } else if (derived.catalogStatus === "completed" && nextRefresh.lastError) {
      nextRefresh.lastError = null;
      changed = true;
    }

    if (!changed) {
      summary.unchangedBrands += 1;
      continue;
    }

    summary.updatedBrands += 1;
    if (changes.length < 500) {
      changes.push({
        brandId: row.id,
        brandName: row.name,
        runId: typeof row.run_id === "string" ? row.run_id : null,
        before: {
          runStatus,
          refreshStatus,
          lastFinishedAt: refresh.lastFinishedAt ?? null,
          lastError:
            typeof refresh.lastError === "string" ? refresh.lastError : null,
        },
        after: {
          catalogStatus: nextRefresh.lastStatus ?? null,
          source: derived.source,
          lastFinishedAt: nextRefresh.lastFinishedAt ?? null,
          lastError:
            typeof nextRefresh.lastError === "string" ? nextRefresh.lastError : null,
        },
      });
    }

    if (!dryRun) {
      const nextMetadata = {
        ...metadata,
        catalog_refresh: nextRefresh,
      };
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
    summary,
    changes,
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(
    `${JSON.stringify(
      {
        ...summary,
        reportPath,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.end();
}
