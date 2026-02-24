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

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");
}

const getArg = (flag, fallback) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
};

const hasFlag = (flag) => process.argv.includes(flag);

const sampleSize = Math.max(50, Number(getArg("--sample-size", "300")));
const windowDays = Math.max(7, Number(getArg("--window-days", "30")));
const minSamples = Math.max(10, Number(getArg("--min-samples", "20")));
const minDominance = Math.max(0.5, Math.min(0.99, Number(getArg("--min-dominance", "0.85"))));
const jsonOnly = hasFlag("--json");

const toHistogram = (values) => {
  const hist = new Map();
  values.forEach((value) => {
    hist.set(value, (hist.get(value) ?? 0) + 1);
  });
  return Array.from(hist.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([offsetMinutes, count]) => ({ offsetMinutes, count }));
};

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const querySql = `
    WITH samples AS (
      SELECT
        ROUND(EXTRACT(EPOCH FROM (
          (b.metadata->'catalog_refresh'->>'lastStartedAt')::timestamptz
          - (cr."startedAt" AT TIME ZONE 'UTC')
        )) / 60.0)::int AS offset_min
      FROM "catalog_runs" cr
      INNER JOIN "brands" b ON b.id = cr."brandId"
      WHERE cr."updatedAt" >= NOW() - ($1::text || ' days')::interval
        AND cr."startedAt" IS NOT NULL
        AND (b.metadata->'catalog_refresh'->>'lastStartedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      ORDER BY cr."updatedAt" DESC
      LIMIT $2
    ),
    finished_samples AS (
      SELECT
        ROUND(EXTRACT(EPOCH FROM (
          (b.metadata->'catalog_refresh'->>'lastFinishedAt')::timestamptz
          - (cr."finishedAt" AT TIME ZONE 'UTC')
        )) / 60.0)::int AS offset_min
      FROM "catalog_runs" cr
      INNER JOIN "brands" b ON b.id = cr."brandId"
      WHERE cr."updatedAt" >= NOW() - ($1::text || ' days')::interval
        AND cr."finishedAt" IS NOT NULL
        AND (b.metadata->'catalog_refresh'->>'lastFinishedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      ORDER BY cr."updatedAt" DESC
      LIMIT $2
    )
    SELECT offset_min FROM samples WHERE offset_min IS NOT NULL
    UNION ALL
    SELECT offset_min FROM finished_samples WHERE offset_min IS NOT NULL
  `;

  const rows = await client.query(querySql, [String(windowDays), sampleSize]);
  const offsets = rows.rows
    .map((row) => (typeof row.offset_min === "number" ? row.offset_min : Number(row.offset_min)))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.round(value));

  const histogram = toHistogram(offsets);
  const dominant = histogram[0] ?? null;
  const dominance = dominant && offsets.length > 0 ? dominant.count / offsets.length : 0;
  const consistent =
    offsets.length >= minSamples && Boolean(dominant) && dominance >= minDominance;
  const recommendedOffsetMinutes = consistent && dominant ? dominant.offsetMinutes : null;

  const report = {
    generatedAt: new Date().toISOString(),
    sampleSizeRequested: sampleSize,
    windowDays,
    minSamples,
    minDominance,
    sampleCount: offsets.length,
    histogram,
    dominantOffset: dominant,
    dominance,
    consistent,
    recommendedOffsetMinutes,
    guardrail:
      consistent && recommendedOffsetMinutes !== null
        ? "ok_to_normalize"
        : "abort_data_normalization_use_read_mitigation",
    migrationSettings:
      consistent && recommendedOffsetMinutes !== null
        ? {
            app_catalog_refresh_timestamp_precheck_ok: true,
            app_catalog_refresh_timestamp_offset_minutes: recommendedOffsetMinutes,
          }
        : null,
  };

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("\n=== Catalog Refresh Timestamp Offset Precheck ===\n");
    process.stdout.write(`samples=${report.sampleCount} (requested=${sampleSize}) windowDays=${windowDays}\n`);
    process.stdout.write(`dominantOffset=${dominant ? `${dominant.offsetMinutes} min` : "n/a"} dominance=${(dominance * 100).toFixed(1)}%\n`);
    process.stdout.write(`consistent=${report.consistent ? "yes" : "no"}\n`);
    if (consistent && recommendedOffsetMinutes !== null) {
      process.stdout.write(
        `recommended: SET app.catalog_refresh_timestamp_precheck_ok='true'; SET app.catalog_refresh_timestamp_offset_minutes='${recommendedOffsetMinutes}';\n`,
      );
    } else {
      process.stdout.write(
        "guardrail: abort normalization and use read mitigation until offset is consistent.\n",
      );
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  process.exit(consistent ? 0 : 2);
} finally {
  await client.end();
}
