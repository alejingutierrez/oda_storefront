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

const extractMaxPriceFromHtml = (html: string | null | undefined) => {
  if (!html) return null;
  const matches = html.match(/[0-9][0-9.,]*/g) ?? [];
  let max = 0;
  let found = false;
  for (const match of matches) {
    const value = parsePriceValue(match);
    if (value === null) continue;
    found = true;
    if (value > max) max = value;
  }
  return found ? max : null;
};

const resolvePriceInfo = (priceInfo: any, minorUnit: number, priceHtml?: string | null) => {
  const price = parsePrice(priceInfo?.price, minorUnit);
  const regular = parsePrice(priceInfo?.regular_price, minorUnit);
  const sale = parsePrice(priceInfo?.sale_price, minorUnit);
  const rangeMax = parsePrice(priceInfo?.price_range?.max_amount ?? priceInfo?.price_range?.max, minorUnit);
  const rangeMin = parsePrice(priceInfo?.price_range?.min_amount ?? priceInfo?.price_range?.min, minorUnit);
  const htmlMax = extractMaxPriceFromHtml(priceHtml ?? null);

  let resolvedPrice = price;
  if (resolvedPrice === null || resolvedPrice === 0) {
    resolvedPrice = sale ?? regular ?? rangeMax ?? rangeMin ?? htmlMax ?? price;
  }
  const compareAtPrice = regular ?? null;
  return { price: resolvedPrice ?? null, compareAtPrice };
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

const extractProductIdFromHtml = (html: string) => {
  const patterns = [
    /data-product_id=["'](\d+)["']/i,
    /data-productid=["'](\d+)["']/i,
    /name=["']add-to-cart["'][^>]*value=["'](\d+)["']/i,
    /"product_id"\s*:\s*(\d+)/i,
    /"productId"\s*:\s*(\d+)/i,
    /product_id["']?\s*[:=]\s*["']?(\d+)/i,
    /productId["']?\s*[:=]\s*["']?(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
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
    const fetchApiById = async (productId: string) => {
      const apiUrl = new URL(`/wp-json/wc/store/v1/products/${productId}`, origin).toString();
      const apiRes = await fetchText(apiUrl);
      if (apiRes.status >= 400) return null;
      try {
        return JSON.parse(apiRes.text);
      } catch {
        return null;
      }
    };
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
      data = null;
    }
    if (!data && response.text) {
      const inferredId = extractProductIdFromHtml(response.text);
      if (inferredId) {
        data = await fetchApiById(inferredId);
      }
    }
    if (!data) {
      return fallback();
    }

    const productData = Array.isArray(data) ? data[0] : data;
    if (!productData) return fallback();

    const images = Array.isArray(productData.images)
      ? productData.images.map((img: any) => img?.src).filter(Boolean)
      : [];

    const priceInfo = productData.prices ?? {};
    const minorUnit = Number(priceInfo.currency_minor_unit ?? 2);
    let { price, compareAtPrice } = resolvePriceInfo(
      priceInfo,
      minorUnit,
      productData.price_html ?? null,
    );
    let currency = priceInfo.currency_code ?? null;
    let htmlFallbackPrice: { price: number | null; compareAtPrice: number | null; currency: string | null } | null =
      null;

    const pickFallbackVariant = (raw: RawProduct | null) => {
      if (!raw?.variants?.length) return null;
      const variant =
        raw.variants.find((entry) => typeof entry?.price === "number" && entry.price > 0) ?? raw.variants[0];
      if (!variant) return null;
      return {
        price: typeof variant.price === "number" ? variant.price : null,
        compareAtPrice:
          typeof variant.compareAtPrice === "number" ? variant.compareAtPrice : null,
        currency: variant.currency ?? raw.currency ?? null,
      };
    };

    const hydrateFromHtml = async () => {
      if (htmlFallbackPrice) return htmlFallbackPrice;
      const fallbackUrl = productData.permalink ?? ref.url;
      if (!fallbackUrl) return null;
      const fallback = await genericAdapter.fetchProduct(ctx, { url: fallbackUrl });
      htmlFallbackPrice = pickFallbackVariant(fallback);
      return htmlFallbackPrice;
    };

    if (!price || price <= 0) {
      const fallback = await hydrateFromHtml();
      if (fallback?.price && fallback.price > 0) {
        price = fallback.price;
        compareAtPrice = compareAtPrice ?? fallback.compareAtPrice ?? null;
        currency = fallback.currency ?? currency;
      }
    }

    const rawVariants: RawProduct["variants"] = [];

    if (Array.isArray(productData.variations) && productData.variations.length > 0) {
      productData.variations.forEach((variation: any) => {
        const variationPriceInfo = variation.prices ?? priceInfo;
        const vMinor = Number(variationPriceInfo.currency_minor_unit ?? minorUnit);
        const variationHtml = variation.price_html ?? productData.price_html ?? null;
        const resolvedVariationPrice = resolvePriceInfo(variationPriceInfo, vMinor, variationHtml);
        const fallbackPrice = htmlFallbackPrice?.price ?? price ?? null;
        const fallbackCompare = htmlFallbackPrice?.compareAtPrice ?? compareAtPrice ?? null;
        rawVariants.push({
          id: variation.id ? String(variation.id) : null,
          sku: variation.sku ? String(variation.sku) : variation.id ? String(variation.id) : null,
          options: variation.attributes
            ? variation.attributes.reduce((acc: Record<string, string>, attr: any) => {
                if (attr.name && attr.value) acc[attr.name] = attr.value;
                return acc;
              }, {})
            : undefined,
          price:
            resolvedVariationPrice.price && resolvedVariationPrice.price > 0
              ? resolvedVariationPrice.price
              : fallbackPrice,
          compareAtPrice: resolvedVariationPrice.compareAtPrice ?? fallbackCompare,
          currency:
            variationPriceInfo.currency_code ??
            priceInfo.currency_code ??
            currency ??
            htmlFallbackPrice?.currency ??
            "COP",
          available: variation.is_in_stock ?? productData.is_in_stock ?? null,
          stock: null,
          image: variation.image?.src ?? null,
          images: variation.image?.src ? [variation.image.src] : [],
        });
      });
    } else {
      const optionCombos = buildVariantsFromAttributes(productData);
      if (optionCombos.length) {
        optionCombos.forEach((combo, index) => {
          rawVariants.push({
            id: externalId ? `${externalId}-${index}` : null,
            sku: productData.sku ? String(productData.sku) : externalId ? `${externalId}-${index}` : null,
            options: combo,
            price: price ?? htmlFallbackPrice?.price ?? null,
            compareAtPrice: compareAtPrice ?? htmlFallbackPrice?.compareAtPrice ?? null,
            currency: currency ?? htmlFallbackPrice?.currency ?? "COP",
            available: productData.is_in_stock ?? null,
            stock: null,
            image: images[0] ?? null,
            images: images.slice(0, 3),
          });
        });
      }
    }

    const raw: RawProduct = {
      sourceUrl: productData.permalink ?? ref.url,
      externalId: productData.id ? String(productData.id) : externalId,
      title: productData.name ?? null,
      description: productData.description ?? null,
      vendor: productData.store?.name ?? null,
      currency: priceInfo.currency_code ?? "COP",
      images,
      options: Array.isArray(productData.attributes)
        ? productData.attributes.map((attr: any) => ({
            name: attr.name ?? attr.slug ?? "",
            values: Array.isArray(attr.options) ? attr.options : [],
          }))
        : [],
      variants: rawVariants.length ? rawVariants : [{ price, compareAtPrice, currency: priceInfo.currency_code ?? "COP" }],
      metadata: {
        platform: "woocommerce",
        categories: Array.isArray(productData.categories)
          ? productData.categories.map((entry: any) => entry?.name ?? entry?.slug).filter(Boolean)
          : null,
        tags: Array.isArray(productData.tags)
          ? productData.tags.map((entry: any) => entry?.name ?? entry?.slug).filter(Boolean)
          : null,
        attributes: Array.isArray(productData.attributes)
          ? productData.attributes.map((attr: any) => ({
              name: attr?.name ?? attr?.slug ?? "",
              options: Array.isArray(attr?.options) ? attr.options : [],
            }))
          : null,
        raw: { id: productData.id, type: productData.type },
      },
    };

    return raw;
  },
};
