const BLOB_HOST_FRAGMENT = "blob.vercel-storage.com";
const DIRECT_HOST_PATTERNS = [
  /(^|\.)cdn\.shopify\.com$/i,
  /(^|\.)myshopify\.com$/i,
  /(^|\.)blob\.vercel-storage\.com$/i,
];

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
const isRelativePath = (value: string) => value.startsWith("/") && !value.startsWith("//");

const canUseDirectImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    return DIRECT_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  } catch {
    return false;
  }
};

export const proxiedImageUrl = (
  sourceUrl: string | null | undefined,
  options?: { productId?: string | null; kind?: "cover" | "gallery" | null },
) => {
  if (!sourceUrl) return null;
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("/api/image-proxy")) {
    return trimmed;
  }
  if (isRelativePath(trimmed)) {
    return trimmed;
  }
  if (trimmed.includes(BLOB_HOST_FRAGMENT)) {
    return trimmed;
  }

  const normalized = isHttpUrl(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  if (canUseDirectImageUrl(normalized)) {
    return normalized;
  }
  const params = new URLSearchParams({ url: normalized });
  if (options?.productId) params.set("productId", options.productId);
  if (options?.kind) params.set("kind", options.kind);
  return `/api/image-proxy?${params.toString()}`;
};
