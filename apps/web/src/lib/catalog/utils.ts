import crypto from "node:crypto";

export const DEFAULT_TIMEOUT_MS = 15000;

export const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
};

export const safeOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
};

export const fetchText = async (
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      ...options,
      headers: {
        "user-agent": "ODA-CatalogExtractor/1.0",
        accept: "text/html,application/xml,application/json;q=0.9,*/*;q=0.8",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, text, finalUrl: response.url || url, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
};

export const extractSitemapUrls = (xml: string, limit = 200) => {
  const regex = /<loc>([^<]+)<\/loc>/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    urls.push(match[1]);
    if (urls.length >= limit) break;
  }
  return urls;
};

const extractSitemapsFromRobots = (robotsText: string) => {
  if (!robotsText) return [];
  const lines = robotsText.split(/\r?\n/);
  const urls = lines
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.split(/:/i).slice(1).join(":").trim())
    .filter(Boolean);
  return Array.from(new Set(urls));
};

export const discoverFromSitemap = async (baseUrl: string, limit = 200) => {
  const origin = safeOrigin(baseUrl);
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const robots = await fetchText(robotsUrl);
  const sitemaps = extractSitemapsFromRobots(robots.text || "");
  const fallback = new URL("/sitemap.xml", origin).toString();
  const sitemapCandidates = Array.from(new Set([...sitemaps, fallback])).slice(0, 3);

  let sitemapText = "";
  for (const url of sitemapCandidates) {
    const res = await fetchText(url);
    if (!res.text) continue;
    sitemapText = res.text;
    if (sitemapText.includes("<sitemapindex")) {
      const children = extractSitemapUrls(sitemapText, 5);
      for (const child of children) {
        const childRes = await fetchText(child);
        if (!childRes.text) continue;
        sitemapText = childRes.text;
        break;
      }
    }
    break;
  }

  if (!sitemapText) return [];
  return extractSitemapUrls(sitemapText, limit);
};

export const hashBuffer = (buffer: Buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

export const pickOption = (options: Record<string, string> | undefined, keys: string[]) => {
  if (!options) return null;
  for (const key of keys) {
    for (const [optionKey, value] of Object.entries(options)) {
      if (optionKey.toLowerCase().includes(key)) return value;
    }
  }
  return null;
};

export const normalizeSize = (value: string | null) => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["u", "unica", "única", "one size", "talla unica", "talla única"].includes(normalized)) {
    return "talla unica";
  }
  return value;
};

export const parsePriceValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).trim();
  if (!raw) return null;
  raw = raw.replace(/[^0-9,\.]/g, "");
  if (!raw) return null;
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");

  if (hasDot && hasComma) {
    // Assume dot thousands, comma decimal
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && !hasComma) {
    const parts = raw.split(".");
    if (parts.length === 2 && parts[1].length === 3) {
      raw = parts.join("");
    }
  } else if (!hasDot && hasComma) {
    const parts = raw.split(",");
    if (parts.length === 2 && parts[1].length === 3) {
      raw = parts.join("");
    } else {
      raw = raw.replace(",", ".");
    }
  }

  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

export const guessCurrency = (value: number | null, fallback?: string | null) => {
  if (fallback && fallback.trim()) return fallback.trim();
  if (value === null || value === undefined) return null;
  if (value <= 999) return "USD";
  if (value >= 10000) return "COP";
  return "COP";
};
