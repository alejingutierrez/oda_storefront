import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import {
  discoverFromSitemap,
  fetchText,
  isLikelyProductUrl,
  normalizeUrl,
  parsePriceValue,
  safeOrigin,
} from "@/lib/catalog/utils";

const PRODUCT_PATH_LOCALE_RE = /^\/(fr|us)(\/|$)/i;

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
    if (key && content) map[key] = decodeHtml(content);
  }
  return map;
};

const extractH1 = (html: string) => {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decodeHtml(text);
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

const extractJsonLd = (html: string) => {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: unknown[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const raw = match[1];
    try {
      blocks.push(JSON.parse(raw.trim()));
    } catch {
      continue;
    }
  }
  return blocks;
};

const isProductType = (value: unknown) => {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => String(entry).toLowerCase().includes("product"));
  }
  return String(value).toLowerCase().includes("product");
};

const collectProductCandidates = (blocks: unknown[]): Record<string, unknown>[] => {
  const candidates: Record<string, unknown>[] = [];
  for (const block of blocks) {
    if (!block) continue;
    if (Array.isArray(block)) {
      for (const item of block) {
        if (item && typeof item === "object" && isProductType((item as Record<string, unknown>)["@type"])) {
          candidates.push(item as Record<string, unknown>);
        }
      }
      continue;
    }
    if (typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (isProductType(record["@type"])) {
      candidates.push(record);
    }
    const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [];
    for (const item of graph) {
      if (item && typeof item === "object" && isProductType((item as Record<string, unknown>)["@type"])) {
        candidates.push(item as Record<string, unknown>);
      }
    }
  }
  return candidates;
};

const normalizeComparableUrl = (value: string | null | undefined) => {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
      if (!url.pathname) url.pathname = "/";
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

const readString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readProductUrl = (product: Record<string, unknown>) => {
  const direct = readString(product.url) ?? readString(product["@id"]);
  if (direct) return direct;
  const mainEntity = product.mainEntityOfPage;
  if (typeof mainEntity === "string") return readString(mainEntity);
  if (mainEntity && typeof mainEntity === "object" && !Array.isArray(mainEntity)) {
    const mainEntityObj = mainEntity as Record<string, unknown>;
    return readString(mainEntityObj["@id"]) ?? readString(mainEntityObj.url);
  }
  return null;
};

const findPrimaryProductJsonLd = (blocks: unknown[], pageUrl: string) => {
  const candidates = collectProductCandidates(blocks);
  if (!candidates.length) return null;

  const pageKey = normalizeComparableUrl(pageUrl);
  let best: Record<string, unknown> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const candidateUrl = readProductUrl(candidate);
    const candidateKey = normalizeComparableUrl(candidateUrl);
    const candidateIdKey = normalizeComparableUrl(readString(candidate["@id"]));
    const name = readString(candidate.name);
    const offers = candidate.offers;

    let score = 0;
    if (pageKey && candidateKey && candidateKey === pageKey) score += 120;
    if (pageKey && candidateIdKey && candidateIdKey === pageKey) score += 90;
    if (name) score += 5;
    if (offers) score += 5;

    if (candidateUrl && /quickshop|recommended|related|upsell/i.test(candidateUrl)) score -= 60;
    if (!candidateUrl) score -= 10;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
};

const extractOffers = (offers: unknown) => {
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  const first = list[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const price =
    first.price ??
    first.lowPrice ??
    first.highPrice ??
    (first.priceSpecification && typeof first.priceSpecification === "object"
      ? (first.priceSpecification as Record<string, unknown>).price
      : null) ??
    null;
  const currency =
    first.priceCurrency ??
    (first.priceSpecification && typeof first.priceSpecification === "object"
      ? (first.priceSpecification as Record<string, unknown>).priceCurrency
      : null) ??
    null;
  const availability = first.availability ?? null;
  return { price, currency, availability };
};

const hasForeignLocalePath = (url: string) => {
  try {
    const parsed = new URL(url);
    return PRODUCT_PATH_LOCALE_RE.test(parsed.pathname);
  } catch {
    return false;
  }
};

const extractEsCoAlternate = (html: string, baseUrl: string) => {
  const regex = /<link\s+[^>]*rel=(["'])alternate\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const attrs = parseTagAttributes(match[0]);
    const hreflang = (attrs.hreflang ?? "").trim().toLowerCase();
    const href = (attrs.href ?? "").trim();
    if (!href) continue;
    if (hreflang === "es-co" || hreflang === "es_co") {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
};

const buildEsCoFallbackUrl = (url: string, siteBaseUrl: string) => {
  try {
    const current = new URL(url);
    const fallbackBase = new URL(siteBaseUrl);
    const nextPath = current.pathname.replace(PRODUCT_PATH_LOCALE_RE, "/");
    const nextUrl = new URL(current.toString());
    const pathname = nextPath.length ? nextPath : "/";
    nextUrl.protocol = fallbackBase.protocol;
    nextUrl.host = fallbackBase.host;
    nextUrl.pathname = pathname;
    return nextUrl.toString();
  } catch {
    return null;
  }
};

const fetchTiendanubeProductPage = async (requestUrl: string, siteBaseUrl: string) => {
  const first = await fetchText(requestUrl);
  if (first.status >= 400 || !first.text) {
    return {
      response: first,
      localeResolution: {
        requestedUrl: requestUrl,
        resolvedUrl: first.finalUrl ?? requestUrl,
        forcedEsCo: false,
        resolvedVia: "initial",
      },
    };
  }

  const firstResolvedUrl = first.finalUrl ?? requestUrl;
  if (!hasForeignLocalePath(firstResolvedUrl)) {
    return {
      response: first,
      localeResolution: {
        requestedUrl: requestUrl,
        resolvedUrl: firstResolvedUrl,
        forcedEsCo: false,
        resolvedVia: "initial",
      },
    };
  }

  const esCoFromAlternate = extractEsCoAlternate(first.text, firstResolvedUrl);
  if (esCoFromAlternate && esCoFromAlternate !== firstResolvedUrl) {
    const second = await fetchText(esCoFromAlternate);
    if (second.status < 400 && second.text) {
      return {
        response: second,
        localeResolution: {
          requestedUrl: requestUrl,
          resolvedUrl: second.finalUrl ?? esCoFromAlternate,
          forcedEsCo: true,
          resolvedVia: "hreflang_es_co",
        },
      };
    }
  }

  const fallbackUrl = buildEsCoFallbackUrl(firstResolvedUrl, siteBaseUrl);
  if (fallbackUrl && fallbackUrl !== firstResolvedUrl) {
    const second = await fetchText(fallbackUrl);
    if (second.status < 400 && second.text) {
      return {
        response: second,
        localeResolution: {
          requestedUrl: requestUrl,
          resolvedUrl: second.finalUrl ?? fallbackUrl,
          forcedEsCo: true,
          resolvedVia: "path_fallback",
        },
      };
    }
  }

  return {
    response: first,
    localeResolution: {
      requestedUrl: requestUrl,
      resolvedUrl: firstResolvedUrl,
      forcedEsCo: false,
      resolvedVia: "initial",
    },
  };
};

export const tiendanubeAdapter: CatalogAdapter = {
  platform: "tiendanube",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const origin = safeOrigin(baseUrl);
    const sitemapUrls = await discoverFromSitemap(baseUrl, limit * 5, { productAware: true });
    const fromSitemap = Array.from(new Set(sitemapUrls.filter(isLikelyProductUrl)));
    if (fromSitemap.length) return fromSitemap.slice(0, limit).map((url) => ({ url }));

    const pagesToProbe = ["/", "/productos", "/tienda", "/shop", "/catalogo"];
    const candidates = new Set<string>();
    for (const path of pagesToProbe) {
      if (candidates.size >= limit) break;
      const page = await fetchText(new URL(path, origin).toString());
      if (!page.text) continue;
      const links = extractLinksFromHtml(page.text, origin);
      links.filter(isLikelyProductUrl).forEach((url) => candidates.add(url));
    }
    return Array.from(candidates).slice(0, limit).map((url) => ({ url }));
  },
  fetchProduct: async (ctx: AdapterContext, ref: ProductRef) => {
    const siteBaseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!siteBaseUrl) return null;
    const origin = safeOrigin(siteBaseUrl);
    const requestUrl = ref.url.startsWith("http") ? ref.url : new URL(ref.url, origin).toString();
    const { response, localeResolution } = await fetchTiendanubeProductPage(requestUrl, siteBaseUrl);
    if (response.status >= 400) return null;
    const html = response.text ?? "";
    const finalUrl = response.finalUrl ?? requestUrl;

    const blocks = extractJsonLd(html);
    const product = findPrimaryProductJsonLd(blocks, finalUrl);
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
    const hasPriceHint =
      /\\$\\s?\\d|\\bCOP\\b|\\bUSD\\b|\\bEUR\\b|\\bARS\\b/.test(html) ||
      /itemprop=["']price["']/i.test(html) ||
      /itemprop=["']pricecurrency["']/i.test(html);
    const hasImageMeta = Boolean(meta["og:image"] || meta["twitter:image"]);
    const inferredTitle = readString(product?.name) ?? meta["og:title"] ?? meta["title"] ?? extractH1(html);
    const hasTitle = Boolean(inferredTitle);
    const hasProductHints = hasAddToCart || (hasPriceHint && hasImageMeta && hasTitle);

    if (!product && !hasProductMeta && !hasProductHints) return null;
    if (!product && hasGenericOgType && !hasPriceMeta) return null;

    const images = (() => {
      if (product) {
        const rawImages = product.image;
        if (Array.isArray(rawImages)) return rawImages.filter((entry) => typeof entry === "string");
        if (typeof rawImages === "string") return [rawImages];
      }
      if (meta["og:image"]) return [meta["og:image"]];
      if (meta["twitter:image"]) return [meta["twitter:image"]];
      return [];
    })();

    const raw: RawProduct = {
      sourceUrl: finalUrl,
      externalId: readString(product?.sku) ?? readString(product?.productID) ?? ref.externalId ?? null,
      title: inferredTitle,
      description: readString(product?.description) ?? meta["description"] ?? meta["og:description"] ?? null,
      vendor:
        (product?.brand && typeof product.brand === "object"
          ? readString((product.brand as Record<string, unknown>).name)
          : null) ?? null,
      currency: readString(offers?.currency) ?? meta["product:price:currency"] ?? meta["og:price:currency"] ?? "COP",
      images,
      options: [],
      variants: [
        {
          sku: readString(product?.sku) ?? null,
          price: offers?.price
            ? parsePriceValue(offers.price)
            : meta["product:price:amount"]
              ? parsePriceValue(meta["product:price:amount"])
              : null,
          currency:
            readString(offers?.currency) ?? meta["product:price:currency"] ?? meta["og:price:currency"] ?? "COP",
          available: offers?.availability
            ? !String(offers.availability).toLowerCase().includes("outofstock")
            : meta["product:availability"]
              ? !String(meta["product:availability"]).toLowerCase().includes("outofstock")
              : null,
          stock: null,
          image: images[0] ?? null,
          images: images.slice(0, 5),
        },
      ],
      metadata: {
        platform: "tiendanube",
        jsonld: Boolean(product),
        locale_resolution: localeResolution,
        meta: Object.keys(meta).length ? meta : null,
      },
    };

    return raw;
  },
};
