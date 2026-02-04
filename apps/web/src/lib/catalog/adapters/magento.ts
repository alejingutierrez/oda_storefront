import type { AdapterContext, CatalogAdapter, ProductRef, RawProduct } from "@/lib/catalog/types";
import { fetchText, normalizeUrl, parsePriceValue, safeOrigin } from "@/lib/catalog/utils";

const graphqlQuery = `query Products($pageSize:Int!, $currentPage:Int!){
  products(pageSize:$pageSize, currentPage:$currentPage){
    items{
      id
      sku
      name
      url_key
      url_suffix
      description{html}
      media_gallery{url label}
      price_range{
        minimum_price{
          regular_price{value currency}
          final_price{value currency}
        }
      }
      ... on ConfigurableProduct {
        configurable_options { attribute_code label values { value_index label } }
        variants {
          attributes { code label value_index }
          product {
            sku
            id
            name
            price_range{ minimum_price{ regular_price{value currency} final_price{value currency} } }
            media_gallery{url label}
          }
        }
      }
    }
  }
}`;

const graphqlByUrlKeyQuery = `query ProductByUrlKey($urlKey:String!){
  products(filter:{ url_key:{ eq:$urlKey } }){
    items{
      id
      sku
      name
      url_key
      url_suffix
      description{html}
      media_gallery{url label}
      price_range{
        minimum_price{
          regular_price{value currency}
          final_price{value currency}
        }
      }
      ... on ConfigurableProduct {
        configurable_options { attribute_code label values { value_index label } }
        variants {
          attributes { code label value_index }
          product {
            sku
            id
            name
            price_range{ minimum_price{ regular_price{value currency} final_price{value currency} } }
            media_gallery{url label}
          }
        }
      }
    }
  }
}`;

const buildProductUrl = (origin: string, item: any) => {
  if (Array.isArray(item.url_rewrites) && item.url_rewrites.length > 0) {
    const rewrite = item.url_rewrites[0]?.url;
    if (rewrite) return new URL(`/${rewrite}`, origin).toString();
  }
  if (!item.url_key) return origin;
  const suffix = item.url_suffix ?? "";
  return new URL(`/${item.url_key}${suffix}`, origin).toString();
};

const extractPrice = (priceRange: any) => {
  const minimum = priceRange?.minimum_price ?? {};
  const regular = minimum.regular_price ?? {};
  const final = minimum.final_price ?? {};
  return {
    price: parsePriceValue(final.value) ?? null,
    compareAtPrice: parsePriceValue(regular.value) ?? null,
    currency: final.currency ?? regular.currency ?? "COP",
  };
};

const extractUrlKey = (rawUrl: string) => {
  try {
    const { pathname } = new URL(rawUrl);
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const cleaned = last.replace(/\.html?$/i, "");
    return cleaned ? decodeURIComponent(cleaned) : null;
  } catch {
    return null;
  }
};

export const magentoAdapter: CatalogAdapter = {
  platform: "magento",
  discoverProducts: async (ctx: AdapterContext, limit = 200) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return [];
    const origin = safeOrigin(baseUrl);
    const pageSize = 20;
    let currentPage = 1;
    const refs: ProductRef[] = [];

    while (refs.length < limit) {
      const response = await fetchText(new URL("/graphql", origin).toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: graphqlQuery, variables: { pageSize, currentPage } }),
      });
      if (response.status >= 400) break;
      let data: any;
      try {
        data = JSON.parse(response.text);
      } catch {
        break;
      }
      const items = data?.data?.products?.items ?? [];
      if (!Array.isArray(items) || items.length === 0) break;
      items.forEach((item: any) => {
        if (refs.length >= limit) return;
        refs.push({
          url: buildProductUrl(origin, item),
          externalId: item.id ? String(item.id) : null,
        });
      });
      if (items.length < pageSize) break;
      currentPage += 1;
    }

    return refs.slice(0, limit);
  },
  fetchProduct: async (ctx: AdapterContext, ref: ProductRef) => {
    const baseUrl = normalizeUrl(ctx.brand.siteUrl);
    if (!baseUrl) return null;
    const origin = safeOrigin(baseUrl);

    const urlKey = extractUrlKey(ref.url);
    if (!urlKey) return null;

    const response = await fetchText(new URL("/graphql", origin).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: graphqlByUrlKeyQuery, variables: { urlKey } }),
    });
    if (response.status >= 400) return null;
    let data: any;
    try {
      data = JSON.parse(response.text);
    } catch {
      return null;
    }
    const items = data?.data?.products?.items ?? [];
    const item = items[0];
    if (!item) return null;

    const images = Array.isArray(item.media_gallery)
      ? item.media_gallery.map((media: any) => media?.url).filter(Boolean)
      : [];

    const priceInfo = extractPrice(item.price_range);

    const variants = Array.isArray(item.variants)
      ? item.variants.map((variant: any) => {
          const variantImages = Array.isArray(variant.product?.media_gallery)
            ? variant.product.media_gallery.map((media: any) => media?.url).filter(Boolean)
            : [];
          const variantPrice = extractPrice(variant.product?.price_range);
          const options = Array.isArray(variant.attributes)
            ? variant.attributes.reduce((acc: Record<string, string>, attr: any) => {
                if (attr.label && attr.value_index !== undefined) {
                  acc[attr.label] = String(attr.value_index);
                }
                return acc;
              }, {})
            : undefined;
          return {
            id: variant.product?.id ? String(variant.product.id) : null,
            sku: variant.product?.sku ? String(variant.product.sku) : null,
            options,
            price: variantPrice.price ?? priceInfo.price,
            compareAtPrice: variantPrice.compareAtPrice ?? priceInfo.compareAtPrice,
            currency: variantPrice.currency ?? priceInfo.currency,
            available: null,
            stock: null,
            image: variantImages[0] ?? null,
            images: variantImages,
          };
        })
      : [];

    const raw: RawProduct = {
      sourceUrl: ref.url,
      externalId: item.id ? String(item.id) : ref.externalId,
      title: item.name ?? null,
      description: item.description?.html ?? null,
      vendor: null,
      currency: priceInfo.currency,
      images,
      options: Array.isArray(item.configurable_options)
        ? item.configurable_options.map((opt: any) => ({
            name: opt.label ?? opt.attribute_code ?? "",
            values: Array.isArray(opt.values) ? opt.values.map((value: any) => value.label ?? String(value.value_index)) : [],
          }))
        : [],
      variants: variants.length ? variants : [{ price: priceInfo.price, compareAtPrice: priceInfo.compareAtPrice, currency: priceInfo.currency }],
      metadata: { platform: "magento", raw: { id: item.id, sku: item.sku } },
    };

    return raw;
  },
};
