import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const yes = process.argv.includes("--yes");
const dryRun = process.argv.includes("--dry-run") || !yes;

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");

const intervalDays = Math.max(1, Number(process.env.CATALOG_REFRESH_INTERVAL_DAYS ?? 7));
const jitterHours = Math.max(0, Number(process.env.CATALOG_REFRESH_JITTER_HOURS ?? 12));

const client = new Client({ connectionString: databaseUrl });
await client.connect();

const parseDate = (value) => {
  if (!value || typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const computeNextDueAt = (lastCompletedAt) => {
  const baseMs = intervalDays * 24 * 60 * 60 * 1000;
  const jitterMs = jitterHours * 60 * 60 * 1000;
  const offset = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return new Date(lastCompletedAt.getTime() + baseMs + offset).toISOString();
};

try {
  const rows = await client.query(
    `
      SELECT
        id,
        metadata->'catalog_refresh'->>'lastCompletedAt' AS last_completed_at,
        metadata->'catalog_refresh'->>'nextDueAt' AS next_due_at
      FROM brands
      WHERE "isActive" = true
        AND "siteUrl" IS NOT NULL
        AND (metadata->'catalog_refresh'->>'lastCompletedAt') IS NOT NULL
    `,
  );

  let updated = 0;
  let skipped = 0;
  let parseErrors = 0;

  for (const row of rows.rows) {
    const lastCompleted = parseDate(row.last_completed_at);
    if (!lastCompleted) {
      parseErrors += 1;
      continue;
    }
    const nextDueAt = computeNextDueAt(lastCompleted);
    if (dryRun) {
      updated += 1;
      continue;
    }

    await client.query(
      `
        UPDATE brands
        SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{catalog_refresh,nextDueAt}',
          to_jsonb($2::text),
          true
        )
        WHERE id = $1
      `,
      [row.id, nextDueAt],
    );
    updated += 1;
    skipped += 0;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        dryRun,
        intervalDays,
        jitterHours,
        totalEligible: rows.rows.length,
        updated,
        skipped,
        parseErrors,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.end();
}

