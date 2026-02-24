import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";
import { head, list, put } from "@vercel/blob";
import { optimizeBeforeBlob, summarizeImageOptimization } from "./_image-optimize.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

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

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = Math.max(
  MAX_IMAGE_BYTES,
  Number(process.env.VARIANT_IMAGE_BACKFILL_MAX_SOURCE_IMAGE_BYTES ?? 32 * 1024 * 1024),
);
const DEFAULT_TIMEOUT_MS = 12000;
const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ENABLE_LIST_FALLBACK =
  (process.env.BLOB_ENABLE_LIST_FALLBACK ?? process.env.IMAGE_BACKFILL_LIST_FALLBACK ?? "")
    .trim()
    .toLowerCase() === "true";

const LIMIT = Math.max(0, Number(process.env.VARIANT_IMAGE_BACKFILL_LIMIT ?? process.env.BACKFILL_LIMIT ?? 500));
const CONCURRENCY = Math.max(
  1,
  Number(process.env.VARIANT_IMAGE_BACKFILL_CONCURRENCY ?? process.env.BACKFILL_CONCURRENCY ?? 6),
);
const BRAND_SLUG = (process.env.VARIANT_IMAGE_BACKFILL_BRAND_SLUG ?? "").trim() || null;
const ONLY_ENRICHED = process.env.VARIANT_IMAGE_BACKFILL_ONLY_ENRICHED === "true";
const DRY_RUN =
  process.env.VARIANT_IMAGE_BACKFILL_DRY_RUN === "true" || process.env.DRY_RUN === "true";
const LOG_EVERY = Math.max(10, Number(process.env.VARIANT_IMAGE_BACKFILL_LOG_EVERY ?? 50));
const MAX_ITEMS_PER_HOUR = Math.max(
  0,
  Number(
    process.env.VARIANT_IMAGE_BACKFILL_MAX_ITEMS_PER_HOUR ??
      process.env.BACKFILL_MAX_ITEMS_PER_HOUR ??
      4000,
  ),
);
const MAX_IMAGES_PER_VARIANT = Math.max(1, Number(process.env.VARIANT_IMAGE_BACKFILL_MAX_IMAGES ?? 40));
const MAX_ERROR_RATE = Math.max(0, Math.min(1, Number(process.env.VARIANT_IMAGE_BACKFILL_MAX_ERROR_RATE ?? 0.02)));
const ERROR_RATE_MIN_SAMPLES = Math.max(
  1,
  Number(process.env.VARIANT_IMAGE_BACKFILL_ERROR_RATE_MIN_SAMPLES ?? 100),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIN_INTERVAL_MS = MAX_ITEMS_PER_HOUR > 0 ? Math.ceil((60 * 60 * 1000) / MAX_ITEMS_PER_HOUR) : 0;
let nextRateSlotAt = 0;
let rateQueue = Promise.resolve();

const waitForRateLimit = async () => {
  if (MIN_INTERVAL_MS <= 0) return;
  let release = () => {};
  const previous = rateQueue;
  rateQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const now = Date.now();
    if (nextRateSlotAt > now) {
      await sleep(nextRateSlotAt - now);
    }
    nextRateSlotAt = Date.now() + MIN_INTERVAL_MS;
  } finally {
    release();
  }
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const BLOB_HOST_FRAGMENT = "blob.vercel-storage.com";
const ALLOW_EXTERNAL_MEDIA_WRITE = (process.env.ALLOW_EXTERNAL_MEDIA_WRITE ?? "").trim().toLowerCase() === "true";

const isIpv4Hostname = (hostname) => /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
const isPrivateIpv4 = (hostname) => {
  if (!isIpv4Hostname(hostname)) return false;
  const parts = hostname.split(".").map((value) => Number(value));
  if (parts.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
};

const normalizeSourceUrl = (raw) => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.length > 8192) return null;
  if (trimmed.startsWith("data:")) return null;
  const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  const normalized = /^https?:\/\//i.test(withProtocol)
    ? withProtocol
    : `https://${withProtocol.replace(/^\/+/, "")}`;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (LOCAL_HOSTS.has(hostname) || isPrivateIpv4(hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const getOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const extensionFromContentType = (contentType) => {
  if (!contentType) return null;
  if (contentType.includes("avif")) return ".avif";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  return null;
};

const extensionFromUrl = (url) => {
  try {
    const pathname = new URL(url).pathname;
    const extMatch = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (!extMatch) return ".jpg";
    const ext = extMatch[1].toLowerCase();
    if (ext === "jpeg") return ".jpg";
    return `.${ext}`;
  } catch {
    return ".jpg";
  }
};

const getExtension = (url, contentType) => extensionFromContentType(contentType) ?? extensionFromUrl(url);

const fetchWithTimeout = async (url, timeoutMs, headers) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const isBlobNotFound = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("does not exist");
};

const resolveExistingBlobByHead = async (pathname, token) => {
  try {
    const meta = await head(pathname, { token });
    return meta.url ?? null;
  } catch (error) {
    if (isBlobNotFound(error)) return null;
    const message = error instanceof Error ? error.message : String(error);
    console.warn("variant-image.backfill.head.failed", pathname, message);
    return null;
  }
};

const resolveExistingBlobByListFallback = async (prefix, token) => {
  if (!ENABLE_LIST_FALLBACK) return null;
  try {
    const res = await list({ prefix, limit: 3, token });
    const match = res.blobs.find((blob) => blob.pathname.startsWith(prefix));
    return match?.url ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("variant-image.backfill.list.fallback.failed", prefix, message);
    return null;
  }
};

const resolvedCache = new Map();
const failedSourceCache = new Map();
const cacheToBlob = async (sourceUrl, token) => {
  const cached = resolvedCache.get(sourceUrl);
  if (cached) return cached;

  const hash = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 40);
  const baseKey = `image-proxy/${hash}`;
  const defaultPath = `${baseKey}${extensionFromUrl(sourceUrl)}`;

  const hitByHead = await resolveExistingBlobByHead(defaultPath, token);
  if (hitByHead) {
    const entry = { url: hitByHead, optimization: null };
    resolvedCache.set(sourceUrl, entry);
    return entry;
  }

  const hitByListFallback = await resolveExistingBlobByListFallback(baseKey, token);
  if (hitByListFallback) {
    const entry = { url: hitByListFallback, optimization: null };
    resolvedCache.set(sourceUrl, entry);
    return entry;
  }

  const defaultHeaders = {
    "user-agent": "ODA-VariantImageBackfill/1.0",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };

  let res = await fetchWithTimeout(sourceUrl, DEFAULT_TIMEOUT_MS, defaultHeaders);
  if (!res.ok) {
    const origin = getOrigin(sourceUrl);
    if (origin) {
      res = await fetchWithTimeout(sourceUrl, DEFAULT_TIMEOUT_MS, { ...defaultHeaders, referer: origin });
    }
  }
  if (!res.ok) throw new Error(`fetch_failed:${res.status}`);

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength && contentLength > MAX_IMAGE_BYTES) throw new Error(`too_large:${contentLength}`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_SOURCE_IMAGE_BYTES) throw new Error(`too_large:${buffer.length}`);

  const contentType = res.headers.get("content-type");
  const optimized = await optimizeBeforeBlob({
    buffer,
    sourceUrl,
    contentType,
    context: "backfill-variant",
  });
  if (optimized.buffer.length > MAX_IMAGE_BYTES) throw new Error(`too_large:${optimized.buffer.length}`);
  const ext = optimized.extension || getExtension(sourceUrl, optimized.contentType ?? contentType);
  const pathname = `${baseKey}${ext}`;
  if (pathname !== defaultPath) {
    const hitByTypedHead = await resolveExistingBlobByHead(pathname, token);
    if (hitByTypedHead) {
      const entry = { url: hitByTypedHead, optimization: null };
      resolvedCache.set(sourceUrl, entry);
      return entry;
    }
  }

  const blob = await put(pathname, optimized.buffer, {
    access: "public",
    addRandomSuffix: false,
    cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
    contentType: optimized.contentType ?? contentType ?? undefined,
    token,
  });

  const entry = { url: blob.url, optimization: optimized.stats };
  resolvedCache.set(sourceUrl, entry);
  return entry;
};

const isBlobUrl = (value) => typeof value === "string" && value.includes(BLOB_HOST_FRAGMENT);

const main = async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();

  const where = [
    `cardinality(v.images) > 0`,
    `exists (
      select 1
      from unnest(v.images) as img
      where img is not null
        and img <> ''
        and img not like '%blob.vercel-storage.com%'
    )`,
  ];
  const values = [];

  if (ONLY_ENRICHED) {
    where.push(`(p."metadata" -> 'enrichment') is not null`);
  }
  if (BRAND_SLUG) {
    values.push(BRAND_SLUG);
    where.push(`b.slug = $${values.length}`);
  }

  const limitSql = LIMIT > 0 ? `limit ${LIMIT}` : "";

  const sql = `
    select
      v.id,
      v.images,
      p.id as "productId",
      b.slug as "brandSlug"
    from variants v
    join products p on p.id = v."productId"
    join brands b on b.id = p."brandId"
    where ${where.join(" and ")}
    order by v."updatedAt" desc
    ${limitSql}
  `;

  const res = await client.query(sql, values);
  const rows = Array.isArray(res.rows) ? res.rows : [];

  console.log(
    JSON.stringify(
      {
        totalCandidates: rows.length,
        brand: BRAND_SLUG,
        onlyEnriched: ONLY_ENRICHED,
        limit: LIMIT,
        concurrency: CONCURRENCY,
        maxItemsPerHour: MAX_ITEMS_PER_HOUR,
        maxImagesPerVariant: MAX_IMAGES_PER_VARIANT,
        maxErrorRate: MAX_ERROR_RATE,
        errorRateMinSamples: ERROR_RATE_MIN_SAMPLES,
        dryRun: DRY_RUN,
      },
      null,
      2,
    ),
  );

  let cursor = 0;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let migratedImages = 0;
  let imageFailures = 0;
  let partialVariants = 0;
  let throttledImages = 0;
  let knownFailureSkips = 0;
  const optimizationSamples = [];
  let abortReason = null;
  let shouldAbort = false;

  const getErrorRate = () => (processed > 0 ? failed / processed : 0);
  const maybeAbortByErrorRate = () => {
    if (shouldAbort) return;
    if (processed < ERROR_RATE_MIN_SAMPLES) return;
    const errorRate = getErrorRate();
    if (errorRate <= MAX_ERROR_RATE) return;
    shouldAbort = true;
    abortReason = {
      reason: "error_rate_guardrail",
      maxErrorRate: MAX_ERROR_RATE,
      currentErrorRate: Number(errorRate.toFixed(4)),
      minSamples: ERROR_RATE_MIN_SAMPLES,
      processed,
      failed,
      updated,
      skipped,
      partialVariants,
      migratedImages,
      imageFailures,
      throttledImages,
      knownFailureSkips,
    };
    console.error("variant-image.backfill.guardrail.triggered", JSON.stringify(abortReason));
  };

  const worker = async () => {
    while (true) {
      if (shouldAbort) return;
      const index = cursor;
      if (index >= rows.length) return;
      cursor += 1;
      const row = rows[index];
      processed += 1;

      const inputImages = Array.isArray(row.images) ? row.images : [];
      const nextImages = [];
      let changedInVariant = 0;
      let failedInVariant = 0;
      let processedExternalImages = 0;
      const variantOptimizationSamples = [];

      for (const rawValue of inputImages) {
        if (typeof rawValue !== "string") {
          nextImages.push(rawValue);
          continue;
        }

        const original = rawValue.trim();
        if (!original) {
          nextImages.push(rawValue);
          continue;
        }

        if (isBlobUrl(original)) {
          nextImages.push(original);
          continue;
        }

        if (processedExternalImages >= MAX_IMAGES_PER_VARIANT) {
          nextImages.push(rawValue);
          throttledImages += 1;
          continue;
        }

        const sourceUrl = normalizeSourceUrl(original);
        if (!sourceUrl) {
          nextImages.push(rawValue);
          failedInVariant += 1;
          imageFailures += 1;
          continue;
        }

        if (failedSourceCache.has(sourceUrl)) {
          nextImages.push(rawValue);
          failedInVariant += 1;
          knownFailureSkips += 1;
          continue;
        }
        processedExternalImages += 1;

        try {
          await waitForRateLimit();
          const blobAsset = await cacheToBlob(sourceUrl, blobToken);
          nextImages.push(blobAsset.url);
          if (blobAsset.optimization) {
            optimizationSamples.push(blobAsset.optimization);
            variantOptimizationSamples.push(blobAsset.optimization);
          }
          if (blobAsset.url !== original) {
            changedInVariant += 1;
            migratedImages += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!failedSourceCache.has(sourceUrl)) {
            console.warn("variant-image.backfill.image_failed", row.id, sourceUrl, message);
          }
          failedSourceCache.set(sourceUrl, message);
          nextImages.push(rawValue);
          failedInVariant += 1;
          imageFailures += 1;
        }
      }

      if (changedInVariant > 0) {
        const remainingExternal = nextImages.filter(
          (item) => typeof item === "string" && item.trim() && !isBlobUrl(item),
        ).length;
        if (remainingExternal > 0 && !ALLOW_EXTERNAL_MEDIA_WRITE) {
          failed += 1;
          continue;
        }
        if (!DRY_RUN) {
          const variantOptimizationSummary = summarizeImageOptimization(variantOptimizationSamples);
          if (variantOptimizationSummary.count > 0) {
            const metadataPayload = {
              ...variantOptimizationSummary,
              context: "backfill_variant",
              updatedAt: new Date().toISOString(),
              ...(ALLOW_EXTERNAL_MEDIA_WRITE ? { allow_external_media_write: true } : {}),
            };
            await client.query(
              `
                update variants
                set images=$1,
                    metadata=jsonb_set(
                      coalesce(metadata, '{}'::jsonb),
                      '{image_optimization}',
                      $3::jsonb,
                      true
                    ),
                    "updatedAt"=now()
                where id=$2
              `,
              [
                nextImages,
                row.id,
                JSON.stringify(metadataPayload),
              ],
            );
          } else if (ALLOW_EXTERNAL_MEDIA_WRITE) {
            await client.query(
              `
                update variants
                set images=$1,
                    metadata=jsonb_set(
                      coalesce(metadata, '{}'::jsonb),
                      '{allow_external_media_write}',
                      'true'::jsonb,
                      true
                    ),
                    "updatedAt"=now()
                where id=$2
              `,
              [nextImages, row.id],
            );
          } else {
            await client.query(`update variants set images=$1, "updatedAt"=now() where id=$2`, [nextImages, row.id]);
          }
        }
        updated += 1;
        if (failedInVariant > 0) partialVariants += 1;
      } else if (failedInVariant > 0) {
        failed += 1;
      } else {
        skipped += 1;
      }

      maybeAbortByErrorRate();

      if (processed % LOG_EVERY === 0 || processed === rows.length || shouldAbort) {
        console.log(
          JSON.stringify(
            {
              processed,
              total: rows.length,
              updated,
              skipped,
              failed,
              partialVariants,
              migratedImages,
              imageFailures,
              throttledImages,
              knownFailureSkips,
              errorRate: Number(getErrorRate().toFixed(4)),
              aborted: shouldAbort,
              pct: Math.round((processed / rows.length) * 100),
            },
            null,
            2,
          ),
        );
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker());
  await Promise.all(workers);

  await client.end();
  const optimizationSummary = summarizeImageOptimization(optimizationSamples);
  console.log(
    JSON.stringify(
      {
        done: true,
        processed,
        updated,
        skipped,
        failed,
        partialVariants,
        migratedImages,
        imageFailures,
        throttledImages,
        knownFailureSkips,
        errorRate: Number(getErrorRate().toFixed(4)),
        optimization: optimizationSummary,
        aborted: shouldAbort,
        abortReason,
      },
      null,
      2,
    ),
  );

  if (shouldAbort) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error("variant-image.backfill.failed", error);
  process.exit(1);
});
