import { z } from "zod";
import type { Brand } from "@prisma/client";
import { getOpenAIClient } from "@/lib/openai";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_HTML_CHARS = 200_000;
const MAX_HELPER_CHARS = 250_000;
const MAX_SITEMAP_URLS = 40;

export type TechPlatform = "shopify" | "woocommerce" | "magento" | "vtex" | "custom" | "unknown";

export type TechEvidence = {
  type: string;
  value: string;
  weight: number;
};

export type TechProbe = {
  request: string;
  status: number | null;
  matched?: string;
  note?: string;
};

export type TechProfile = {
  platform: TechPlatform;
  confidence: number;
  evidence: TechEvidence[];
  probes: TechProbe[];
  recommended_strategy: {
    mode: "platform_api" | "public_json" | "html" | "headless";
    notes: string;
  };
  risks: string[];
};

type FetchResult = {
  url: string;
  finalUrl: string;
  status: number | null;
  headers: Record<string, string>;
  cookies: string[];
  body: string;
  durationMs: number;
  error?: string;
};

type FeatureSet = {
  baseUrl: string;
  finalUrl: string;
  headers: Record<string, string>;
  cookieNames: string[];
  scripts: string[];
  scriptHosts: string[];
  metaGenerators: string[];
  linkPaths: string[];
  htmlLower: string;
  robotsText?: string;
  sitemapText?: string;
  manifestText?: string;
  sitemapUrls: string[];
  productHandles: string[];
  status: number | null;
};

const llmDecisionSchema = z.object({
  platform: z.enum(["shopify", "woocommerce", "magento", "vtex", "custom", "unknown"]),
  confidence: z.number().min(0).max(1),
  recommended_strategy: z.object({
    mode: z.enum(["platform_api", "public_json", "html", "headless"]),
    notes: z.string(),
  }),
  risks: z.array(z.string()).default([]),
});

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/\/+/, "")}`;
};

const safeHostname = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const extractOutputText = (response: any) => {
  if (typeof response?.output_text === "string") return response.output_text;
  const message = Array.isArray(response?.output)
    ? response.output.find((item: any) => item.type === "message")
    : null;
  const content = message?.content?.find((item: any) => item.type === "output_text" || item.type === "text");
  return content?.text ?? "";
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const splitCookies = (raw: string) =>
  raw
    .split(/,(?=[^;]+?=)/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

const collectCookieNames = (header: string | null, headerList: string[] = []) => {
  const rawCookies = header ? splitCookies(header) : headerList;
  return unique(
    rawCookies
      .map((cookie) => cookie.split(";")[0]?.trim())
      .filter(Boolean)
      .map((cookie) => cookie.split("=")[0] ?? "")
      .filter(Boolean)
      .map((name) => name.toLowerCase()),
  );
};

const fetchWithMeta = async (
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  bodyLimit = MAX_HTML_CHARS,
): Promise<FetchResult> => {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      ...options,
      headers: {
        "user-agent": "ODA-TechProfiler/1.0",
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const headerCookies = (() => {
      const headerValue = response.headers.get("set-cookie");
      const headerList = "getSetCookie" in response.headers
        ? (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];
      return collectCookieNames(headerValue, headerList);
    })();

    const text = await response.text();
    const truncated = text.slice(0, bodyLimit);
    clearTimeout(timeout);
    return {
      url,
      finalUrl: response.url ?? url,
      status: response.status,
      headers,
      cookies: headerCookies,
      body: truncated,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      url,
      finalUrl: url,
      status: null,
      headers: {},
      cookies: [],
      body: "",
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const extractScriptSrcs = (html: string) => {
  const regex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    results.push(match[1]);
  }
  return unique(results);
};

const extractMetaGenerators = (html: string) => {
  const tagRegex = /<meta[^>]+>/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html))) {
    const tag = match[0];
    if (!/name=["']generator["']/i.test(tag)) continue;
    const contentMatch = /content=["']([^"']+)["']/i.exec(tag);
    if (contentMatch?.[1]) results.push(contentMatch[1]);
  }
  return unique(results);
};

const extractLinkPaths = (html: string, baseUrl: string) => {
  const regex = /href=["']([^"']+)["']/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const href = match[1];
    if (!href || href.startsWith("#")) continue;
    try {
      const url = new URL(href, baseUrl);
      results.push(url.pathname);
    } catch {
      continue;
    }
  }
  return unique(results);
};

const extractProductHandles = (text: string) => {
  const regex = /\/products\/([^/?#"'<]+)[^"'<]*/gi;
  const handles: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const handle = match[1];
    if (handle) handles.push(handle);
  }
  return unique(handles).slice(0, 5);
};

const extractSitemapUrls = (xml: string) => {
  const regex = /<loc>([^<]+)<\/loc>/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    urls.push(match[1]);
    if (urls.length >= MAX_SITEMAP_URLS) break;
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
  return unique(urls);
};

const scoreSignals = (features: FeatureSet) => {
  const scores: Record<TechPlatform, number> = {
    shopify: 0,
    woocommerce: 0,
    magento: 0,
    vtex: 0,
    custom: 0,
    unknown: 0,
  };
  const evidence: Record<TechPlatform, TechEvidence[]> = {
    shopify: [],
    woocommerce: [],
    magento: [],
    vtex: [],
    custom: [],
    unknown: [],
  };

  const addEvidence = (platform: TechPlatform, type: string, value: string, weight: number) => {
    scores[platform] += weight;
    evidence[platform].push({ type, value, weight });
  };

  const scriptsLower = features.scriptHosts.map((host) => host.toLowerCase());
  const metaLower = features.metaGenerators.map((value) => value.toLowerCase());
  const cookiesLower = features.cookieNames.map((name) => name.toLowerCase());
  const headerEntries = Object.entries(features.headers).map(([key, value]) => [key, value.toLowerCase()] as const);

  if (scriptsLower.some((host) => host.includes("cdn.shopify.com") || host.includes("shopify"))) {
    addEvidence("shopify", "script_src", "shopify cdn", 0.9);
  }
  if (metaLower.some((value) => value.includes("shopify"))) {
    addEvidence("shopify", "meta_generator", "Shopify", 0.9);
  }
  if (cookiesLower.some((name) => name.includes("_shopify") || name.includes("cart_sig"))) {
    addEvidence("shopify", "cookie", "_shopify", 0.7);
  }
  if (features.htmlLower.includes("shopifyanalytics") || features.htmlLower.includes("window.shopify")) {
    addEvidence("shopify", "html_marker", "ShopifyAnalytics", 0.6);
  }
  if (features.linkPaths.some((path) => path.includes("/products/") || path.includes("/collections/"))) {
    addEvidence("shopify", "url_pattern", "/products/", 0.4);
  }
  if (headerEntries.some(([key, value]) => key.startsWith("x-shopify") || value.includes("shopify"))) {
    addEvidence("shopify", "header", "x-shopify", 0.6);
  }

  if (metaLower.some((value) => value.includes("woocommerce"))) {
    addEvidence("woocommerce", "meta_generator", "WooCommerce", 0.9);
  }
  if (scriptsLower.some((host) => host.includes("woocommerce"))) {
    addEvidence("woocommerce", "script_src", "woocommerce", 0.8);
  }
  if (features.htmlLower.includes("woocommerce")) {
    addEvidence("woocommerce", "html_marker", "woocommerce", 0.5);
  }
  if (cookiesLower.some((name) => name.includes("woocommerce") || name.includes("wp_woocommerce_session"))) {
    addEvidence("woocommerce", "cookie", "woocommerce", 0.7);
  }
  if (features.linkPaths.some((path) => path.includes("/wp-content/") || path.includes("/wp-json/"))) {
    addEvidence("woocommerce", "url_pattern", "wp-content/wp-json", 0.5);
  }
  if (headerEntries.some(([key, value]) => key === "x-powered-by" && value.includes("wordpress"))) {
    addEvidence("woocommerce", "header", "WordPress", 0.6);
  }

  if (metaLower.some((value) => value.includes("magento"))) {
    addEvidence("magento", "meta_generator", "Magento", 0.9);
  }
  if (features.htmlLower.includes("magento") || features.htmlLower.includes("mage-cache")) {
    addEvidence("magento", "html_marker", "mage-cache", 0.6);
  }
  if (scriptsLower.some((host) => host.includes("magento"))) {
    addEvidence("magento", "script_src", "magento", 0.7);
  }
  if (features.htmlLower.includes("static/version")) {
    addEvidence("magento", "asset_pattern", "static/version", 0.5);
  }
  if (cookiesLower.some((name) => name.includes("mage-cache") || name === "form_key")) {
    addEvidence("magento", "cookie", "mage-cache", 0.6);
  }

  if (scriptsLower.some((host) => host.includes("vtex"))) {
    addEvidence("vtex", "script_src", "vtex", 0.8);
  }
  if (features.htmlLower.includes("vtex")) {
    addEvidence("vtex", "html_marker", "vtex", 0.6);
  }
  if (headerEntries.some(([key]) => key.startsWith("x-vtex"))) {
    addEvidence("vtex", "header", "x-vtex", 0.7);
  }
  if (features.linkPaths.some((path) => path.includes("/api/catalog_system"))) {
    addEvidence("vtex", "url_pattern", "catalog_system", 0.5);
  }

  return { scores, evidence };
};

const rankPlatforms = (scores: Record<TechPlatform, number>) =>
  (Object.keys(scores) as TechPlatform[])
    .filter((platform) => platform !== "custom" && platform !== "unknown")
    .map((platform) => ({ platform, score: scores[platform] }))
    .sort((a, b) => b.score - a.score);

const determineConfidence = (topScore: number, secondScore: number) => {
  const base = Math.min(1, topScore / 2.2);
  const gap = topScore - secondScore;
  return Math.min(1, Math.max(0.1, base + Math.max(0, gap * 0.08)));
};

const shouldUseLlm = (topScore: number, secondScore: number) => {
  if (!process.env.OPENAI_API_KEY) return false;
  if (topScore < 0.9) return true;
  if (secondScore > 0 && topScore - secondScore < 0.3) return true;
  return false;
};

const probeShopify = async (origin: string, handles: string[]) => {
  const probes: TechProbe[] = [];
  for (const handle of handles) {
    const path = `/products/${handle}.js`;
    const url = new URL(path, origin).toString();
    const res = await fetchWithMeta(url, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);
    let matched = false;
    if (res.status === 200) {
      try {
        const parsed = JSON.parse(res.body);
        matched = !!parsed?.product;
      } catch {
        matched = res.body.includes("\"product\"");
      }
    }
    probes.push({
      request: `GET ${path}`,
      status: res.status,
      matched: matched ? "shopify_product_json" : undefined,
      note: res.error,
    });
    if (matched) return { matched: true, probes };
  }
  return { matched: false, probes };
};

const probeWooCommerce = async (origin: string) => {
  const path = "/wp-json/wc/store/v1/products?per_page=1";
  const url = new URL(path, origin).toString();
  const res = await fetchWithMeta(url, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);
  let matched = false;
  if (res.status === 200) {
    try {
      const parsed = JSON.parse(res.body);
      matched = Array.isArray(parsed) && parsed.length >= 0;
    } catch {
      matched = false;
    }
  }
  return {
    matched,
    probes: [{ request: `GET ${path}`, status: res.status, matched: matched ? "wc_store_api" : undefined, note: res.error }],
  };
};

const probeMagento = async (origin: string) => {
  const path = "/graphql";
  const url = new URL(path, origin).toString();
  const res = await fetchWithMeta(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{storeConfig{base_currency_code}}" }),
    },
    DEFAULT_TIMEOUT_MS,
    MAX_HELPER_CHARS,
  );
  let matched = false;
  if (res.status === 200) {
    try {
      const parsed = JSON.parse(res.body);
      matched = !!parsed?.data?.storeConfig;
    } catch {
      matched = false;
    }
  }
  return {
    matched,
    probes: [{ request: `POST ${path}`, status: res.status, matched: matched ? "magento_graphql" : undefined, note: res.error }],
  };
};

const probeVtex = async (origin: string) => {
  const path = "/api/catalog_system/pub/products/search?_from=0&_to=1";
  const url = new URL(path, origin).toString();
  const res = await fetchWithMeta(url, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);
  let matched = false;
  if (res.status === 200) {
    try {
      const parsed = JSON.parse(res.body);
      matched = Array.isArray(parsed);
    } catch {
      matched = false;
    }
  }
  return {
    matched,
    probes: [{ request: `GET ${path}`, status: res.status, matched: matched ? "vtex_catalog" : undefined, note: res.error }],
  };
};

const recommendedStrategyFor = (platform: TechPlatform, probeSuccess: boolean) => {
  if (["shopify", "woocommerce", "magento", "vtex"].includes(platform)) {
    return {
      mode: probeSuccess ? "platform_api" : "public_json",
      notes: probeSuccess
        ? "Existe endpoint publico para datos estructurados."
        : "No se confirmo endpoint; usar HTML o headless si es necesario.",
    } as const;
  }
  return {
    mode: "html",
    notes: "Usar HTML y fallback headless si el contenido es dinamico.",
  } as const;
};

const collectRisks = (features: FeatureSet) => {
  const risks: string[] = [];
  if (features.status && [403, 429].includes(features.status)) risks.push("bot_protection");
  if (!features.sitemapUrls.length) risks.push("no_sitemap");
  const serverHeader = features.headers["server"] ?? "";
  if (serverHeader.toLowerCase().includes("cloudflare")) risks.push("cloudflare");
  if (!features.scripts.length && !features.linkPaths.length) risks.push("minimal_signals");
  return unique(risks);
};

const maybeUseOpenAi = async (
  features: FeatureSet,
  probes: TechProbe[],
  current: TechProfile,
): Promise<TechProfile> => {
  const ranked = rankPlatforms(scoreSignals(features).scores);
  const topScore = ranked[0]?.score ?? 0;
  const secondScore = ranked[1]?.score ?? 0;
  if (!shouldUseLlm(topScore, secondScore)) return current;

  try {
    const client = getOpenAIClient() as any;
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "Eres un clasificador de tecnologia ecommerce. Decide la plataforma mas probable y devuelve SOLO JSON con {platform, confidence, recommended_strategy:{mode, notes}, risks}. Se conservador: usa unknown si la evidencia es debil.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              url: features.finalUrl,
              headers: features.headers,
              cookies: features.cookieNames,
              meta_generators: features.metaGenerators,
              script_hosts: features.scriptHosts.slice(0, 15),
              link_patterns: features.linkPaths.slice(0, 20),
              probes,
            },
            null,
            2,
          ),
        },
      ],
      text: { format: { type: "json_object" } },
    });

    const raw = extractOutputText(response);
    if (!raw) return current;
    const parsed = llmDecisionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return current;

    return {
      ...current,
      platform: parsed.data.platform,
      confidence: parsed.data.confidence,
      recommended_strategy: parsed.data.recommended_strategy,
      risks: unique([...(current.risks ?? []), ...(parsed.data.risks ?? [])]),
    };
  } catch {
    return current;
  }
};

const buildFeatureSet = async (brand: Brand): Promise<FeatureSet> => {
  if (!brand.siteUrl) {
    return {
      baseUrl: "",
      finalUrl: "",
      headers: {},
      cookieNames: [],
      scripts: [],
      scriptHosts: [],
      metaGenerators: [],
      linkPaths: [],
      htmlLower: "",
      sitemapUrls: [],
      productHandles: [],
      status: null,
    };
  }

  const normalized = normalizeUrl(brand.siteUrl);
  if (!normalized) {
    return {
      baseUrl: "",
      finalUrl: "",
      headers: {},
      cookieNames: [],
      scripts: [],
      scriptHosts: [],
      metaGenerators: [],
      linkPaths: [],
      htmlLower: "",
      sitemapUrls: [],
      productHandles: [],
      status: null,
    };
  }

  const baseFetch = await fetchWithMeta(normalized, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HTML_CHARS);
  const finalUrl = baseFetch.finalUrl || normalized;
  const origin = (() => {
    try {
      return new URL(finalUrl).origin;
    } catch {
      return normalized;
    }
  })();

  const manifestLinkMatch = /<link[^>]+rel=["']manifest["'][^>]*>/i.exec(baseFetch.body);
  let manifestHref: string | null = null;
  if (manifestLinkMatch) {
    const hrefMatch = /href=["']([^"']+)["']/i.exec(manifestLinkMatch[0]);
    if (hrefMatch?.[1]) {
      try {
        manifestHref = new URL(hrefMatch[1], origin).toString();
      } catch {
        manifestHref = null;
      }
    }
  }

  const robotsFetch = await fetchWithMeta(new URL("/robots.txt", origin).toString(), { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);

  const sitemapUrls = unique([
    ...extractSitemapsFromRobots(robotsFetch.body || ""),
    new URL("/sitemap.xml", origin).toString(),
  ]).slice(0, 3);

  let sitemapText = "";
  for (const sitemapUrl of sitemapUrls) {
    const sitemapFetch = await fetchWithMeta(sitemapUrl, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);
    if (!sitemapFetch.body) continue;
    sitemapText = sitemapFetch.body;
    break;
  }

  if (sitemapText.includes("<sitemapindex")) {
    const childSitemaps = extractSitemapUrls(sitemapText).slice(0, 2);
    for (const childUrl of childSitemaps) {
      const childFetch = await fetchWithMeta(childUrl, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);
      if (!childFetch.body) continue;
      sitemapText = childFetch.body;
      break;
    }
  }

  const manifestUrl = manifestHref ?? new URL("/manifest.json", origin).toString();
  const manifestFetch = await fetchWithMeta(manifestUrl, { method: "GET" }, DEFAULT_TIMEOUT_MS, MAX_HELPER_CHARS);

  const scripts = extractScriptSrcs(baseFetch.body);
  const scriptHosts = unique(
    scripts.map((src) => {
      try {
        return new URL(src, origin).hostname;
      } catch {
        if (src.startsWith("//")) return safeHostname(`https:${src}`);
        return safeHostname(src);
      }
    }),
  );

  const metaGenerators = extractMetaGenerators(baseFetch.body);
  const linkPaths = extractLinkPaths(baseFetch.body, origin);
  const combinedText = `${baseFetch.body}\n${sitemapText}`;
  const productHandles = extractProductHandles(combinedText);

  return {
    baseUrl: normalized,
    finalUrl,
    headers: baseFetch.headers,
    cookieNames: baseFetch.cookies,
    scripts,
    scriptHosts,
    metaGenerators,
    linkPaths,
    htmlLower: baseFetch.body.toLowerCase(),
    robotsText: robotsFetch.body,
    sitemapText,
    manifestText: manifestFetch.body,
    sitemapUrls,
    productHandles,
    status: baseFetch.status,
  };
};

export async function profileBrandTechnology(brand: Brand): Promise<TechProfile> {
  const features = await buildFeatureSet(brand);

  if (!features.finalUrl) {
    return {
      platform: "unknown",
      confidence: 0,
      evidence: [],
      probes: [],
      recommended_strategy: { mode: "html", notes: "No hay sitio configurado para la marca." },
      risks: ["missing_site_url"],
    };
  }

  const { scores, evidence } = scoreSignals(features);
  const ranked = rankPlatforms(scores);

  const top = ranked[0] ?? { platform: "unknown" as TechPlatform, score: 0 };
  const second = ranked[1] ?? { platform: "unknown" as TechPlatform, score: 0 };

  const probes: TechProbe[] = [];
  let probeMatched = false;

  const candidates = ranked.slice(0, 3).map((entry) => entry.platform);
  for (const candidate of candidates) {
    if (candidate === "shopify") {
      const result = await probeShopify(features.finalUrl, features.productHandles);
      probes.push(...result.probes);
      if (result.matched) {
        scores.shopify += 1.2;
        evidence.shopify.push({ type: "probe", value: "product.js", weight: 1.2 });
        probeMatched = true;
      }
    }
    if (candidate === "woocommerce") {
      const result = await probeWooCommerce(features.finalUrl);
      probes.push(...result.probes);
      if (result.matched) {
        scores.woocommerce += 1.2;
        evidence.woocommerce.push({ type: "probe", value: "wc store api", weight: 1.2 });
        probeMatched = true;
      }
    }
    if (candidate === "magento") {
      const result = await probeMagento(features.finalUrl);
      probes.push(...result.probes);
      if (result.matched) {
        scores.magento += 1.2;
        evidence.magento.push({ type: "probe", value: "graphql", weight: 1.2 });
        probeMatched = true;
      }
    }
    if (candidate === "vtex") {
      const result = await probeVtex(features.finalUrl);
      probes.push(...result.probes);
      if (result.matched) {
        scores.vtex += 1.2;
        evidence.vtex.push({ type: "probe", value: "catalog api", weight: 1.2 });
        probeMatched = true;
      }
    }
  }

  const reranked = rankPlatforms(scores);
  const finalTop = reranked[0] ?? top;
  const finalSecond = reranked[1] ?? second;
  const confidence = determineConfidence(finalTop.score, finalSecond.score);

  const platform: TechPlatform = finalTop.score >= 0.6 ? finalTop.platform : "unknown";
  const baseProfile: TechProfile = {
    platform,
    confidence,
    evidence: evidence[platform] ?? [],
    probes,
    recommended_strategy: recommendedStrategyFor(platform, probeMatched),
    risks: collectRisks(features),
  };

  const profile = await maybeUseOpenAi(features, probes, baseProfile);

  return profile;
}
