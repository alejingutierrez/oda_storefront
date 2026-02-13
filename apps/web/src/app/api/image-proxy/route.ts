import crypto from "node:crypto";
import { list, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;
const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || "";
const resolvedCache = new Map<string, string>();

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

const getExtension = (url: string, contentType?: string | null) => {
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

const fetchWithTimeout = async (url: string, timeoutMs: number, headers?: Record<string, string>) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const resolveExistingBlob = async (prefix: string, token: string) => {
  try {
    const res = await list({ prefix, limit: 3, token });
    const match = res.blobs.find((blob) => blob.pathname.startsWith(prefix));
    return match?.url ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.list.failed", prefix, message);
    return null;
  }
};

const cacheToBlob = async (sourceUrl: string, token: string) => {
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
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`too_large:${buffer.length}`);
  }

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

const maybePersistCover = async (productId: string | null, kind: string | null, blobUrl: string) => {
  if (!productId || kind !== "cover") return;
  try {
    await prisma.product.update({
      where: { id: productId },
      data: { imageCoverUrl: blobUrl },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.persist.failed", productId, message);
  }
};

export async function GET(req: NextRequest) {
  const sourceUrl = normalizeSourceUrl(req.nextUrl.searchParams.get("url"));
  if (!sourceUrl) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  const productId = req.nextUrl.searchParams.get("productId");
  const kind = req.nextUrl.searchParams.get("kind");

  if (!blobToken) {
    const fallback = NextResponse.redirect(sourceUrl, 307);
    fallback.headers.set("cache-control", CACHE_CONTROL);
    fallback.headers.set("x-oda-image-proxy", "no-token");
    return fallback;
  }

  let targetUrl = sourceUrl;
  let cacheStatus = "miss";
  try {
    const blobUrl = await cacheToBlob(sourceUrl, blobToken);
    targetUrl = blobUrl;
    cacheStatus = "blob";
    await maybePersistCover(productId, kind, blobUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("image-proxy.cache.failed", sourceUrl, message);
  }

  const response = NextResponse.redirect(targetUrl, 307);
  response.headers.set("cache-control", CACHE_CONTROL);
  response.headers.set("x-oda-image-proxy", cacheStatus);
  return response;
}
