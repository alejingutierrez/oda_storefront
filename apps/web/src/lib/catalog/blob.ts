import path from "node:path";
import { put } from "@vercel/blob";
import { hashBuffer } from "@/lib/catalog/utils";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

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

export const uploadImageToBlob = async (url: string, prefix: string) => {
  const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;
  const token = process.env.VERCEL_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Missing VERCEL_BLOB_READ_WRITE_TOKEN");
  }

  const res = await fetch(normalizedUrl);
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
  const key = `${prefix}/${hash}${ext}`;

  const blob = await put(key, buffer, {
    access: "public",
    contentType: contentType ?? undefined,
    token,
    addRandomSuffix: false,
  });

  return { url: blob.url, blobPath: blob.pathname ?? key, sourceUrl: normalizedUrl };
};

export const uploadImagesToBlob = async (urls: string[], prefix: string) => {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const mapping = new Map<string, { url: string; blobPath: string; sourceUrl: string }>();

  for (const url of unique) {
    if (mapping.has(url)) continue;
    try {
      const uploaded = await uploadImageToBlob(url, prefix);
      mapping.set(url, uploaded);
    } catch (error) {
      console.warn("blob.upload.failed", url, error instanceof Error ? error.message : error);
    }
  }

  return mapping;
};
