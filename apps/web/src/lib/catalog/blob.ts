import path from "node:path";
import { put } from "@vercel/blob";
import { hashBuffer } from "@/lib/catalog/utils";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_CONCURRENCY = 4;
let blobUploadsDisabled = false;
let blobDisableReason: string | null = null;

const getExtension = (url: string, contentType?: string | null) => {
  if (contentType) {
    if (contentType.includes("png")) return ".png";
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("gif")) return ".gif";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  }
  const ext = path.extname(new URL(url).pathname);
  return ext && ext.length <= 5 ? ext : ".jpg";
};

const resolveBlobToken = () =>
  process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || "";

const sanitizeBlobPath = (value: string) =>
  value
    .replace(/[#?]/g, "_")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const isAccessDenied = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("access denied") || message.includes("401");
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
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${buffer.length} bytes)`);
  }

  const contentType = res.headers.get("content-type");
  const hash = hashBuffer(buffer).slice(0, 16);
  const ext = getExtension(normalizedUrl, contentType);
  const key = sanitizeBlobPath(`${prefix}/${hash}${ext}`);

  const blob = await put(key, buffer, {
    access: "public",
    contentType: contentType ?? undefined,
    token,
    addRandomSuffix: false,
  });

  return { url: blob.url, blobPath: blob.pathname ?? key, sourceUrl: normalizedUrl };
};

export const uploadImagesToBlob = async (urls: string[], prefix: string) => {
  const unique = Array.from(
    new Set(
      urls
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const mapping = new Map<string, { url: string; blobPath: string; sourceUrl: string }>();
  const token = resolveBlobToken();
  if (!token) {
    blobUploadsDisabled = true;
    blobDisableReason = "Missing BLOB_READ_WRITE_TOKEN";
  }
  if (blobUploadsDisabled) {
    throw new Error(blobDisableReason ?? "Blob uploads disabled");
  }

  const concurrency = Math.max(1, Number(process.env.BLOB_UPLOAD_CONCURRENCY ?? DEFAULT_CONCURRENCY));
  const timeoutMs = Math.max(3000, Number(process.env.BLOB_UPLOAD_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
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
