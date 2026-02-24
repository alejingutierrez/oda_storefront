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
  throw new Error("Use solo un modo: --dry-run o --apply");
}
const apply = args.has("--apply");
const dryRun = !apply;

const readEnvNumber = (key, fallback) => {
  const raw = Number(process.env[key] ?? fallback);
  return Number.isFinite(raw) ? raw : fallback;
};

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL");
}

const minCompletedRuns = Math.max(
  1,
  readEnvNumber("CATALOG_MANUAL_REVIEW_AUTOCLEAR_MIN_COMPLETED_RUNS", 2),
);
const windowDays = Math.max(
  1,
  readEnvNumber("CATALOG_MANUAL_REVIEW_AUTOCLEAR_WINDOW_DAYS", 21),
);
const now = new Date();
const nowIso = now.toISOString();
const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
const blockedReasons = new Set([
  "manual_review_no_products",
  "manual_review_vtex_no_products",
  "unreachable",
  "parked_domain",
]);

const readRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const getBlockedReason = (metadata) => {
  const root = readRecord(metadata);
  const reviewReason =
    readRecord(root.catalog_extract_review).reason ??
    readRecord(root.catalog_extract_finished).reason;
  if (typeof reviewReason === "string" && blockedReasons.has(reviewReason)) {
    return reviewReason;
  }
  const risks = readRecord(root.tech_profile).risks;
  if (Array.isArray(risks)) {
    for (const risk of risks) {
      if (typeof risk === "string" && blockedReasons.has(risk)) {
        return risk;
      }
    }
  }
  return null;
};

const reportDir = path.join(repoRoot, "reports", "catalog_refresh_diagnostics");
await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(
  reportDir,
  `auto-clear-manual-review-${new Date().toISOString().replaceAll(":", "-")}.json`,
);

const client = new Client({ connectionString });
await client.connect();

try {
  const brandsRes = await client.query(
    `
      SELECT id, name, metadata
      FROM "brands"
      WHERE "isActive" = true
        AND "siteUrl" IS NOT NULL
        AND "manualReview" = true
      ORDER BY name ASC
    `,
  );
  const brands = brandsRes.rows;
  const brandIds = brands.map((brand) => brand.id);

  const runStats = brandIds.length
    ? (
        await client.query(
          `
            SELECT
              cr."brandId" AS "brandId",
              cr.id AS "runId",
              cr."updatedAt" AS "updatedAt",
              COALESCE(NULLIF(cr."totalItems", 0), COUNT(ci.*))::int AS "totalItems",
              COUNT(*) FILTER (WHERE ci.status = 'failed')::int AS "failedItems",
              COUNT(*) FILTER (WHERE ci.status IN ('pending', 'queued', 'in_progress'))::int AS "pendingItems"
            FROM "catalog_runs" cr
            LEFT JOIN "catalog_items" ci ON ci."runId" = cr.id
            WHERE cr.status = 'completed'
              AND cr."updatedAt" >= $1::timestamptz
              AND cr."brandId"::text = ANY($2::text[])
            GROUP BY cr.id
            ORDER BY cr."updatedAt" DESC
          `,
          [windowStart.toISOString(), brandIds],
        )
      ).rows
    : [];

  const statsByBrand = new Map();
  for (const row of runStats) {
    const list = statsByBrand.get(row.brandId) ?? [];
    list.push(row);
    statsByBrand.set(row.brandId, list);
  }

  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    minCompletedRuns,
    windowDays,
    now: nowIso,
    evaluatedBrands: brands.length,
    eligibleBrands: 0,
    autoClearedBrands: 0,
    skippedBlockedReason: 0,
    skippedInsufficientRuns: 0,
  };

  const candidates = [];

  for (const brand of brands) {
    const metadata = readRecord(brand.metadata);
    const blockedReason = getBlockedReason(metadata);
    const stats = statsByBrand.get(brand.id) ?? [];

    if (blockedReason) {
      summary.skippedBlockedReason += 1;
      candidates.push({
        brandId: brand.id,
        brandName: brand.name,
        blockedReason,
        eligibleRuns: 0,
        applied: false,
      });
      continue;
    }

    const eligibleRuns = stats.filter((row) => {
      const totalItems = Math.max(0, Number(row.totalItems ?? 0));
      const failedItems = Math.max(0, Number(row.failedItems ?? 0));
      const pendingItems = Math.max(0, Number(row.pendingItems ?? 0));
      if (pendingItems > 0) return false;
      if (failedItems > 5) return false;
      const failedRate = totalItems > 0 ? failedItems / totalItems : 0;
      return failedRate <= 0.05;
    });

    if (eligibleRuns.length < minCompletedRuns) {
      summary.skippedInsufficientRuns += 1;
      candidates.push({
        brandId: brand.id,
        brandName: brand.name,
        blockedReason: null,
        eligibleRuns: eligibleRuns.length,
        applied: false,
      });
      continue;
    }

    summary.eligibleBrands += 1;
    const nextMetadata = readRecord(metadata);
    const refresh = readRecord(nextMetadata.catalog_refresh);
    nextMetadata.catalog_refresh = {
      ...refresh,
      manualReviewAutoClearedAt: nowIso,
      manualReviewAutoClearEvidence: {
        source: "auto_clear_manual_review_script",
        autoClearedAt: nowIso,
        windowDays,
        minCompletedRuns,
        eligibleRuns: eligibleRuns.length,
        runIds: eligibleRuns.slice(0, 10).map((row) => row.runId),
      },
    };

    if (!dryRun) {
      await client.query(
        `
          UPDATE "brands"
          SET "manualReview" = false,
              "metadata" = $2::jsonb
          WHERE id = $1
        `,
        [brand.id, JSON.stringify(nextMetadata)],
      );
      summary.autoClearedBrands += 1;
    }

    candidates.push({
      brandId: brand.id,
      brandName: brand.name,
      blockedReason: null,
      eligibleRuns: eligibleRuns.length,
      applied: !dryRun,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    candidates,
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ...summary, reportPath }, null, 2)}\n`);
} finally {
  await client.end();
}
