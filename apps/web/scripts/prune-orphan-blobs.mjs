import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";
import { del, list } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");
const reportsDir = path.resolve(repoRoot, "reports/blob-cost");

dotenv.config({ path: path.resolve(repoRoot, ".env") });

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || "";

if (!connectionString) {
  console.error("Missing NEON_DATABASE_URL/DATABASE_URL/POSTGRES_URL/POSTGRES_PRISMA_URL");
  process.exit(1);
}
if (!blobToken) {
  console.error("Missing BLOB_READ_WRITE_TOKEN/VERCEL_BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}

const BLOB_HOST_FRAGMENT = "blob.vercel-storage.com";
const LIST_LIMIT = Math.max(1, Math.min(1000, Number(process.env.BLOB_PRUNE_LIST_LIMIT ?? 1000)));
const LIST_RETRIES = Math.max(1, Number(process.env.BLOB_PRUNE_LIST_RETRIES ?? 4));
const DELETE_RETRIES = Math.max(1, Number(process.env.BLOB_PRUNE_DELETE_RETRIES ?? 3));
const LIST_LOG_EVERY = Math.max(1000, Number(process.env.BLOB_PRUNE_LIST_LOG_EVERY ?? 20000));
const DEFAULT_MIN_AGE_DAYS = Math.max(0, Number(process.env.BLOB_PRUNE_MIN_AGE_DAYS ?? 14));
const MIN_AGE_DAYS_CATALOG = Math.max(
  0,
  Number(process.env.BLOB_PRUNE_MIN_AGE_DAYS_CATALOG ?? DEFAULT_MIN_AGE_DAYS),
);
const MIN_AGE_DAYS_IMAGE_PROXY = Math.max(
  0,
  Number(process.env.BLOB_PRUNE_MIN_AGE_DAYS_IMAGE_PROXY ?? 7),
);
const BATCH_SIZE = Math.max(1, Number(process.env.BLOB_PRUNE_BATCH ?? 500));
const MAX_ERROR_RATE = Math.max(0, Number(process.env.BLOB_PRUNE_MAX_ERROR_RATE ?? 0.02));
const MAX_DELETE = Math.max(0, Number(process.env.BLOB_PRUNE_MAX_DELETE ?? 0));
const MAX_SCAN_BLOBS = Math.max(0, Number(process.env.BLOB_PRUNE_MAX_SCAN_BLOBS ?? 0));
const APPLY_MAX_ALLOWED_ERROR_RATE = 0.02;
const AUDIT_MAX_DIFF_PCT = Math.max(0, Number(process.env.BLOB_PRUNE_AUDIT_MAX_DIFF_PCT ?? 1));
const REQUIRE_AUDIT_MATCH = (process.env.BLOB_PRUNE_REQUIRE_AUDIT_MATCH ?? "true").trim().toLowerCase() !== "false";
const latestAuditPath = path.join(reportsDir, "blob-cost-audit-latest.json");

const explicitDryRun = process.env.BLOB_PRUNE_DRY_RUN;
const dryRun = explicitDryRun === "true"
  ? true
  : explicitDryRun === "false"
    ? false
    : process.env.APPLY !== "true";
const apply = process.env.APPLY === "true" && !dryRun;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toGb = (bytes) => Number((bytes / (1024 ** 3)).toFixed(4));
const toPct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : 0);
const resolveMinAgeDays = (pathname) => {
  const prefix = String(pathname ?? "").split("/")[0];
  if (prefix === "catalog") return MIN_AGE_DAYS_CATALOG;
  if (prefix === "image-proxy") return MIN_AGE_DAYS_IMAGE_PROXY;
  return DEFAULT_MIN_AGE_DAYS;
};

const extractBlobPathFromUrl = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes(BLOB_HOST_FRAGMENT)) return null;
  const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  try {
    const target = /^https?:\/\//i.test(normalized)
      ? normalized
      : `https://${normalized.replace(/^\/+/, "")}`;
    const pathname = new URL(target).pathname.replace(/^\/+/, "");
    return pathname || null;
  } catch {
    return null;
  }
};

const normalizeBlobPath = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [withoutQuery] = trimmed.split(/[?#]/, 1);
  const cleaned = withoutQuery.replace(/^\/+/, "");
  if (!cleaned || !cleaned.includes("/")) return null;
  return cleaned;
};

const loadLatestAuditSummary = async () => {
  try {
    const raw = await fs.readFile(latestAuditPath, "utf8");
    const parsed = JSON.parse(raw);
    const orphanTotalCount = Number(parsed?.orphanBlobs?.totalCount ?? 0);
    const orphanTotalBytes = Number(parsed?.orphanBlobs?.totalBytes ?? 0);
    if (!Number.isFinite(orphanTotalCount) || !Number.isFinite(orphanTotalBytes)) return null;
    return {
      orphanTotalCount,
      orphanTotalBytes,
      generatedAt: parsed?.generatedAt ?? null,
      source: latestAuditPath,
    };
  } catch {
    return null;
  }
};

const listWithRetry = async ({ token, cursor }) => {
  let attempt = 0;
  let lastError = null;
  while (attempt < LIST_RETRIES) {
    attempt += 1;
    try {
      return await list({ token, limit: LIST_LIMIT, cursor });
    } catch (error) {
      lastError = error;
      if (attempt >= LIST_RETRIES) break;
      const waitMs = Math.min(5000, 250 * 2 ** (attempt - 1));
      console.warn("blob-prune.list.retry", { attempt, waitMs });
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "list_failed"));
};

const deleteWithRetry = async (paths) => {
  let attempt = 0;
  let lastError = null;
  while (attempt < DELETE_RETRIES) {
    attempt += 1;
    try {
      await del(paths, { token: blobToken });
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= DELETE_RETRIES) break;
      const waitMs = Math.min(5000, 300 * 2 ** (attempt - 1));
      await sleep(waitMs);
    }
  }
  return {
    ok: false,
    attempts: DELETE_RETRIES,
    error: lastError instanceof Error ? lastError.message : String(lastError ?? "delete_failed"),
  };
};

const collectReferencedBlobPaths = async (client) => {
  const referencedBlobPaths = new Set();
  const counters = {
    coverRows: 0,
    coverBlobRefs: 0,
    variantRows: 0,
    variantImageUrls: 0,
    variantBlobRefs: 0,
    assetRows: 0,
    assetBlobRefs: 0,
    assetBlobPathRows: 0,
    assetBlobPathRefs: 0,
  };

  const coversRes = await client.query(`
    select "imageCoverUrl" as url
    from products
    where "imageCoverUrl" is not null
  `);

  for (const row of coversRes.rows ?? []) {
    counters.coverRows += 1;
    const blobPath = extractBlobPathFromUrl(row.url);
    if (!blobPath) continue;
    referencedBlobPaths.add(blobPath);
    counters.coverBlobRefs += 1;
  }

  const variantsRes = await client.query(`
    select images
    from variants
    where cardinality(images) > 0
  `);

  for (const row of variantsRes.rows ?? []) {
    counters.variantRows += 1;
    const images = Array.isArray(row.images) ? row.images : [];
    for (const imageUrl of images) {
      counters.variantImageUrls += 1;
      const blobPath = extractBlobPathFromUrl(imageUrl);
      if (!blobPath) continue;
      referencedBlobPaths.add(blobPath);
      counters.variantBlobRefs += 1;
    }
  }

  const assetsRes = await client.query(`
    select url
    from assets
    where url is not null
  `);

  for (const row of assetsRes.rows ?? []) {
    counters.assetRows += 1;
    const blobPath = extractBlobPathFromUrl(row.url);
    if (!blobPath) continue;
    referencedBlobPaths.add(blobPath);
    counters.assetBlobRefs += 1;
  }

  // Guardrail adicional: evita borrar blobs referenciados solo por blobPath en assets.
  const assetBlobPathRes = await client.query(`
    select "blobPath"
    from assets
    where "blobPath" is not null
      and "blobPath" <> ''
  `);

  for (const row of assetBlobPathRes.rows ?? []) {
    counters.assetBlobPathRows += 1;
    const blobPath = normalizeBlobPath(row.blobPath);
    if (!blobPath) continue;
    referencedBlobPaths.add(blobPath);
    counters.assetBlobPathRefs += 1;
  }

  return { referencedBlobPaths, counters };
};

const main = async () => {
  await fs.mkdir(reportsDir, { recursive: true });

  const client = new pg.Client({ connectionString });
  await client.connect();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const batchLogPath = path.join(reportsDir, `blob-prune-batches-${stamp}.jsonl`);
  const summaryPath = path.join(reportsDir, `blob-prune-summary-${stamp}.json`);
  const latestSummaryPath = path.join(reportsDir, "blob-prune-summary-latest.json");

  try {
    const refs = await collectReferencedBlobPaths(client);
    console.log(
      JSON.stringify(
        {
          stage: "db_references_loaded",
          referencedBlobPaths: refs.referencedBlobPaths.size,
          counters: refs.counters,
          mode: apply ? "apply" : "dry_run",
          minAgeDaysByPrefix: {
            catalog: MIN_AGE_DAYS_CATALOG,
            imageProxy: MIN_AGE_DAYS_IMAGE_PROXY,
            default: DEFAULT_MIN_AGE_DAYS,
          },
          batchSize: BATCH_SIZE,
        },
        null,
        2,
      ),
    );

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    let totalBlobs = 0;
    let totalBytes = 0;
    let orphanAnyAgeCount = 0;
    let orphanAnyAgeBytes = 0;
    const candidates = [];
    let partialScan = false;

    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await listWithRetry({ token: blobToken, cursor });
      const blobs = Array.isArray(page.blobs) ? page.blobs : [];

      for (const blob of blobs) {
        totalBlobs += 1;
        const size = Number(blob.size ?? 0);
        totalBytes += size;

        const pathname = String(blob.pathname ?? "");
        if (refs.referencedBlobPaths.has(pathname)) {
          if (MAX_SCAN_BLOBS > 0 && totalBlobs >= MAX_SCAN_BLOBS) {
            partialScan = true;
            hasMore = false;
            break;
          }
          continue;
        }

        orphanAnyAgeCount += 1;
        orphanAnyAgeBytes += size;

        const uploadedAtMs = Date.parse(String(blob.uploadedAt ?? ""));
        if (Number.isFinite(uploadedAtMs)) {
          const ageDays = Math.floor((now - uploadedAtMs) / msPerDay);
          const minAgeDays = resolveMinAgeDays(pathname);
          if (ageDays >= minAgeDays) {
            candidates.push({
              pathname,
              size,
              uploadedAt: String(blob.uploadedAt ?? ""),
              ageDays,
              minAgeDays,
            });
          }
        }

        if (MAX_SCAN_BLOBS > 0 && totalBlobs >= MAX_SCAN_BLOBS) {
          partialScan = true;
          hasMore = false;
          break;
        }
      }

      if (totalBlobs % LIST_LOG_EVERY === 0 || !page.hasMore || !hasMore) {
        console.log(
          JSON.stringify(
            {
              stage: "blob_scan_progress",
              totalBlobs,
              orphanAnyAgeCount,
              candidateCount: candidates.length,
              hasMore: Boolean(page.hasMore && hasMore),
            },
            null,
            2,
          ),
        );
      }

      if (!hasMore) break;
      hasMore = Boolean(page.hasMore);
      cursor = page.cursor;
    }

    const eligibleBytes = candidates.reduce((acc, item) => acc + item.size, 0);
    const auditSummary = await loadLatestAuditSummary();
    const auditCountDiffAbs = auditSummary ? Math.abs(orphanAnyAgeCount - auditSummary.orphanTotalCount) : null;
    const auditBytesDiffAbs = auditSummary ? Math.abs(orphanAnyAgeBytes - auditSummary.orphanTotalBytes) : null;
    const auditCountDiffPct = auditSummary
      ? toPct(auditCountDiffAbs, Math.max(1, auditSummary.orphanTotalCount))
      : null;
    const auditBytesDiffPct = auditSummary
      ? toPct(auditBytesDiffAbs, Math.max(1, auditSummary.orphanTotalBytes))
      : null;
    const auditGateRequired = apply && REQUIRE_AUDIT_MATCH;
    const auditGatePassed = !auditGateRequired
      || (Boolean(auditSummary)
        && Number(auditCountDiffPct ?? 1000) <= AUDIT_MAX_DIFF_PCT
        && Number(auditBytesDiffPct ?? 1000) <= AUDIT_MAX_DIFF_PCT);
    const errorRateGatePassed = MAX_ERROR_RATE <= APPLY_MAX_ALLOWED_ERROR_RATE;
    const initialSummary = {
      generatedAt: new Date().toISOString(),
      mode: apply ? "apply" : "dry_run",
      partialScan,
      maxScanBlobs: MAX_SCAN_BLOBS,
      minAgeDaysByPrefix: {
        catalog: MIN_AGE_DAYS_CATALOG,
        imageProxy: MIN_AGE_DAYS_IMAGE_PROXY,
        default: DEFAULT_MIN_AGE_DAYS,
      },
      batchSize: BATCH_SIZE,
      maxDelete: MAX_DELETE,
      maxErrorRate: MAX_ERROR_RATE,
      blobScan: {
        totalBlobs,
        totalBytes,
        totalGb: toGb(totalBytes),
      },
      orphanBlobs: {
        anyAgeCount: orphanAnyAgeCount,
        anyAgeBytes: orphanAnyAgeBytes,
        anyAgeGb: toGb(orphanAnyAgeBytes),
        anyAgePctBytes: toPct(orphanAnyAgeBytes, totalBytes),
        eligibleCount: candidates.length,
        eligibleBytes,
        eligibleGb: toGb(eligibleBytes),
        eligiblePctBytes: toPct(eligibleBytes, totalBytes),
      },
      references: {
        referencedBlobPaths: refs.referencedBlobPaths.size,
        counters: refs.counters,
      },
      guardrails: {
        applyMaxAllowedErrorRate: APPLY_MAX_ALLOWED_ERROR_RATE,
        configuredMaxErrorRate: MAX_ERROR_RATE,
        configuredMaxErrorRatePassed: errorRateGatePassed,
        auditMatchRequired: auditGateRequired,
        auditMaxDiffPct: AUDIT_MAX_DIFF_PCT,
        auditMatchPassed: auditGatePassed,
        audit: auditSummary
          ? {
              source: auditSummary.source,
              generatedAt: auditSummary.generatedAt,
              orphanTotalCount: auditSummary.orphanTotalCount,
              orphanTotalBytes: auditSummary.orphanTotalBytes,
              countDiffAbs: auditCountDiffAbs,
              countDiffPct: auditCountDiffPct,
              bytesDiffAbs: auditBytesDiffAbs,
              bytesDiffPct: auditBytesDiffPct,
            }
          : null,
      },
      outputs: {
        batchLogPath,
        summaryPath,
        latestSummaryPath,
      },
      execution: {
        deletedCount: 0,
        deletedBytes: 0,
        failedCount: 0,
        failedBytes: 0,
        stoppedByGuardrail: false,
        stopReason: null,
        failedSample: [],
      },
      candidateSample: candidates.slice(0, 25),
    };

    if (!apply) {
      await fs.writeFile(summaryPath, JSON.stringify(initialSummary, null, 2), "utf8");
      await fs.writeFile(latestSummaryPath, JSON.stringify(initialSummary, null, 2), "utf8");
      console.log(JSON.stringify({ done: true, mode: "dry_run", summaryPath }, null, 2));
      return;
    }

    if (!errorRateGatePassed || !auditGatePassed) {
      const finalSummary = {
        ...initialSummary,
        execution: {
          ...initialSummary.execution,
          stoppedByGuardrail: true,
          stopReason: !errorRateGatePassed
            ? `configured_max_error_rate_exceeded:${MAX_ERROR_RATE}>${APPLY_MAX_ALLOWED_ERROR_RATE}`
            : `audit_mismatch_exceeded:${Math.max(auditCountDiffPct ?? 0, auditBytesDiffPct ?? 0).toFixed(2)}>${AUDIT_MAX_DIFF_PCT}`,
        },
      };
      await fs.writeFile(summaryPath, JSON.stringify(finalSummary, null, 2), "utf8");
      await fs.writeFile(latestSummaryPath, JSON.stringify(finalSummary, null, 2), "utf8");
      console.error(
        JSON.stringify(
          {
            done: false,
            mode: "apply",
            stoppedByGuardrail: true,
            stopReason: finalSummary.execution.stopReason,
            summaryPath,
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }

    await fs.writeFile(batchLogPath, "", "utf8");

    const sizeByPath = new Map(candidates.map((item) => [item.pathname, item.size]));
    let deletedCount = 0;
    let deletedBytes = 0;
    let failedCount = 0;
    let failedBytes = 0;
    let stoppedByGuardrail = false;
    let stopReason = null;
    const failedSample = [];

    const totalBatches = Math.max(1, Math.ceil(candidates.length / BATCH_SIZE));

    for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + BATCH_SIZE);
      const batchIndex = Math.floor(offset / BATCH_SIZE) + 1;
      const paths = batch.map((item) => item.pathname);

      if (MAX_DELETE > 0 && deletedCount >= MAX_DELETE) {
        stoppedByGuardrail = true;
        stopReason = `max_delete_reached:${MAX_DELETE}`;
        break;
      }

      if (MAX_DELETE > 0 && deletedCount + paths.length > MAX_DELETE) {
        paths.splice(MAX_DELETE - deletedCount);
      }

      const startedAt = new Date().toISOString();
      const batchResult = {
        batchIndex,
        totalBatches,
        startedAt,
        requested: paths.length,
        deleted: 0,
        failed: 0,
        mode: "batch",
        error: null,
      };

      const batchDelete = await deleteWithRetry(paths);
      if (batchDelete.ok) {
        batchResult.deleted = paths.length;
        deletedCount += paths.length;
        deletedBytes += paths.reduce((acc, pathname) => acc + Number(sizeByPath.get(pathname) ?? 0), 0);
      } else {
        batchResult.mode = "fallback_single";
        batchResult.error = batchDelete.error;

        for (const pathname of paths) {
          const singleDelete = await deleteWithRetry(pathname);
          if (singleDelete.ok) {
            batchResult.deleted += 1;
            deletedCount += 1;
            deletedBytes += Number(sizeByPath.get(pathname) ?? 0);
            continue;
          }

          batchResult.failed += 1;
          failedCount += 1;
          const size = Number(sizeByPath.get(pathname) ?? 0);
          failedBytes += size;
          if (failedSample.length < 50) {
            failedSample.push({ pathname, size, error: singleDelete.error });
          }
        }
      }

      const processed = deletedCount + failedCount;
      const failureRate = processed > 0 ? failedCount / processed : 0;
      const endedAt = new Date().toISOString();

      await fs.appendFile(
        batchLogPath,
        `${JSON.stringify({
          ...batchResult,
          endedAt,
          cumulative: { deletedCount, failedCount, failureRate: Number(failureRate.toFixed(4)) },
        })}\n`,
        "utf8",
      );

      console.log(
        JSON.stringify(
          {
            stage: "delete_batch",
            batchIndex,
            totalBatches,
            deletedCount,
            failedCount,
            failureRate: Number(failureRate.toFixed(4)),
          },
          null,
          2,
        ),
      );

      if (failureRate > MAX_ERROR_RATE) {
        stoppedByGuardrail = true;
        stopReason = `error_rate_exceeded:${failureRate.toFixed(4)}>${MAX_ERROR_RATE}`;
        break;
      }
    }

    const finalSummary = {
      ...initialSummary,
      execution: {
        deletedCount,
        deletedBytes,
        deletedGb: toGb(deletedBytes),
        failedCount,
        failedBytes,
        failedGb: toGb(failedBytes),
        stoppedByGuardrail,
        stopReason,
        failedSample,
      },
    };

    await fs.writeFile(summaryPath, JSON.stringify(finalSummary, null, 2), "utf8");
    await fs.writeFile(latestSummaryPath, JSON.stringify(finalSummary, null, 2), "utf8");

    console.log(
      JSON.stringify(
        {
          done: true,
          mode: "apply",
          deletedCount,
          deletedGb: toGb(deletedBytes),
          failedCount,
          failedGb: toGb(failedBytes),
          stoppedByGuardrail,
          stopReason,
          summaryPath,
          batchLogPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error("prune-orphan-blobs.failed", error);
  process.exit(1);
});
