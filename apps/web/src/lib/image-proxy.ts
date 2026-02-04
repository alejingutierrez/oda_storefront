const BLOB_HOST_FRAGMENT = "blob.vercel-storage.com";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

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
  if (trimmed.includes(BLOB_HOST_FRAGMENT)) {
    return trimmed;
  }

  const normalized = isHttpUrl(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  const params = new URLSearchParams({ url: normalized });
  if (options?.productId) params.set("productId", options.productId);
  if (options?.kind) params.set("kind", options.kind);
  return `/api/image-proxy?${params.toString()}`;
};

