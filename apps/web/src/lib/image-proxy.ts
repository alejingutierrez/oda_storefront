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

const sanitizeRawUrl = (value: string) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim();

const normalizeExternalUrl = (value: string) => {
  if (!value) return null;
  const sanitized = sanitizeRawUrl(value);
  if (!sanitized) return null;
  if (/^(data|javascript|vbscript):/i.test(sanitized)) return null;
  const withProtocol = isHttpUrl(sanitized) ? sanitized : `https://${sanitized.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(withProtocol);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export const proxiedImageUrl = (
  sourceUrl: string | null | undefined,
  options?: { productId?: string | null; kind?: "cover" | "gallery" | "logo" | null },
) => {
  if (!sourceUrl) return null;
  const trimmed = sanitizeRawUrl(sourceUrl);
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/image-proxy")) {
    return trimmed;
  }
  if (isRelativePath(trimmed)) {
    return trimmed;
  }
  if (trimmed.includes(BLOB_HOST_FRAGMENT)) {
    return trimmed;
  }

  const normalized = normalizeExternalUrl(trimmed);
  if (!normalized) return null;

  const kind = options?.kind ?? null;
  const shouldForceProxyForLogo = kind === "logo";
  const shouldForceProxyByLength = normalized.length > 1024;

  if (!shouldForceProxyForLogo && !shouldForceProxyByLength && canUseDirectImageUrl(normalized)) {
    return normalized;
  }

  const params = new URLSearchParams({ url: normalized });
  if (options?.productId) params.set("productId", options.productId);
  if (kind) params.set("kind", kind);
  return `/api/image-proxy?${params.toString()}`;
};
