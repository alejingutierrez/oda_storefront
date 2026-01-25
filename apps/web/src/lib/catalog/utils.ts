import crypto from "node:crypto";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

export const DEFAULT_TIMEOUT_MS = 15000;
const gunzipAsync = promisify(gunzip);

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

export const extractSitemapUrls = (xml: string, limit?: number) => {
  const regex = /<loc>([^<]+)<\/loc>/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    urls.push(match[1]);
    if (limit !== undefined && urls.length >= limit) break;
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

export const discoverFromSitemap = async (
  baseUrl: string,
  limit = 200,
  options?: { productAware?: boolean; budgetMs?: number; maxFiles?: number },
) => {
  const origin = safeOrigin(baseUrl);
  const startedAt = Date.now();
  const normalizedLimit = Number.isFinite(limit) ? limit : 0;
  const hasLimit = normalizedLimit > 0;
  const effectiveLimit = hasLimit ? normalizedLimit : Number.MAX_SAFE_INTEGER;
  const budgetMs = Math.max(
    2000,
    Number(options?.budgetMs ?? process.env.CATALOG_EXTRACT_SITEMAP_BUDGET_MS ?? 12000),
  );
  const rawScanLimit = Number(process.env.CATALOG_EXTRACT_SITEMAP_SCAN_MAX_URLS ?? 5000);
  const scanLimit = Number.isFinite(rawScanLimit) ? rawScanLimit : 5000;
  const sitemapScanLimit = Math.max(hasLimit ? normalizedLimit * 5 : 0, scanLimit > 0 ? scanLimit : 0);
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const robots = await fetchText(robotsUrl);
  const sitemaps = extractSitemapsFromRobots(robots.text || "");
  const fallbackCandidates = [
    new URL("/sitemap.xml", origin).toString(),
    new URL("/sitemap_index.xml", origin).toString(),
    new URL("/sitemap.xml.gz", origin).toString(),
    new URL("/sitemap_index.xml.gz", origin).toString(),
    new URL("/wp-sitemap.xml", origin).toString(),
    new URL("/sitemap_products_1.xml", origin).toString(),
    new URL("/sitemap_products_1.xml.gz", origin).toString(),
    new URL("/sitemap_products.xml", origin).toString(),
    new URL("/sitemap_products.xml.gz", origin).toString(),
    new URL("/sitemap-product.xml", origin).toString(),
    new URL("/sitemap-product.xml.gz", origin).toString(),
    new URL("/sitemap-products.xml", origin).toString(),
    new URL("/sitemap-products.xml.gz", origin).toString(),
    new URL("/sitemap_product.xml", origin).toString(),
    new URL("/sitemap_product.xml.gz", origin).toString(),
    new URL("/sitemap/product.xml", origin).toString(),
    new URL("/sitemap/products.xml", origin).toString(),
    new URL("/product-sitemap.xml", origin).toString(),
    new URL("/products-sitemap.xml", origin).toString(),
    new URL("/store-products-sitemap.xml", origin).toString(),
  ];
  const uniqueRobots = Array.from(new Set(sitemaps));
  const uniqueFallback = Array.from(new Set(fallbackCandidates));
  const scoreSitemap = (url: string) => {
    const lower = url.toLowerCase();
    let score = 0;
    if (lower.includes("product")) score += 5;
    if (lower.includes("productos")) score += 4;
    if (lower.includes("wp-sitemap")) score += 2;
    if (lower.includes("store-products")) score += 4;
    if (lower.includes("sitemap")) score += 1;
    if (lower.endsWith(".xml") || lower.endsWith(".xml.gz")) score += 1;
    return score;
  };

  const orderedRobots = uniqueRobots.sort((a, b) => scoreSitemap(b) - scoreSitemap(a));
  const orderedFallback = uniqueFallback.sort((a, b) => scoreSitemap(b) - scoreSitemap(a));
  const queue = uniqueRobots.length
    ? [...orderedRobots, ...orderedFallback.filter((url) => !orderedRobots.includes(url))]
    : orderedFallback;
  const visited = new Set<string>();
  const urls = new Set<string>();
  const productUrls = new Set<string>();
  const maxSitemaps = Math.max(
    5,
    Math.min(Number(options?.maxFiles ?? process.env.CATALOG_EXTRACT_SITEMAP_MAX_FILES ?? 200), 1000),
  );

  const isProductSitemap = (url: string) => {
    const lower = url.toLowerCase();
    return (
      lower.includes("product") ||
      lower.includes("products") ||
      lower.includes("producto") ||
      lower.includes("productos") ||
      lower.includes("store-products")
    );
  };

  const fetchSitemapText = async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "ODA-CatalogExtractor/1.0",
          accept: "application/xml,application/x-gzip,text/xml,text/plain;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const contentEncoding = response.headers.get("content-encoding")?.toLowerCase() ?? "";
      const shouldGunzip =
        contentEncoding.includes("gzip") ||
        contentType.includes("gzip") ||
        contentType.includes("x-gzip") ||
        url.toLowerCase().endsWith(".gz");
      const text = shouldGunzip
        ? await gunzipAsync(buffer).then((out) => out.toString("utf-8")).catch(() => buffer.toString("utf-8"))
        : buffer.toString("utf-8");
      return { status: response.status, text, finalUrl: response.url || url };
    } catch {
      return { status: 0, text: "", finalUrl: url };
    } finally {
      clearTimeout(timeout);
    }
  };

  const shouldContinue = () =>
    queue.length &&
    visited.size < maxSitemaps &&
    (options?.productAware ? productUrls.size < effectiveLimit : urls.size < effectiveLimit) &&
    Date.now() - startedAt < budgetMs;

  while (shouldContinue()) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    const res = await fetchSitemapText(sitemapUrl);
    if (!res.text) continue;

    const sitemapText = res.text;
    if (/<sitemapindex/i.test(sitemapText)) {
      const children = extractSitemapUrls(sitemapText);
      const orderedChildren = Array.from(new Set(children)).sort(
        (a, b) => scoreSitemap(b) - scoreSitemap(a),
      );
      orderedChildren.forEach((child) => {
        if (!visited.has(child) && visited.size + queue.length < maxSitemaps) {
          queue.push(child);
        }
      });
      continue;
    }

    const remaining = hasLimit
      ? Math.max(0, effectiveLimit - (options?.productAware ? productUrls.size : urls.size))
      : 0;
    const scanLimitForSitemap = options?.productAware
      ? sitemapScanLimit > 0
        ? sitemapScanLimit
        : undefined
      : hasLimit
        ? remaining || undefined
        : undefined;
    const entries = extractSitemapUrls(sitemapText, scanLimitForSitemap);
    const isProductMap = options?.productAware && isProductSitemap(sitemapUrl);
    const allowAllFromSitemap = Boolean(isProductMap);
    for (const entry of entries) {
      if (urls.size < effectiveLimit) urls.add(entry);
      if (options?.productAware) {
        if (allowAllFromSitemap || isLikelyProductUrl(entry)) {
          productUrls.add(entry);
          if (productUrls.size >= effectiveLimit) break;
        }
        continue;
      }
      if (urls.size >= effectiveLimit) break;
    }
  }

  if (options?.productAware && productUrls.size) {
    return Array.from(productUrls).slice(0, effectiveLimit);
  }
  return Array.from(urls).slice(0, effectiveLimit);
};

export const isLikelyProductUrl = (url: string) => {
  try {
    const { pathname } = new URL(url);
    const lower = pathname.toLowerCase();
    if (
      /\/(blog|journal|news|press|about|nosotros|quienes-somos|contacto|contact|faq|ayuda)\b/.test(lower) ||
      /\/(category|categories|categoria|categorias|collection|collections|tag|tags)\b/.test(lower) ||
      /\/(search|busqueda|cart|checkout|account|login|register|policies|privacy|terms|legal)\b/.test(lower) ||
      /\/(portfolio|portafolio)\b/.test(lower)
    ) {
      return false;
    }
    if (/\/products?\/[^/]+/i.test(pathname)) return true;
    if (/\/producto(s)?\/[^/]+/i.test(pathname)) return true;
    if (/\/product-page\/[^/]+/i.test(pathname)) return true;
    if (/\/product-[^/]+/i.test(pathname)) return true;
    if (/\/tienda\/[^/]+/i.test(pathname)) return true;
    if (/\/shop\/[^/]+/i.test(pathname)) return true;
    if (/\/catalog\/product\/view/i.test(pathname)) return true;
    if (/\/p\/?$/i.test(pathname)) return true;
    return false;
  } catch {
    return false;
  }
};

export const hashBuffer = (buffer: Buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

export const pickOption = (options: Record<string, string> | undefined, keys: string[]) => {
  if (!options) return null;
  const normalizeKey = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  for (const key of keys) {
    for (const [optionKey, value] of Object.entries(options)) {
      if (normalizeKey(optionKey).includes(normalizeKey(key))) return value;
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

export const normalizeImageUrls = (input: unknown) => {
  const urls: string[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) urls.push(trimmed);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      push(record.url);
      push(record.contentUrl);
      push(record.src);
      push(record.image);
      push(record.image_url);
      if (record.thumbnail && typeof record.thumbnail === "object") {
        const thumb = record.thumbnail as Record<string, unknown>;
        push(thumb.contentUrl);
        push(thumb.url);
      }
    }
  };
  push(input);
  return Array.from(new Set(urls.filter(Boolean)));
};

export const guessCurrency = (value: number | null, fallback?: string | null) => {
  if (fallback && fallback.trim()) return fallback.trim();
  if (value === null || value === undefined) return null;
  if (value <= 999) return "USD";
  if (value >= 10000) return "COP";
  return "COP";
};
