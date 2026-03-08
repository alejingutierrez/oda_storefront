import { put } from "@vercel/blob";
import { hashBuffer } from "@/lib/catalog/utils";
import { isRedisEnabled, readJsonCache, writeJsonCache } from "@/lib/redis";
import { optimizeBeforeBlob } from "@/lib/media/optimize-before-blob";
import type { ImageOptimizationStats } from "@/lib/media/optimize-before-blob";
import { safeEnvInt, safeEnvNumber } from "@/lib/safe-number";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = safeEnvNumber("BLOB_UPLOAD_MAX_SOURCE_IMAGE_BYTES", {
  fallback: 32 * 1024 * 1024,
  min: MAX_IMAGE_BYTES,
});
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_CONCURRENCY = 4;
const REDIS_BLOB_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
let blobUploadsDisabled = false;
let blobDisableReason: string | null = null;

const resolveBlobToken = () =>
  process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || "";

const sanitizeBlobPath = (value: string) =>
  value
    .replace(/[#?]/g, "_")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const buildBlobKey = (prefix: string, hash: string, ext: string) => {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  if (normalizedPrefix.startsWith("catalog/")) {
    return sanitizeBlobPath(`catalog/by-hash/${hash}${ext}`);
  }
  return sanitizeBlobPath(`${normalizedPrefix}/${hash}${ext}`);
};

const isAccessDenied = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  // Distinguish source hotlink/auth failures from Blob auth failures.
  // Example source error: "Image fetch failed: 401 https://...".
  if (normalized.includes("image fetch failed")) return false;
  return (
    normalized.includes("access denied") ||
    normalized.includes("invalid blob token") ||
    normalized.includes("invalid token") ||
    normalized.includes("unauthorized")
  );
};

const fetchWithTimeout = async (url: string, timeoutMs: number, headers?: Record<string, string>) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timeout);
  }
};

export const uploadImageToBlob = async (url: string, prefix: string, token: string, timeoutMs: number) => {
  const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;
  if (!token) {
    throw new Error("Missing BLOB_READ_WRITE_TOKEN");
  }

  const defaultHeaders = {
    "user-agent": "ODA-CatalogExtractor/1.0",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  let res = await fetchWithTimeout(normalizedUrl, timeoutMs, defaultHeaders);
  if (!res.ok) {
    const origin = new URL(normalizedUrl).origin;
    res = await fetchWithTimeout(normalizedUrl, timeoutMs, {
      ...defaultHeaders,
      referer: origin,
    });
  }
  if (!res.ok) {
    throw new Error(`Image fetch failed: ${res.status} ${normalizedUrl}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image too large (${buffer.length} bytes)`);
  }

  const contentType = res.headers.get("content-type");
  const optimized = await optimizeBeforeBlob({
    buffer,
    sourceUrl: normalizedUrl,
    contentType,
    context: "catalog",
  });
  if (optimized.buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Optimized image too large (${optimized.buffer.length} bytes)`);
  }

  const hash = hashBuffer(optimized.buffer).slice(0, 16);
  const ext = optimized.extension;
  const key = buildBlobKey(prefix, hash, ext);

  // RC-2b: Check Redis to skip redundant put() for already-uploaded content
  const redisCacheKey = `blob:cat:${hash}${ext}`;
  if (isRedisEnabled()) {
    const redisHit = await readJsonCache<{ url: string; blobPath: string }>(redisCacheKey);
    if (redisHit) {
      return {
        url: redisHit.url,
        blobPath: redisHit.blobPath,
        sourceUrl: normalizedUrl,
        optimization: optimized.stats,
      };
    }
  }

  const blob = await put(key, optimized.buffer, {
    access: "public",
    contentType: optimized.contentType ?? contentType ?? undefined,
    token,
    addRandomSuffix: false,
  });

  const result = {
    url: blob.url,
    blobPath: blob.pathname ?? key,
    sourceUrl: normalizedUrl,
    optimization: optimized.stats,
  };
  await writeJsonCache(redisCacheKey, { url: result.url, blobPath: result.blobPath }, REDIS_BLOB_TTL_SECONDS);
  return result;
};

export const uploadImagesToBlob = async (
  urls: string[],
  prefix: string,
  preSeed?: Map<string, { url: string; optimization?: ImageOptimizationStats }>,
) => {
  const unique = Array.from(
    new Set(
      urls
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const mapping = new Map<
    string,
    {
      url: string;
      blobPath: string;
      sourceUrl: string;
      optimization?: ImageOptimizationStats;
    }
  >();
  if (preSeed) {
    for (const [srcUrl, entry] of preSeed) {
      mapping.set(srcUrl, { url: entry.url, blobPath: "", sourceUrl: srcUrl, optimization: entry.optimization });
    }
  }
  const token = resolveBlobToken();
  if (!token) {
    blobUploadsDisabled = true;
    blobDisableReason = "Missing BLOB_READ_WRITE_TOKEN";
  }
  if (blobUploadsDisabled) {
    throw new Error(blobDisableReason ?? "Blob uploads disabled");
  }

  const concurrency = safeEnvInt("BLOB_UPLOAD_CONCURRENCY", { fallback: DEFAULT_CONCURRENCY, min: 1 });
  const timeoutMs = safeEnvInt("BLOB_UPLOAD_TIMEOUT_MS", { fallback: DEFAULT_TIMEOUT_MS, min: 3000 });
  let cursor = 0;
  const failures: string[] = [];

  const worker = async () => {
    while (cursor < unique.length && !blobUploadsDisabled) {
      const url = unique[cursor];
      cursor += 1;
      if (mapping.has(url)) continue;
      try {
        const uploaded = await uploadImageToBlob(url, prefix, token, timeoutMs);
        mapping.set(url, uploaded);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("blob.upload.failed", url, message);
        if (isAccessDenied(error)) {
          blobUploadsDisabled = true;
          blobDisableReason = "Access denied: invalid blob token";
        } else {
          failures.push(url);
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker());
  await Promise.all(workers);

  if (blobUploadsDisabled) {
    throw new Error(blobDisableReason ?? "Blob uploads disabled");
  }
  if (failures.length && mapping.size === 0) {
    const sample = failures.slice(0, 3).join(", ");
    throw new Error(`Blob upload failed for ${failures.length} images (sample: ${sample})`);
  }
  if (failures.length) {
    const sample = failures.slice(0, 3).join(", ");
    console.warn(`blob.upload.partial_failures ${failures.length} (sample: ${sample})`);
  }

  return mapping;
};
