import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";
import { list, put } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Este repo guarda `.env` en la raiz; los scripts viven en `apps/web/scripts`.
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
const DEFAULT_TIMEOUT_MS = 12000;
const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const LIMIT = Math.max(0, Number(process.env.IMAGE_BACKFILL_LIMIT ?? 500));
const CONCURRENCY = Math.max(1, Number(process.env.IMAGE_BACKFILL_CONCURRENCY ?? 6));
const ONLY_ENRICHED = process.env.IMAGE_BACKFILL_ONLY_ENRICHED !== "false";
const BRAND_SLUG = (process.env.IMAGE_BACKFILL_BRAND_SLUG ?? "").trim() || null;
const DRY_RUN = process.env.DRY_RUN === "true";
const LOG_EVERY = Math.max(10, Number(process.env.IMAGE_BACKFILL_LOG_EVERY ?? 50));

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
  if (!trimmed || trimmed.length > 2048) return null;
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

const getExtension = (url, contentType) => {
  if (contentType) {
    if (contentType.includes("avif")) return ".avif";
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("png")) return ".png";
    if (contentType.includes("gif")) return ".gif";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  }
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

const fetchWithTimeout = async (url, timeoutMs, headers) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const resolveExistingBlob = async (prefix, token) => {
  const res = await list({ prefix, limit: 3, token });
  const match = res.blobs.find((blob) => blob.pathname.startsWith(prefix));
  return match?.url ?? null;
};

const resolvedCache = new Map();
const cacheToBlob = async (sourceUrl, token) => {
  const cached = resolvedCache.get(sourceUrl);
  if (cached) return cached;

  const hash = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 40);
  const baseKey = `image-proxy/${hash}`;

  const existing = await resolveExistingBlob(baseKey, token);
  if (existing) {
    resolvedCache.set(sourceUrl, existing);
    return existing;
  }

  const defaultHeaders = {
    "user-agent": "ODA-ImageBackfill/1.0",
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
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`too_large:${buffer.length}`);

  const contentType = res.headers.get("content-type");
  const ext = getExtension(sourceUrl, contentType);
  const pathname = `${baseKey}${ext}`;

  const blob = await put(pathname, buffer, {
    access: "public",
    addRandomSuffix: false,
    cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
    contentType: contentType ?? undefined,
    token,
  });

  resolvedCache.set(sourceUrl, blob.url);
  return blob.url;
};

const main = async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();

  const where = [
    `p."imageCoverUrl" is not null`,
    `p."imageCoverUrl" not like '%blob.vercel-storage.com%'`,
  ];
  const values = [];
  if (ONLY_ENRICHED) where.push(`(p."metadata" -> 'enrichment') is not null`);
  if (BRAND_SLUG) {
    values.push(BRAND_SLUG);
    where.push(`b.slug = $${values.length}`);
  }

  const limitSql = LIMIT > 0 ? `limit ${LIMIT}` : "";

  const sql = `
    select
      p.id,
      p."imageCoverUrl" as url
    from products p
    join brands b on b.id = p."brandId"
    where ${where.join(" and ")}
    order by p."createdAt" desc
    ${limitSql}
  `;

  const res = await client.query(sql, values);
  const rows = Array.isArray(res.rows) ? res.rows : [];
  console.log(
    JSON.stringify(
      {
        totalCandidates: rows.length,
        onlyEnriched: ONLY_ENRICHED,
        brand: BRAND_SLUG,
        limit: LIMIT,
        concurrency: CONCURRENCY,
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

  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      processed += 1;

      const sourceUrl = normalizeSourceUrl(row.url);
      if (!sourceUrl) {
        skipped += 1;
      } else {
        try {
          const blobUrl = await cacheToBlob(sourceUrl, blobToken);
          if (!DRY_RUN) {
            await client.query(
              `update products set "imageCoverUrl"=$1, "updatedAt"=now() where id=$2`,
              [blobUrl, row.id],
            );
          }
          updated += 1;
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          console.warn("image-cover.backfill.failed", row.id, sourceUrl ?? row.url, message);
        }
      }

      if (processed % LOG_EVERY === 0 || processed === rows.length) {
        console.log(
          JSON.stringify(
            { processed, total: rows.length, updated, skipped, failed, pct: Math.round((processed / rows.length) * 100) },
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
  console.log(JSON.stringify({ done: true, processed, updated, skipped, failed }, null, 2));
};

main().catch((err) => {
  console.error("Backfill error", err);
  process.exit(1);
});

