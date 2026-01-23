import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL* env");
}

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });

const SOCIAL_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "tiktok.com",
  "www.tiktok.com",
  "linktr.ee",
  "www.linktr.ee",
  "wa.me",
  "api.whatsapp.com",
]);

const normalizeUrl = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/g, "")}`;
};

const safeHost = (value) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const getMetadata = (row) =>
  row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};

const classifyBrand = (row) => {
  const reasons = [];
  const siteUrl = row.siteUrl ? normalizeUrl(row.siteUrl) : null;
  if (!siteUrl) {
    reasons.push("missing_site_url");
    return { siteUrl, reasons };
  }
  const host = safeHost(siteUrl);

  if (SOCIAL_HOSTS.has(host) || host.endsWith(".instagram.com")) {
    reasons.push("social");
  }
  if (host.endsWith("canva.site")) {
    reasons.push("landing_no_store");
  }

  const metadata = getMetadata(row);
  const tech = metadata.tech_profile || null;
  const risks = Array.isArray(tech?.risks) ? tech.risks : [];
  if (risks.includes("bot_protection")) reasons.push("bot_protection");
  if (risks.includes("unreachable")) reasons.push("unreachable");
  if (risks.includes("parked_domain")) reasons.push("domain_down");

  const review = metadata.catalog_extract_review || null;
  if (review?.reason === "manual_review_no_products" || review?.reason === "manual_review_vtex_no_products") {
    reasons.push("no_store");
  }
  const extract = metadata.catalog_extract || null;
  if (extract?.blockReason === "manual_review_no_products") reasons.push("no_store");

  return { siteUrl, reasons: Array.from(new Set(reasons)) };
};

const fetchText = async (url, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "ODA-UnknownReview/1.0",
        accept: "text/html,application/xml,application/json;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, text, finalUrl: res.url || url, headers: res.headers };
  } catch (error) {
    return { status: 0, text: "", finalUrl: url, headers: new Headers(), error: error?.name || String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

const extractSitemapsFromRobots = (text) => {
  if (!text) return [];
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!/^sitemap:/i.test(t)) continue;
    const value = t.split(/:/i).slice(1).join(":").trim();
    if (value) urls.push(value);
  }
  return Array.from(new Set(urls));
};

const extractSitemapUrls = (xml, limit = 2000) => {
  const regex = /<loc>([^<]+)<\/loc>/gi;
  const urls = [];
  let match;
  while ((match = regex.exec(xml))) {
    urls.push(match[1]);
    if (urls.length >= limit) break;
  }
  return urls;
};

const isLikelyProductUrl = (url) => {
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

const extractLinksFromHtml = (html, origin) => {
  const regex = /<a[^>]+href=("|')(.*?)\1/gi;
  const links = new Set();
  let match;
  while ((match = regex.exec(html))) {
    const href = match[2]?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const url = href.startsWith("http") ? new URL(href) : new URL(href, origin);
      if (url.origin !== origin) continue;
      links.add(url.toString());
    } catch {
      continue;
    }
  }
  return Array.from(links);
};

const discoverProductUrls = async (siteUrl, limit = 200) => {
  const origin = new URL(siteUrl).origin;
  const robots = await fetchText(`${origin}/robots.txt`);
  const sitemaps = extractSitemapsFromRobots(robots.text || "");
  const fallback = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap.xml.gz",
    "/sitemap_index.xml.gz",
    "/wp-sitemap.xml",
    "/sitemap_products_1.xml",
    "/sitemap_products_1.xml.gz",
    "/sitemap_products.xml",
    "/sitemap_products.xml.gz",
    "/sitemap-product.xml",
    "/sitemap-product.xml.gz",
    "/sitemap-products.xml",
    "/sitemap-products.xml.gz",
    "/sitemap_product.xml",
    "/sitemap_product.xml.gz",
    "/sitemap/product.xml",
    "/sitemap/products.xml",
    "/product-sitemap.xml",
    "/products-sitemap.xml",
    "/store-products-sitemap.xml",
  ].map((p) => `${origin}${p}`);

  const candidates = Array.from(new Set([...sitemaps, ...fallback]));
  const urls = new Set();

  for (const sitemapUrl of candidates.slice(0, 10)) {
    const res = await fetchText(sitemapUrl, 12000);
    if (!res.text || res.status < 200 || res.status >= 400) continue;
    const entries = extractSitemapUrls(res.text, 2000);
    entries.forEach((entry) => urls.add(entry));
    const productCount = entries.filter(isLikelyProductUrl).length;
    if (productCount > 0) break;
  }

  const productUrls = Array.from(urls).filter(isLikelyProductUrl);
  if (productUrls.length) return productUrls.slice(0, limit);

  const probePaths = ["/", "/tienda", "/shop", "/productos", "/producto", "/store", "/catalogo", "/catalog", "/products"];
  const candidatesFromPages = new Set();
  for (const path of probePaths) {
    if (candidatesFromPages.size >= limit) break;
    const pageUrl = new URL(path, origin).toString();
    const page = await fetchText(pageUrl, 12000);
    if (!page.text || page.status >= 400) continue;
    const links = extractLinksFromHtml(page.text, origin);
    links.filter(isLikelyProductUrl).forEach((url) => candidatesFromPages.add(url));
  }
  return Array.from(candidatesFromPages).slice(0, limit);
};

const extractJsonLd = (html) => {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks = [];
  let match;
  while ((match = regex.exec(html))) {
    const raw = match[1];
    try {
      const parsed = JSON.parse(raw.trim());
      blocks.push(parsed);
    } catch {
      continue;
    }
  }
  return blocks;
};

const isProductType = (value) => {
  if (!value) return false;
  if (Array.isArray(value)) return value.some((entry) => String(entry).toLowerCase().includes("product"));
  return String(value).toLowerCase().includes("product");
};

const findProductJsonLd = (blocks) => {
  for (const block of blocks) {
    if (!block) continue;
    if (Array.isArray(block)) {
      const found = block.find((item) => isProductType(item?.["@type"]));
      if (found) return found;
    }
    if (isProductType(block["@type"])) return block;
    if (Array.isArray(block["@graph"])) {
      const found = block["@graph"].find((item) => isProductType(item?.["@type"]));
      if (found) return found;
    }
  }
  return null;
};

const decodeHtml = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const parseTagAttributes = (tag) => {
  const attrs = {};
  const regex = /([a-zA-Z:-]+)=("|')(.*?)\2/g;
  let match;
  while ((match = regex.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[3];
  }
  return attrs;
};

const extractMetaTags = (html) => {
  const regex = /<meta\s+[^>]*>/gi;
  const map = {};
  let match;
  while ((match = regex.exec(html))) {
    const tag = match[0];
    const attrs = parseTagAttributes(tag);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    const content = attrs.content;
    if (key && content) map[key] = decodeHtml(content);
  }
  return map;
};

const extractH1 = (html) => {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decodeHtml(text);
};

const countProductLinks = (html, origin, threshold = 3) => {
  const regex = /<a[^>]+href=("|')(.*?)\1/gi;
  let match;
  let count = 0;
  while ((match = regex.exec(html))) {
    const href = match[2]?.trim();
    if (!href || href.startsWith("#")) continue;
    try {
      const url = href.startsWith("http") ? new URL(href) : new URL(href, origin);
      if (url.origin !== origin) continue;
      if (isLikelyProductUrl(url.toString())) {
        count += 1;
        if (count >= threshold) return count;
      }
    } catch {
      continue;
    }
  }
  return count;
};

const parseProductFromHtml = (html, origin) => {
  const blocks = extractJsonLd(html);
  const product = findProductJsonLd(blocks);
  const meta = extractMetaTags(html);
  const ogType = meta["og:type"]?.toLowerCase() ?? null;
  const hasProductMeta = Boolean(
    (ogType && ogType.includes("product")) ||
      meta["product:price:amount"] ||
      meta["og:price:amount"] ||
      meta["product:availability"] ||
      meta["product:price:currency"],
  );
  const hasPriceMeta = Boolean(meta["product:price:amount"] || meta["og:price:amount"]);
  const hasGenericOgType = ogType === "website" || ogType === "article";
  const hasAddToCart = /add to cart|agregar al carrito|comprar ahora|buy now|comprar/i.test(html);
  const hasPriceHint =
    /\$\s?\d|\bCOP\b|\bUSD\b|\bEUR\b|\bMXN\b|\bARS\b|\bCLP\b/.test(html) ||
    /itemprop=["']price["']/i.test(html) ||
    /itemprop=["']pricecurrency["']/i.test(html);
  const hasImageMeta = Boolean(meta["og:image"] || meta["twitter:image"]);
  const inferredTitle = product?.name ?? meta["og:title"] ?? meta["title"] ?? extractH1(html);
  const hasTitle = Boolean(inferredTitle);
  const hasProductHints = hasAddToCart || (hasPriceHint && hasImageMeta && hasTitle);

  if (!product && !hasProductMeta && !hasProductHints) return null;
  if (!product && hasGenericOgType && !hasPriceMeta) return null;
  if (!product) {
    const productLinkCount = countProductLinks(html, origin);
    if (productLinkCount >= 3) return null;
  }

  return {
    title: inferredTitle || null,
    hasJsonLd: Boolean(product),
    hasProductMeta,
  };
};

const run = async () => {
  await client.connect();

  const res = await client.query(
    `
    SELECT id, name, slug, "siteUrl", "manualReview", metadata
    FROM brands
    WHERE "isActive" = true
      AND lower("ecommercePlatform") = 'unknown'
    ORDER BY "updatedAt" ASC
    `,
  );

  const rows = res.rows;
  const classified = rows.map((row) => {
    const { siteUrl, reasons } = classifyBrand(row);
    return { ...row, siteUrl, reasons };
  });

  const deleteTargets = classified.filter((row) => row.reasons.length > 0);

  const reasonBuckets = {};
  for (const row of deleteTargets) {
    for (const reason of row.reasons) {
      reasonBuckets[reason] = reasonBuckets[reason] || [];
      reasonBuckets[reason].push(row);
    }
  }

  console.log("\nDelete candidates summary:");
  Object.entries(reasonBuckets).forEach(([reason, items]) => {
    console.log(`- ${reason}: ${items.length}`);
  });

  if (deleteTargets.length) {
    const ids = deleteTargets.map((row) => row.id);
    const result = await client.query(
      `DELETE FROM brands WHERE id = ANY($1::text[])`,
      [ids],
    );
    console.log(`\nDeleted brands: ${result.rowCount}`);
  } else {
    console.log("\nNo brands matched delete criteria.");
  }

  const remaining = classified.filter((row) => row.reasons.length === 0 && row.siteUrl);
  const testTargets = remaining.slice(0, 10);

  const results = [];
  for (const row of testTargets) {
    const siteUrl = row.siteUrl;
    const origin = new URL(siteUrl).origin;
    const home = await fetchText(origin, 12000);
    if (!home.text || home.status >= 400) {
      results.push({
        id: row.id,
        name: row.name,
        siteUrl,
        homeStatus: home.status,
        discovered: 0,
        sampleCount: 0,
        fetchOk: 0,
        note: home.status === 0 ? "no_connection" : "home_error",
      });
      continue;
    }

    const productUrls = await discoverProductUrls(siteUrl, 60);
    const samples = productUrls.slice(0, 3);
    let ok = 0;
    for (const url of samples) {
      const page = await fetchText(url, 12000);
      if (!page.text || page.status >= 400) continue;
      const parsed = parseProductFromHtml(page.text, origin);
      if (parsed) ok += 1;
    }

    results.push({
      id: row.id,
      name: row.name,
      siteUrl,
      homeStatus: home.status,
      discovered: productUrls.length,
      sampleCount: samples.length,
      fetchOk: ok,
      note: productUrls.length ? null : "no_product_urls",
    });
  }

  console.log("\nDry-run extraction tests (no DB writes):");
  console.log(JSON.stringify(results, null, 2));

  await client.end();
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
