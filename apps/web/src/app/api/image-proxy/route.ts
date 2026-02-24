import crypto from "node:crypto";
import { head, list, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  optimizeBeforeBlob,
  summarizeImageOptimization,
  type ImageOptimizationStats,
} from "@/lib/media/optimize-before-blob";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = Math.max(
  MAX_IMAGE_BYTES,
  Number(process.env.IMAGE_PROXY_MAX_SOURCE_IMAGE_BYTES ?? 32 * 1024 * 1024),
);
const DEFAULT_TIMEOUT_MS = 12000;
const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";
const ENABLE_LIST_FALLBACK = process.env.IMAGE_PROXY_LIST_FALLBACK === "true";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || "";
const ALLOW_EXTERNAL_MEDIA_WRITE = (process.env.ALLOW_EXTERNAL_MEDIA_WRITE ?? "").trim().toLowerCase() === "true";
type BlobCacheEntry = {
  url: string;
  optimization: ImageOptimizationStats | null;
};
const resolvedCache = new Map<string, BlobCacheEntry>();

const isIpv4Hostname = (hostname: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);

const isPrivateIpv4 = (hostname: string) => {
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

const extractCdnCgiUrl = (value: string) => {
  const lower = value.toLowerCase();
  if (!lower.includes("cdn-cgi/image")) return null;
  const httpsIndex = value.indexOf("/https://");
  const httpIndex = value.indexOf("/http://");
  const index = httpsIndex !== -1 ? httpsIndex : httpIndex;
  if (index === -1) return null;
  return value.slice(index + 1);
};

const normalizeSourceUrl = (raw: string | null) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Some CDNs / WP image URLs can exceed 2k chars (querystrings, signed URLs).
  // Keep a sane upper bound to avoid abuse, but be less strict to reduce 400s in admin grids.
  if (!trimmed || trimmed.length > 8192) return null;
  const cdnOverride = extractCdnCgiUrl(trimmed);
  if (cdnOverride && cdnOverride !== trimmed) {
    return normalizeSourceUrl(cdnOverride);
  }
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

const getOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const extensionFromContentType = (contentType?: string | null) => {
  if (!contentType) return null;
  if (contentType.includes("avif")) return ".avif";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  return null;
};

const extensionFromUrl = (url: string) => {
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

const getExtension = (url: string, contentType?: string | null) => {
  const typeExt = extensionFromContentType(contentType);
  if (typeExt) return typeExt;
  return extensionFromUrl(url);
};

const isBlobNotFound = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("does not exist");
};

const resolveExistingBlobByHead = async (pathname: string, token: string) => {
  try {
    const meta = await head(pathname, { token });
    return meta.url ?? null;
  } catch (error) {
    if (isBlobNotFound(error)) return null;
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.head.failed", pathname, message);
    return null;
  }
};

const resolveExistingBlobByListFallback = async (prefix: string, token: string) => {
  if (!ENABLE_LIST_FALLBACK) return null;
  try {
    const res = await list({ prefix, limit: 3, token });
    const match = res.blobs.find((blob) => blob.pathname.startsWith(prefix));
    return match?.url ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.list.fallback.failed", prefix, message);
    return null;
  }
};

const fetchWithTimeout = async (url: string, timeoutMs: number, headers?: Record<string, string>) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const cacheToBlob = async (sourceUrl: string, token: string): Promise<BlobCacheEntry> => {
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
    "user-agent": "ODA-ImageProxy/1.0",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  let res = await fetchWithTimeout(sourceUrl, DEFAULT_TIMEOUT_MS, defaultHeaders);
  if (!res.ok) {
    const origin = getOrigin(sourceUrl);
    if (origin) {
      res = await fetchWithTimeout(sourceUrl, DEFAULT_TIMEOUT_MS, {
        ...defaultHeaders,
        referer: origin,
      });
    }
  }
  if (!res.ok) {
    throw new Error(`fetch_failed:${res.status}`);
  }

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength && contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`too_large:${contentLength}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`too_large:${buffer.length}`);
  }

  const contentType = res.headers.get("content-type");
  const optimized = await optimizeBeforeBlob({
    buffer,
    sourceUrl,
    contentType,
    context: "image-proxy",
  });
  if (optimized.buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`too_large:${optimized.buffer.length}`);
  }

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

const maybePersistCover = async (productId: string | null, kind: string | null, blob: BlobCacheEntry) => {
  if (!productId || kind !== "cover") return;
  try {
    const data: Record<string, unknown> = { imageCoverUrl: blob.url };
    if (blob.optimization) {
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { metadata: true } });
      const existingMetadata =
        product?.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
          ? (product.metadata as Record<string, unknown>)
          : {};
      const summary = summarizeImageOptimization([blob.optimization]);
      const nextMetadata: Record<string, unknown> = {
        ...existingMetadata,
        image_optimization: {
          ...summary,
          context: "image_proxy_cover",
          updatedAt: new Date().toISOString(),
        },
      };
      if (ALLOW_EXTERNAL_MEDIA_WRITE) {
        nextMetadata.allow_external_media_write = true;
      }
      data.metadata = nextMetadata;
    }
    await prisma.product.update({
      where: { id: productId },
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.persist.failed", productId, message);
  }
};

const svgPlaceholder = (label = "ODA") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" role="img" aria-label="${label}"><rect width="640" height="640" fill="#efedeb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#7f7466" font-family="Arial, sans-serif" font-size="38" letter-spacing="6">${label}</text></svg>`;

const placeholderResponse = (label: string, reason: string) =>
  new NextResponse(svgPlaceholder(label), {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": CACHE_CONTROL,
      "x-oda-image-proxy": reason,
    },
  });

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const sourceUrl = normalizeSourceUrl(req.nextUrl.searchParams.get("url"));
  if (!sourceUrl) {
    return placeholderResponse(kind === "logo" ? "LOGO" : "ODA", "invalid-url");
  }

  const productId = req.nextUrl.searchParams.get("productId");

  if (!blobToken) {
    const fallback = NextResponse.redirect(sourceUrl, 307);
    fallback.headers.set("cache-control", CACHE_CONTROL);
    fallback.headers.set("x-oda-image-proxy", "no-token");
    return fallback;
  }

  let targetUrl = sourceUrl;
  let cacheStatus = "miss";
  try {
    const blobAsset = await cacheToBlob(sourceUrl, blobToken);
    targetUrl = blobAsset.url;
    cacheStatus = "blob";
    await maybePersistCover(productId, kind, blobAsset);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.cache.failed", sourceUrl, message);
    if (kind === "logo") {
      return placeholderResponse("LOGO", "logo-fallback");
    }
  }

  const response = NextResponse.redirect(targetUrl, 307);
  response.headers.set("cache-control", CACHE_CONTROL);
  response.headers.set("x-oda-image-proxy", cacheStatus);
  return response;
}
