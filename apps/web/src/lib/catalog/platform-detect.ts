import { fetchText, normalizeUrl } from "@/lib/catalog/utils";

type PlatformGuess = {
  platform: string;
  confidence: number;
  evidence: string[];
};

const extractScriptHosts = (html: string, baseUrl: string) => {
  const regex = /<script[^>]+src=(["'])(.*?)\1/gi;
  const hosts = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const src = match[2]?.trim();
    if (!src) continue;
    try {
      const url = src.startsWith("http") ? new URL(src) : new URL(src, baseUrl);
      if (url.hostname) hosts.add(url.hostname.toLowerCase());
    } catch {
      continue;
    }
  }
  return Array.from(hosts);
};

const extractMetaGenerator = (html: string) => {
  const match = html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  return match?.[1]?.toLowerCase() ?? null;
};

const scoreSignals = (html: string, hosts: string[], headers: Headers, generator: string | null) => {
  const lower = html.toLowerCase();
  const scores: Record<string, number> = {
    shopify: 0,
    woocommerce: 0,
    magento: 0,
    vtex: 0,
    tiendanube: 0,
    wix: 0,
    custom: 0,
    unknown: 0,
  };
  const evidence: Record<string, string[]> = {
    shopify: [],
    woocommerce: [],
    magento: [],
    vtex: [],
    tiendanube: [],
    wix: [],
    custom: [],
    unknown: [],
  };

  const add = (platform: string, value: string, weight: number) => {
    scores[platform] = (scores[platform] ?? 0) + weight;
    evidence[platform] = [...(evidence[platform] ?? []), value];
  };

  if (hosts.some((host) => host.includes("cdn.shopify.com") || host.includes("shopify"))) {
    add("shopify", "script_host:shopify", 0.9);
  }
  if (lower.includes("shopify") || lower.includes("myshopify")) {
    add("shopify", "html_marker:shopify", 0.5);
  }
  const shopId = headers.get("x-shopid") ?? headers.get("x-shopify-shop-id");
  if (shopId) add("shopify", "header:shopify", 0.8);

  if (lower.includes("woocommerce") || lower.includes("wp-content") || lower.includes("wp-json")) {
    add("woocommerce", "html_marker:woocommerce", 0.6);
  }
  if (generator?.includes("woocommerce") || generator?.includes("wordpress")) {
    add("woocommerce", "meta_generator:wp", 0.5);
  }

  if (hosts.some((host) => host.includes("vtex") || host.includes("vtexassets"))) {
    add("vtex", "script_host:vtex", 0.9);
  }
  if (lower.includes("vtex")) add("vtex", "html_marker:vtex", 0.6);

  if (hosts.some((host) => host.includes("wix") || host.includes("wixsite"))) {
    add("wix", "script_host:wix", 0.9);
  }
  if (generator?.includes("wix")) add("wix", "meta_generator:wix", 0.8);
  if (lower.includes("wix.com") || lower.includes("wixsite")) add("wix", "html_marker:wix", 0.6);

  if (hosts.some((host) => host.includes("tiendanube") || host.includes("nuvemshop"))) {
    add("tiendanube", "script_host:tiendanube", 0.9);
  }
  if (lower.includes("tiendanube") || lower.includes("nuvemshop")) {
    add("tiendanube", "html_marker:tiendanube", 0.6);
  }

  if (lower.includes("magento") || lower.includes("mage/cookies") || lower.includes("mage/")) {
    add("magento", "html_marker:magento", 0.6);
  }
  if (generator?.includes("magento")) add("magento", "meta_generator:magento", 0.7);

  const ranked = Object.entries(scores)
    .filter(([platform]) => platform !== "custom" && platform !== "unknown")
    .sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top[1] <= 0.7) {
    return { platform: "unknown", confidence: 0.2, evidence: [] };
  }

  const gap = top[1] - (second?.[1] ?? 0);
  const confidence = Math.min(0.98, Math.max(0.4, 0.55 + gap * 0.25 + top[1] * 0.12));
  return { platform: top[0], confidence, evidence: evidence[top[0]] ?? [] };
};

export const inferCatalogPlatform = async (siteUrl: string): Promise<PlatformGuess | null> => {
  const normalized = normalizeUrl(siteUrl);
  if (!normalized) return null;
  const response = await fetchText(normalized, { method: "GET" }, 12000);
  if (response.status >= 400 || !response.text) return null;
  const generator = extractMetaGenerator(response.text);
  const hosts = extractScriptHosts(response.text, response.finalUrl ?? normalized);
  const guess = scoreSignals(response.text, hosts, response.headers, generator);
  if (!guess || guess.platform === "unknown") return null;
  return guess;
};

