import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import { discoverFromSitemap, fetchText, normalizeUrl, safeOrigin } from "@/lib/catalog/utils";

const normalizePrice = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  if (Number.isInteger(num)) return Math.round(num) / 100;
  return num;
};

const extractHandle = (url: string) => {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split("/products/");
    if (parts.length < 2) return null;
    return parts[1].split("/")[0] || null;
  } catch {
    return null;
  }
};

export const shopifyAdapter: CatalogAdapter = {
  platform: "shopify",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const urls = await discoverFromSitemap(baseUrl, limit * 3);
    const filtered = urls.filter((url) => url.includes("/products/"));
    return filtered.slice(0, limit).map((url) => ({ url }));
  },
  fetchProduct: async (ctx: AdapterContext, ref: ProductRef) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return null;
    const handle = ref.handle ?? extractHandle(ref.url);
    if (!handle) return null;
    const origin = safeOrigin(baseUrl);
    const productUrl = new URL(`/products/${handle}.js`, origin).toString();
    const response = await fetchText(productUrl);
    if (response.status >= 400) return null;

    let data: any;
    try {
      data = JSON.parse(response.text);
    } catch {
      return null;
    }

    const images = Array.isArray(data.images)
      ? data.images.map((img: any) => (typeof img === "string" ? img : img?.src)).filter(Boolean)
      : [];

    const variants = Array.isArray(data.variants)
      ? data.variants.map((variant: any) => ({
          id: variant.id ? String(variant.id) : null,
          sku: variant.sku ? String(variant.sku) : variant.id ? String(variant.id) : null,
          options: {
            option1: variant.option1,
            option2: variant.option2,
            option3: variant.option3,
          },
          price: normalizePrice(variant.price),
          compareAtPrice: normalizePrice(variant.compare_at_price),
          currency: data.currency ?? "COP",
          available: variant.available ?? null,
          stock: null,
          image: variant.featured_image?.src ?? null,
          images: variant.featured_image?.src ? [variant.featured_image.src] : [],
        }))
      : [];

    const raw: RawProduct = {
      sourceUrl: ref.url,
      externalId: data.id ? String(data.id) : null,
      title: data.title ?? null,
      description: data.description ?? data.body_html ?? null,
      vendor: data.vendor ?? null,
      currency: data.currency ?? "COP",
      images,
      options: Array.isArray(data.options)
        ? data.options.map((option: any) => ({
            name: option?.name ?? "",
            values: Array.isArray(option?.values) ? option.values : [],
          }))
        : [],
      variants,
      metadata: {
        platform: "shopify",
        handle,
        raw: {
          id: data.id,
        },
      },
    };

    return raw;
  },
};
