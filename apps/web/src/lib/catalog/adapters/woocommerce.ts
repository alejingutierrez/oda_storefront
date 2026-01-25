import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import { genericAdapter } from "@/lib/catalog/adapters/generic";
import { fetchText, normalizeUrl, parsePriceValue, safeOrigin } from "@/lib/catalog/utils";

const parsePrice = (value: unknown, minorUnit = 2) => {
  const num = parsePriceValue(value);
  if (num === null) return null;
  if (minorUnit > 0) {
    return Math.round(num) / Math.pow(10, minorUnit);
  }
  return num;
};

const buildVariantsFromAttributes = (product: any) => {
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  const options: Record<string, string[]> = {};
  attributes.forEach((attr: any) => {
    const name = attr.name ?? attr.slug ?? "";
    if (!name) return;
    if (Array.isArray(attr.options) && attr.options.length) {
      options[name] = attr.options;
    }
  });

  const optionEntries = Object.entries(options);
  if (optionEntries.length === 0) return [{}];

  const build = (index: number): Record<string, string>[] => {
    if (index >= optionEntries.length) return [{}];
    const [key, values] = optionEntries[index];
    const tail = build(index + 1);
    const result: Record<string, string>[] = [];
    values.forEach((value) => {
      tail.forEach((entry) => {
        result.push({ ...entry, [key]: value });
      });
    });
    return result;
  };

  return build(0);
};

export const wooCommerceAdapter: CatalogAdapter = {
  platform: "woocommerce",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const origin = safeOrigin(baseUrl);
    const perPage = 50;
    const refs: ProductRef[] = [];
    let page = 1;

    while (refs.length < limit) {
      const url = new URL("/wp-json/wc/store/v1/products", origin);
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      const response = await fetchText(url.toString());
      if (response.status >= 400) break;
      let data: any[] = [];
      try {
        data = JSON.parse(response.text) as any[];
      } catch {
        break;
      }
      if (!Array.isArray(data) || data.length === 0) break;
      data.forEach((item) => {
        if (refs.length < limit) {
          refs.push({ url: item.permalink ?? item.slug ?? item.id, externalId: item.id ? String(item.id) : null });
        }
      });
      if (data.length < perPage) break;
      page += 1;
    }

    return refs.slice(0, limit);
  },
  fetchProduct: async (ctx: AdapterContext, ref: ProductRef) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return null;
    const origin = safeOrigin(baseUrl);
    const externalId = ref.externalId ?? null;
    const url = externalId
      ? new URL(`/wp-json/wc/store/v1/products/${externalId}`, origin).toString()
      : ref.url;

    const response = await fetchText(url);
    const fallback = async () => {
      if (!ref.url) return null;
      const raw = await genericAdapter.fetchProduct(ctx, { url: ref.url });
      if (!raw) return null;
      return {
        ...raw,
        metadata: {
          ...(raw.metadata ?? {}),
          platform: "woocommerce",
          fallback: "html",
        },
      } as RawProduct;
    };

    if (response.status >= 400) {
      return fallback();
    }
    let data: any;
    try {
      data = JSON.parse(response.text);
    } catch {
      return fallback();
    }

    const images = Array.isArray(data.images)
      ? data.images.map((img: any) => img?.src).filter(Boolean)
      : [];

    const priceInfo = data.prices ?? {};
    const minorUnit = Number(priceInfo.currency_minor_unit ?? 2);
    const price = parsePrice(priceInfo.price, minorUnit);
    const compareAtPrice = parsePrice(priceInfo.regular_price, minorUnit);

    const rawVariants: RawProduct["variants"] = [];

    if (Array.isArray(data.variations) && data.variations.length > 0) {
      data.variations.forEach((variation: any) => {
        const variationPriceInfo = variation.prices ?? priceInfo;
        const vMinor = Number(variationPriceInfo.currency_minor_unit ?? minorUnit);
        rawVariants.push({
          id: variation.id ? String(variation.id) : null,
          sku: variation.sku ? String(variation.sku) : variation.id ? String(variation.id) : null,
          options: variation.attributes
            ? variation.attributes.reduce((acc: Record<string, string>, attr: any) => {
                if (attr.name && attr.value) acc[attr.name] = attr.value;
                return acc;
              }, {})
            : undefined,
          price: parsePrice(variationPriceInfo.price, vMinor) ?? price,
          compareAtPrice: parsePrice(variationPriceInfo.regular_price, vMinor) ?? compareAtPrice,
          currency: variationPriceInfo.currency_code ?? priceInfo.currency_code ?? "COP",
          available: variation.is_in_stock ?? data.is_in_stock ?? null,
          stock: null,
          image: variation.image?.src ?? null,
          images: variation.image?.src ? [variation.image.src] : [],
        });
      });
    } else {
      const optionCombos = buildVariantsFromAttributes(data);
      if (optionCombos.length) {
        optionCombos.forEach((combo, index) => {
          rawVariants.push({
            id: externalId ? `${externalId}-${index}` : null,
            sku: data.sku ? String(data.sku) : externalId ? `${externalId}-${index}` : null,
            options: combo,
            price,
            compareAtPrice,
            currency: priceInfo.currency_code ?? "COP",
            available: data.is_in_stock ?? null,
            stock: null,
            image: images[0] ?? null,
            images: images.slice(0, 3),
          });
        });
      }
    }

    const raw: RawProduct = {
      sourceUrl: data.permalink ?? ref.url,
      externalId: data.id ? String(data.id) : externalId,
      title: data.name ?? null,
      description: data.description ?? null,
      vendor: data.store?.name ?? null,
      currency: priceInfo.currency_code ?? "COP",
      images,
      options: Array.isArray(data.attributes)
        ? data.attributes.map((attr: any) => ({
            name: attr.name ?? attr.slug ?? "",
            values: Array.isArray(attr.options) ? attr.options : [],
          }))
        : [],
      variants: rawVariants.length ? rawVariants : [{ price, compareAtPrice, currency: priceInfo.currency_code ?? "COP" }],
      metadata: {
        platform: "woocommerce",
        categories: Array.isArray(data.categories)
          ? data.categories.map((entry: any) => entry?.name ?? entry?.slug).filter(Boolean)
          : null,
        tags: Array.isArray(data.tags) ? data.tags.map((entry: any) => entry?.name ?? entry?.slug).filter(Boolean) : null,
        attributes: Array.isArray(data.attributes)
          ? data.attributes.map((attr: any) => ({
              name: attr?.name ?? attr?.slug ?? "",
              options: Array.isArray(attr?.options) ? attr.options : [],
            }))
          : null,
        raw: { id: data.id, type: data.type },
      },
    };

    return raw;
  },
};
