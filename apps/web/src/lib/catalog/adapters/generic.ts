import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import {
  discoverFromSitemap,
  extractSitemapUrls,
  fetchText,
  isLikelyProductUrl,
  normalizeUrl,
  parsePriceValue,
  safeOrigin,
} from "@/lib/catalog/utils";

const extractJsonLd = (html: string) => {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: any[] = [];
  let match: RegExpExecArray | null;
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

const isProductType = (value: any) => {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => String(entry).toLowerCase().includes("product"));
  }
  return String(value).toLowerCase().includes("product");
};

const findProductJsonLd = (blocks: any[]) => {
  for (const block of blocks) {
    if (!block) continue;
    if (Array.isArray(block)) {
      const found = block.find((item: any) => isProductType(item?.["@type"]));
      if (found) return found;
    }
    if (isProductType(block["@type"])) return block;
    if (Array.isArray(block["@graph"])) {
      const found = block["@graph"].find((item: any) => isProductType(item?.["@type"]));
      if (found) return found;
    }
  }
  return null;
};

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const parseTagAttributes = (tag: string) => {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z:-]+)=(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[3];
  }
  return attrs;
};

const extractMetaTags = (html: string) => {
  const regex = /<meta\s+[^>]*>/gi;
  const map: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const tag = match[0];
    const attrs = parseTagAttributes(tag);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    const content = attrs.content;
    if (key && content) {
      map[key] = decodeHtml(content);
    }
  }
  return map;
};

const extractLinksFromHtml = (html: string, origin: string) => {
  const regex = /<a[^>]+href=(["'])(.*?)\1/gi;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
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

const countProductLinks = (html: string, origin: string, threshold = 3) => {
  const regex = /<a[^>]+href=(["'])(.*?)\1/gi;
  let match: RegExpExecArray | null;
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

const extractH1 = (html: string) => {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decodeHtml(text);
};

const extractOffers = (offers: any) => {
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  const first = list[0] ?? {};
  const price =
    first.price ??
    first.lowPrice ??
    first.highPrice ??
    first?.priceSpecification?.price ??
    null;
  const currency =
    first.priceCurrency ??
    first?.priceSpecification?.priceCurrency ??
    null;
  const availability = first.availability ?? null;
  return { price, currency, availability };
};

export const genericAdapter: CatalogAdapter = {
  platform: "custom",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const origin = safeOrigin(baseUrl);
    const urls = await discoverFromSitemap(baseUrl, limit * 3, { productAware: true });
    const filtered = urls.filter(isLikelyProductUrl);
    if (filtered.length) return filtered.slice(0, limit).map((url) => ({ url }));
    if (urls.length) return urls.slice(0, limit).map((url) => ({ url }));

    if (ctx.brand.ecommercePlatform?.toLowerCase() === "wix") {
      const wixSitemapUrl = new URL("/store-products-sitemap.xml", origin).toString();
      const wixSitemap = await fetchText(wixSitemapUrl);
      if (wixSitemap.text) {
        const wixUrls = extractSitemapUrls(wixSitemap.text, limit * 3);
        const wixProducts = wixUrls.filter(isLikelyProductUrl);
        if (wixProducts.length) return wixProducts.slice(0, limit).map((url) => ({ url }));
      }
    }

    const pagesToProbe = ["/", "/tienda", "/shop", "/productos", "/producto", "/store", "/catalogo", "/catalog"];
    const candidates = new Set<string>();

    for (const path of pagesToProbe) {
      if (candidates.size >= limit) break;
      const pageUrl = new URL(path, origin).toString();
      const page = await fetchText(pageUrl);
      if (!page.text) continue;
      const links = extractLinksFromHtml(page.text, origin);
      links.filter(isLikelyProductUrl).forEach((url) => candidates.add(url));
    }

    return Array.from(candidates).slice(0, limit).map((url) => ({ url }));
  },
  fetchProduct: async (ctx: AdapterContext, ref: ProductRef) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return null;
    const origin = safeOrigin(baseUrl);
    const response = await fetchText(ref.url.startsWith("http") ? ref.url : new URL(ref.url, origin).toString());
    if (response.status >= 400) return null;
    const html = response.text ?? "";
    const blocks = extractJsonLd(html);
    const product = findProductJsonLd(blocks);
    const meta = extractMetaTags(html);
    const offers = extractOffers(product?.offers);
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
    const hasPriceHint = /\\$\\s?\\d|\\bCOP\\b|\\bUSD\\b|\\bEUR\\b|\\bMXN\\b|\\bARS\\b|\\bCLP\\b/.test(html);
    const hasImageMeta = Boolean(meta["og:image"] || meta["twitter:image"]);
    const inferredTitle = product?.name ?? meta["og:title"] ?? meta["title"] ?? extractH1(html);
    const hasTitle = Boolean(inferredTitle);
    const hasProductHints = hasAddToCart || (hasPriceHint && hasImageMeta && hasTitle);

    if (!product && !hasProductMeta && !hasProductHints) {
      return null;
    }
    if (!product && hasGenericOgType && !hasPriceMeta) {
      return null;
    }
    if (!product) {
      const productLinkCount = countProductLinks(html, origin);
      if (productLinkCount >= 3) {
        return null;
      }
    }

    const images = (() => {
      if (product) {
        if (Array.isArray(product.image)) return product.image.filter(Boolean);
        if (typeof product.image === "string") return [product.image];
      }
      if (meta["og:image"]) return [meta["og:image"]];
      if (meta["twitter:image"]) return [meta["twitter:image"]];
      return [];
    })();

    const raw: RawProduct = {
      sourceUrl: ref.url,
      externalId: product?.sku ?? product?.productID ?? null,
      title: product?.name ?? meta["og:title"] ?? meta["title"] ?? extractH1(html),
      description: product?.description ?? meta["description"] ?? meta["og:description"] ?? null,
      vendor: product?.brand?.name ?? null,
      currency: offers?.currency ?? meta["product:price:currency"] ?? meta["og:price:currency"] ?? "COP",
      images,
      options: [],
      variants: [
        {
          sku: product?.sku ?? null,
          price: offers?.price
            ? parsePriceValue(offers.price)
            : meta["product:price:amount"]
              ? parsePriceValue(meta["product:price:amount"])
              : null,
          currency: offers?.currency ?? meta["product:price:currency"] ?? meta["og:price:currency"] ?? "COP",
          available: offers?.availability
            ? !String(offers.availability).toLowerCase().includes("outofstock")
            : meta["product:availability"]
              ? !String(meta["product:availability"]).toLowerCase().includes("outofstock")
              : null,
          stock: null,
          image: images[0] ?? null,
          images: images.slice(0, 3),
        },
      ],
      metadata: {
        platform: "custom",
        jsonld: !!product,
        meta: Object.keys(meta).length ? meta : null,
      },
    };

    return raw;
  },
};
