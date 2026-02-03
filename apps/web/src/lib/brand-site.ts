import { normalizeUrl } from "@/lib/catalog/utils";

type NormalizedSite = {
  normalized: string;
  host: string;
};

const stripWww = (value: string) => (value.startsWith("www.") ? value.slice(4) : value);

export const normalizeSiteUrl = (value: unknown): NormalizedSite | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = normalizeUrl(trimmed);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const host = stripWww(url.hostname.toLowerCase());
    if (!host) return null;
    const port = url.port ? `:${url.port}` : "";
    const path =
      url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/g, "") : "";
    return { normalized: `https://${host}${port}${path}`, host };
  } catch {
    return null;
  }
};
