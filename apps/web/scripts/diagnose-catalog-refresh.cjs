/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Diagnostics for /admin/catalog-refresh.
 *
 * Usage (from repo root):
 *   node apps/web/scripts/diagnose-catalog-refresh.cjs > reports/catalog-refresh.json
 *
 * Notes:
 * - Reads DB URL from DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL in root `.env`.
 * - Prints JSON only (no secrets).
 */

const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "../../../.env") });

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  console.error("Missing DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");
  process.exit(1);
}

const toInt = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : fallback;
};

const intervalDays = Math.max(1, toInt(process.env.CATALOG_REFRESH_INTERVAL_DAYS, 7));
const lookbackDays = Math.max(1, toInt(process.env.CATALOG_REFRESH_FAILED_LOOKBACK_DAYS, 30));
const windowDays = intervalDays;

const pool = new Pool({ connectionString: databaseUrl });

const query = async (text, params) => (await pool.query(text, params)).rows;

const main = async () => {
  const [{ total_brands }] = await query(
    `SELECT COUNT(*)::int AS total_brands
     FROM brands
     WHERE "isActive" = true AND "siteUrl" IS NOT NULL`,
  );

  const [{ fresh_brands, stale_brands }] = await query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE (metadata->'catalog_refresh'->>'lastCompletedAt')::timestamptz >= NOW() - ($1::text || ' days')::interval
        )::int AS fresh_brands,
        COUNT(*) FILTER (
          WHERE (metadata->'catalog_refresh'->>'lastCompletedAt') IS NULL
             OR (metadata->'catalog_refresh'->>'lastCompletedAt')::timestamptz < NOW() - ($1::text || ' days')::interval
        )::int AS stale_brands
      FROM brands
      WHERE "isActive" = true AND "siteUrl" IS NOT NULL
    `,
    [windowDays],
  );

  const status_dist = await query(
    `
      SELECT
        COALESCE(metadata->'catalog_refresh'->>'lastStatus', '(none)') AS status,
        COUNT(*)::int AS count
      FROM brands
      WHERE "isActive" = true AND "siteUrl" IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC
    `,
  );

  const coverage_stats = await query(
    `
      SELECT
        AVG((metadata->'catalog_refresh'->>'lastCombinedCoverage')::float) AS avg,
        percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9])
          WITHIN GROUP (ORDER BY (metadata->'catalog_refresh'->>'lastCombinedCoverage')::float) AS p
      FROM brands
      WHERE "isActive" = true
        AND "siteUrl" IS NOT NULL
        AND (metadata->'catalog_refresh'->>'lastCombinedCoverage') IS NOT NULL
    `,
  );

  const run_status_last_window = await query(
    `
      SELECT cr.status, COUNT(*)::int AS count
      FROM catalog_runs cr
      WHERE cr."startedAt" >= NOW() - ($1::text || ' days')::interval
      GROUP BY 1
      ORDER BY count DESC
    `,
    [windowDays],
  );

  const [runs_with_failed_last_window] = await query(
    `
      WITH run_stats AS (
        SELECT
          cr.id,
          cr.status,
          cr."totalItems"::int AS total_items,
          COUNT(ci.*) FILTER (WHERE ci.status = 'failed')::int AS failed,
          COUNT(ci.*) FILTER (WHERE ci.status = 'completed')::int AS completed,
          COUNT(ci.*) FILTER (WHERE ci.status IN ('pending', 'queued', 'in_progress'))::int AS pending
        FROM catalog_runs cr
        LEFT JOIN catalog_items ci ON ci."runId" = cr.id
        WHERE cr."startedAt" >= NOW() - ($1::text || ' days')::interval
        GROUP BY cr.id
      )
      SELECT
        COUNT(*)::int AS runs,
        COUNT(*) FILTER (WHERE failed > 0)::int AS runs_with_failed,
        COUNT(*) FILTER (WHERE failed = 0 AND pending = 0)::int AS runs_clean_finished,
        COUNT(*) FILTER (WHERE pending > 0)::int AS runs_not_finished
      FROM run_stats
    `,
    [windowDays],
  );

  const top_item_errors_last_window = await query(
    `
      SELECT
        COALESCE(ci."lastError", '(null)') AS error,
        COUNT(*)::int AS count
      FROM catalog_items ci
      INNER JOIN catalog_runs cr ON cr.id = ci."runId"
      WHERE ci.status = 'failed'
        AND ci."updatedAt" >= NOW() - ($1::text || ' days')::interval
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 30
    `,
    [windowDays],
  );

  const top_stages_last_window = await query(
    `
      SELECT
        COALESCE(ci."lastStage", '(null)') AS stage,
        COUNT(*)::int AS count
      FROM catalog_items ci
      INNER JOIN catalog_runs cr ON cr.id = ci."runId"
      WHERE ci.status = 'failed'
        AND ci."updatedAt" >= NOW() - ($1::text || ' days')::interval
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 20
    `,
    [windowDays],
  );

  const worst_latest_runs = await query(
    `
      WITH latest_runs AS (
        SELECT DISTINCT ON (cr."brandId")
          cr.id,
          cr."brandId",
          cr.status,
          cr."totalItems"::int AS total_items,
          cr."updatedAt" AS updated_at,
          cr."lastError" AS last_error
        FROM catalog_runs cr
        INNER JOIN brands b ON b.id = cr."brandId"
        WHERE b."isActive" = true AND b."siteUrl" IS NOT NULL
        ORDER BY cr."brandId", cr."updatedAt" DESC
      ), stats AS (
        SELECT
          lr.*,
          COUNT(ci.*) FILTER (WHERE ci.status = 'failed')::int AS failed,
          COUNT(ci.*) FILTER (WHERE ci.status = 'completed')::int AS completed,
          COUNT(ci.*) FILTER (WHERE ci.status IN ('pending', 'queued', 'in_progress'))::int AS pending
        FROM latest_runs lr
        LEFT JOIN catalog_items ci ON ci."runId" = lr.id
        GROUP BY lr.id, lr."brandId", lr.status, lr.total_items, lr.updated_at, lr.last_error
      )
      SELECT b.name, s.*
      FROM stats s
      INNER JOIN brands b ON b.id = s."brandId"
      ORDER BY s.failed DESC, s.pending DESC, s.total_items DESC
      LIMIT 25
    `,
  );

  const failed_items_last_lookback = await query(
    `
      SELECT COUNT(*)::int AS failed_items
      FROM catalog_items ci
      INNER JOIN catalog_runs cr ON cr.id = ci."runId"
      WHERE ci.status = 'failed'
        AND ci."updatedAt" >= NOW() - ($1::text || ' days')::interval
    `,
    [lookbackDays],
  );

  const top_brands_openai_quota_last_window = await query(
    `
      SELECT b.name, COUNT(*)::int AS count
      FROM catalog_items ci
      INNER JOIN catalog_runs cr ON cr.id = ci."runId"
      INNER JOIN brands b ON b.id = cr."brandId"
      WHERE ci.status = 'failed'
        AND ci."updatedAt" >= NOW() - ($1::text || ' days')::interval
        AND ci."lastStage" = 'normalize'
        AND ci."lastError" ILIKE '%429 You exceeded your current quota%'
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 25
    `,
    [windowDays],
  );

  const top_brands_no_images_last_window = await query(
    `
      SELECT b.name, COUNT(*)::int AS count
      FROM catalog_items ci
      INNER JOIN catalog_runs cr ON cr.id = ci."runId"
      INNER JOIN brands b ON b.id = cr."brandId"
      WHERE ci.status = 'failed'
        AND ci."updatedAt" >= NOW() - ($1::text || ' days')::interval
        AND ci."lastStage" = 'blob_upload'
        AND ci."lastError" = 'No hay imágenes disponibles tras upload'
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 25
    `,
    [windowDays],
  );

  const failed_brands_latest_run_stats = await query(
    `
      WITH failing_brands AS (
        SELECT b.id, b.name
        FROM brands b
        WHERE b."isActive" = true
          AND b."siteUrl" IS NOT NULL
          AND (b.metadata->'catalog_refresh'->>'lastStatus') = 'failed'
      ), latest_runs AS (
        SELECT DISTINCT ON (cr."brandId")
          cr.id,
          cr."brandId",
          cr.status,
          cr."totalItems"::int AS total_items,
          cr."updatedAt" AS updated_at,
          cr."lastError" AS last_error
        FROM catalog_runs cr
        INNER JOIN failing_brands fb ON fb.id = cr."brandId"
        ORDER BY cr."brandId", cr."updatedAt" DESC
      ), stats AS (
        SELECT
          lr.*,
          COUNT(ci.*) FILTER (WHERE ci.status = 'failed')::int AS failed,
          COUNT(ci.*) FILTER (WHERE ci.status = 'completed')::int AS completed
        FROM latest_runs lr
        LEFT JOIN catalog_items ci ON ci."runId" = lr.id
        GROUP BY lr.id, lr."brandId", lr.status, lr.total_items, lr.updated_at, lr.last_error
      )
      SELECT fb.name, fb.id AS brand_id, s.*
      FROM stats s
      INNER JOIN failing_brands fb ON fb.id = s."brandId"
      ORDER BY s.failed DESC, s.total_items DESC
      LIMIT 25
    `,
  );

  const [failed_brands_histogram] = await query(
    `
      WITH failing_brands AS (
        SELECT b.id
        FROM brands b
        WHERE b."isActive" = true
          AND b."siteUrl" IS NOT NULL
          AND (b.metadata->'catalog_refresh'->>'lastStatus') = 'failed'
      ), latest_runs AS (
        SELECT DISTINCT ON (cr."brandId")
          cr.id,
          cr."brandId",
          cr."totalItems"::int AS total_items,
          cr."updatedAt" AS updated_at
        FROM catalog_runs cr
        INNER JOIN failing_brands fb ON fb.id = cr."brandId"
        ORDER BY cr."brandId", cr."updatedAt" DESC
      ), stats AS (
        SELECT
          lr.*,
          COUNT(ci.*) FILTER (WHERE ci.status = 'failed')::int AS failed,
          COUNT(ci.*) FILTER (WHERE ci.status = 'completed')::int AS completed
        FROM latest_runs lr
        LEFT JOIN catalog_items ci ON ci."runId" = lr.id
        GROUP BY lr.id, lr."brandId", lr.total_items, lr.updated_at
      )
      SELECT
        COUNT(*)::int AS failed_brands,
        COUNT(*) FILTER (WHERE failed <= 5)::int AS failed_le_5,
        COUNT(*) FILTER (WHERE failed BETWEEN 6 AND 20)::int AS failed_6_20,
        COUNT(*) FILTER (WHERE failed BETWEEN 21 AND 100)::int AS failed_21_100,
        COUNT(*) FILTER (WHERE failed > 100)::int AS failed_gt_100,
        AVG((completed::float / NULLIF(total_items, 0))) AS avg_success_rate,
        percentile_cont(ARRAY[0.25, 0.5, 0.75, 0.9])
          WITHIN GROUP (ORDER BY (completed::float / NULLIF(total_items, 0))) AS success_rate_p
      FROM stats
    `,
  );

  const report = {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    lookback_days: lookbackDays,
    totals: {
      total_brands,
      fresh_brands,
      stale_brands,
    },
    status_dist,
    coverage_stats: coverage_stats[0] ?? null,
    run_status_last_window,
    runs_with_failed_last_window: runs_with_failed_last_window ?? null,
    top_item_errors_last_window,
    top_stages_last_window,
    top_brands_openai_quota_last_window,
    top_brands_no_images_last_window,
    failed_brands_histogram: failed_brands_histogram ?? null,
    failed_brands_latest_run_stats,
    worst_latest_runs,
    failed_items_last_lookback: failed_items_last_lookback[0] ?? null,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main()
  .catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
