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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = Math.max(
  MAX_IMAGE_BYTES,
  Number(process.env.BRAND_LOGO_BACKFILL_MAX_SOURCE_IMAGE_BYTES ?? 24 * 1024 * 1024),
);
const DEFAULT_TIMEOUT_MS = 10000;
const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const LIMIT = Math.max(0, Number(process.env.BRAND_LOGO_BACKFILL_LIMIT ?? 400));
const CONCURRENCY = Math.max(1, Number(process.env.BRAND_LOGO_BACKFILL_CONCURRENCY ?? 6));
const DRY_RUN = process.env.BRAND_LOGO_BACKFILL_DRY_RUN === "true" || process.env.DRY_RUN === "true";
const LOG_EVERY = Math.max(20, Number(process.env.BRAND_LOGO_BACKFILL_LOG_EVERY ?? 50));
const ENABLE_LIST_FALLBACK = (process.env.BLOB_ENABLE_LIST_FALLBACK ?? "").trim().toLowerCase() === "true";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
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
  if (contentType.includes("svg")) return ".svg";
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
    console.warn("brand-logo.backfill.head.failed", pathname, message);
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
    console.warn("brand-logo.backfill.list.fallback.failed", prefix, message);
    return null;
  }
};

const resolvedCache = new Map();
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
    "user-agent": "ODA-BrandLogoBackfill/1.0",
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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
    context: "backfill-cover",
  });
  if (optimized.buffer.length > MAX_IMAGE_BYTES) throw new Error(`too_large:${optimized.buffer.length}`);
  const ext = optimized.extension || getExtension(sourceUrl, optimized.contentType ?? contentType);
  const pathname = `${baseKey}${ext}`;

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

const main = async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();

  const limitSql = LIMIT > 0 ? `limit ${LIMIT}` : "";
  const sql = `
    select
      b.id,
      b.slug,
      b."logoUrl" as "logoUrl"
    from brands b
    where b."logoUrl" is not null
      and b."logoUrl" not like '%blob.vercel-storage.com%'
    order by b."updatedAt" desc
    ${limitSql}
  `;

  const res = await client.query(sql);
  const rows = Array.isArray(res.rows) ? res.rows : [];
  console.log(JSON.stringify({ totalCandidates: rows.length, limit: LIMIT, concurrency: CONCURRENCY, dryRun: DRY_RUN }, null, 2));

  let cursor = 0;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const optimizationSamples = [];

  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      if (!row) continue;

      processed += 1;
      const sourceUrl = normalizeSourceUrl(row.logoUrl);
      if (!sourceUrl) {
        skipped += 1;
        continue;
      }

      try {
        const blobAsset = await cacheToBlob(sourceUrl, blobToken);
        if (blobAsset.optimization) optimizationSamples.push(blobAsset.optimization);
        if (row.logoUrl === blobAsset.url) {
          skipped += 1;
          continue;
        }

        if (!DRY_RUN) {
          await client.query(`update brands set "logoUrl" = $1 where id = $2`, [blobAsset.url, row.id]);
        }
        updated += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn("brand-logo.backfill.failed", { brandId: row.id, slug: row.slug, message });
      }

      if (processed % LOG_EVERY === 0) {
        console.log(JSON.stringify({ processed, updated, skipped, failed }, null, 2));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, () => worker()));

  const summary = summarizeImageOptimization(optimizationSamples);
  console.log(
    JSON.stringify(
      {
        done: true,
        processed,
        updated,
        skipped,
        failed,
        dryRun: DRY_RUN,
        optimization: summary,
      },
      null,
      2,
    ),
  );

  await client.end();
};

main().catch((error) => {
  console.error("brand-logo.backfill.unhandled", error);
  process.exit(1);
});
