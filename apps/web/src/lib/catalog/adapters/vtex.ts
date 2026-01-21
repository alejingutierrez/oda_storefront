import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import { fetchText, normalizeUrl, parsePriceValue, safeOrigin } from "@/lib/catalog/utils";

const mapAvailability = (available: number | null | undefined) => {
  if (available === null || available === undefined) return null;
  if (available <= 0) return false;
  return true;
};

const extractLinkText = (url: string) => {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    if (last === "p" && parts.length >= 2) {
      return parts[parts.length - 2] ?? null;
    }
    return last ?? null;
  } catch {
    return null;
  }
};

export const vtexAdapter: CatalogAdapter = {
  platform: "vtex",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const origin = safeOrigin(baseUrl);
    const refs: ProductRef[] = [];
    let from = 0;

    while (refs.length < limit) {
      const to = Math.min(from + 49, from + (limit - refs.length) - 1);
      const url = new URL(`/api/catalog_system/pub/products/search?_from=${from}&_to=${to}`, origin).toString();
      const response = await fetchText(url);
      if (response.status >= 400) break;
      let data: any[] = [];
      try {
        data = JSON.parse(response.text);
      } catch {
        break;
      }
      if (!Array.isArray(data) || data.length === 0) break;
      data.forEach((product) => {
        if (refs.length >= limit) return;
        const link = product.link ?? product.linkText;
        if (link) {
          refs.push({ url: link, externalId: product.productId ? String(product.productId) : null, handle: product.linkText });
        }
      });
      if (data.length < 50) break;
      from += 50;
    }

    return refs.slice(0, limit);
  },
  fetchProduct: async (ctx: AdapterContext, ref: ProductRef) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return null;
    const origin = safeOrigin(baseUrl);
    const linkText = ref.handle ?? extractLinkText(ref.url);
    if (!linkText) return null;
    const url = new URL(`/api/catalog_system/pub/products/search/${linkText}/p`, origin).toString();
    const response = await fetchText(url);
    if (response.status >= 400) return null;
    let data: any[] = [];
    try {
      data = JSON.parse(response.text) as any[];
    } catch {
      return null;
    }
    const product = Array.isArray(data) ? data[0] : null;
    if (!product) return null;

    const images: string[] = [];
    const variants = Array.isArray(product.items)
      ? product.items.map((item: any) => {
          const itemImages = Array.isArray(item.images)
            ? item.images.map((img: any) => img?.imageUrl).filter(Boolean)
            : [];
          itemImages.forEach((img: string) => images.push(img));
          const seller = Array.isArray(item.sellers) ? item.sellers[0] : null;
          const offer = seller?.commertialOffer ?? {};
          return {
            id: item.itemId ? String(item.itemId) : null,
            sku: item.referenceId?.[0]?.Value ?? item.itemId?.toString() ?? null,
            options: item.variations
              ? item.variations.reduce((acc: Record<string, string>, variation: any, index: number) => {
                  const key = variation?.name ?? `option_${index}`;
                  const value = Array.isArray(variation?.values) ? variation.values[0] : variation?.values;
                  if (key && value) acc[key] = value;
                  return acc;
                }, {})
              : undefined,
            price: parsePriceValue(offer.Price) ?? null,
            compareAtPrice: parsePriceValue(offer.ListPrice) ?? null,
            currency: offer.CurrencyCode ?? "COP",
            available: mapAvailability(offer.AvailableQuantity),
            stock: offer.AvailableQuantity ?? null,
            image: itemImages[0] ?? null,
            images: itemImages,
          };
        })
      : [];

    const raw: RawProduct = {
      sourceUrl: ref.url,
      externalId: product.productId ? String(product.productId) : ref.externalId,
      title: product.productName ?? null,
      description: product.description ?? null,
      vendor: product.brand ?? null,
      currency: "COP",
      images: Array.from(new Set(images)),
      options: Array.isArray(product.itemMetadata?.items)
        ? product.itemMetadata.items.map((item: any) => ({
            name: item?.name ?? "",
            values: Array.isArray(item?.variations) ? item.variations : [],
          }))
        : [],
      variants,
      metadata: { platform: "vtex", raw: { productId: product.productId } },
    };

    return raw;
  },
};
