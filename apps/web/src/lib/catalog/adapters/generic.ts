import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import { discoverFromSitemap, fetchText, normalizeUrl, safeOrigin } from "@/lib/catalog/utils";

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

const findProductJsonLd = (blocks: any[]) => {
  for (const block of blocks) {
    if (!block) continue;
    if (block["@type"] === "Product") return block;
    if (Array.isArray(block["@graph"])) {
      const found = block["@graph"].find((item: any) => item?.["@type"] === "Product");
      if (found) return found;
    }
  }
  return null;
};

export const genericAdapter: CatalogAdapter = {
  platform: "custom",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const urls = await discoverFromSitemap(baseUrl, limit * 3);
    const filtered = urls.filter((url) =>
      ["/product", "/products", "/p/"].some((token) => url.includes(token)),
    );
    const picks = filtered.length ? filtered : urls;
    return picks.slice(0, limit).map((url) => ({ url }));
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

    const images = (() => {
      if (!product) return [];
      if (Array.isArray(product.image)) return product.image.filter(Boolean);
      if (typeof product.image === "string") return [product.image];
      return [];
    })();

    const offers = product?.offers ?? {};
    const offerList = Array.isArray(offers) ? offers : [offers];
    const firstOffer = offerList[0] ?? {};

    const raw: RawProduct = {
      sourceUrl: ref.url,
      externalId: product?.sku ?? null,
      title: product?.name ?? null,
      description: product?.description ?? null,
      vendor: product?.brand?.name ?? null,
      currency: firstOffer?.priceCurrency ?? "COP",
      images,
      options: [],
      variants: [
        {
          sku: product?.sku ?? null,
          price: firstOffer?.price ? Number(firstOffer.price) : null,
          currency: firstOffer?.priceCurrency ?? "COP",
          available: firstOffer?.availability ? !String(firstOffer.availability).toLowerCase().includes("outofstock") : null,
          stock: null,
          image: images[0] ?? null,
          images: images.slice(0, 3),
        },
      ],
      metadata: { platform: "custom", jsonld: !!product },
    };

    return raw;
  },
};
