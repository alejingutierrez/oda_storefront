import { prisma } from "@/lib/prisma";
import type { AdapterContext, ExtractSummary, RawProduct, RawVariant } from "@/lib/catalog/types";
import { getCatalogAdapter } from "@/lib/catalog/registry";
import { normalizeCatalogProductWithOpenAI } from "@/lib/catalog/normalizer";
import { uploadImagesToBlob } from "@/lib/catalog/blob";
import { normalizeSize, pickOption } from "@/lib/catalog/utils";

const toNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const resolveStockStatus = (variant: RawVariant) => {
  if (variant.available === false) return "out_of_stock";
  if (variant.available === true) return "in_stock";
  if (typeof variant.stock === "number") {
    return variant.stock > 0 ? "in_stock" : "out_of_stock";
  }
  return null;
};

const buildVariantSku = (variant: RawVariant, fallback: string) => {
  if (variant.sku && variant.sku.trim()) return variant.sku.trim();
  if (variant.id && String(variant.id).trim()) return String(variant.id).trim();
  return fallback;
};

const extractVariantOptions = (variant: RawVariant) => {
  const options = variant.options ?? {};
  const color = pickOption(options, ["color", "colour", "tono"]);
  const sizeRaw = pickOption(options, ["talla", "size", "tamano", "tamaño"]);
  return {
    color: color ?? null,
    size: normalizeSize(sizeRaw),
  };
};

const buildVariantImages = (
  variant: RawVariant,
  mapping: Map<string, { url: string }>,
  fallback: string[],
) => {
  const sources = [variant.image ?? "", ...(variant.images ?? [])].filter(Boolean);
  const mapped = sources
    .map((source) => mapping.get(source)?.url)
    .filter(Boolean) as string[];
  if (mapped.length) return Array.from(new Set(mapped));
  return fallback;
};

const upsertProduct = async (brandId: string, raw: RawProduct, normalized: any, imageCoverUrl: string | null) => {
  const conditions = [] as Array<{ externalId?: string; sourceUrl?: string }>;
  if (raw.externalId) conditions.push({ externalId: raw.externalId });
  if (raw.sourceUrl) conditions.push({ sourceUrl: raw.sourceUrl });

  const existing = conditions.length
    ? await prisma.product.findFirst({
        where: {
          brandId,
          OR: conditions,
        },
      })
    : null;

  const data = {
    brandId,
    externalId: raw.externalId ?? null,
    name: normalized.name ?? raw.title ?? "Sin nombre",
    description: normalized.description ?? raw.description ?? null,
    category: normalized.category ?? null,
    subcategory: normalized.subcategory ?? null,
    styleTags: normalized.style_tags ?? [],
    materialTags: normalized.material_tags ?? [],
    patternTags: normalized.pattern_tags ?? [],
    occasionTags: normalized.occasion_tags ?? [],
    gender: normalized.gender ?? null,
    season: normalized.season ?? null,
    care: normalized.care ?? null,
    origin: normalized.origin ?? null,
    status: normalized.status ?? null,
    sourceUrl: raw.sourceUrl ?? null,
    imageCoverUrl,
    metadata: {
      ...(normalized.metadata ?? {}),
      platform: raw.metadata?.platform ?? null,
      extraction: {
        source_url: raw.sourceUrl,
        external_id: raw.externalId,
        scraped_at: new Date().toISOString(),
        source_images: raw.images ?? [],
      },
    },
  };

  if (existing) {
    const product = await prisma.product.update({ where: { id: existing.id }, data });
    return { product, created: false };
  }

  const product = await prisma.product.create({ data });
  return { product, created: true };
};

const upsertVariant = async (productId: string, variant: any) => {
  const sku = variant.sku;
  const existing = sku
    ? await prisma.variant.findUnique({
        where: { productId_sku: { productId, sku } },
      })
    : null;

  const data = {
    productId,
    sku,
    color: variant.color ?? null,
    size: variant.size ?? null,
    fit: variant.fit ?? null,
    material: variant.material ?? null,
    price: variant.price ?? 0,
    currency: variant.currency ?? "COP",
    stock: variant.stock ?? null,
    stockStatus: variant.stock_status ?? null,
    images: variant.images ?? [],
    metadata: variant.metadata ?? null,
  };

  if (existing) {
    const updated = await prisma.variant.update({ where: { id: existing.id }, data });
    return { variant: updated, created: false };
  }

  const created = await prisma.variant.create({ data });
  return { variant: created, created: true };
};

export const extractCatalogForBrand = async (brandId: string, limit = 20): Promise<ExtractSummary> => {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || !brand.siteUrl) {
    throw new Error("Marca sin sitio web configurado");
  }

  const adapter = getCatalogAdapter(brand.ecommercePlatform);
  const ctx: AdapterContext = {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
    },
  };

  const refs = await adapter.discoverProducts(ctx, limit);
  const summary: ExtractSummary = {
    brandId: brand.id,
    platform: adapter.platform,
    discovered: refs.length,
    processed: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  for (const ref of refs) {
    try {
      const raw = await adapter.fetchProduct(ctx, ref);
      if (!raw) continue;

      const allImages = Array.from(
        new Set([
          ...raw.images,
          ...raw.variants.flatMap((variant) => [
            variant.image ?? "",
            ...(variant.images ?? []),
          ]),
        ].filter(Boolean)),
      );
      const imagePrefix = `catalog/${brand.slug}/${raw.externalId ?? "product"}`;
      const imageMapping = await uploadImagesToBlob(allImages, imagePrefix);
      const blobImages = raw.images
        .map((url) => imageMapping.get(url)?.url)
        .filter(Boolean) as string[];
      const coverImage = blobImages[0] ?? null;

      const normalized = await normalizeCatalogProductWithOpenAI({
        ...raw,
        images: blobImages.length ? blobImages : raw.images,
      });

      const { product, created } = await upsertProduct(brand.id, raw, normalized, coverImage);

      const fallbackImages = blobImages.length ? blobImages : raw.images;
      const normalizedVariantMap = new Map<string, any>();
      if (Array.isArray(normalized.variants)) {
        normalized.variants.forEach((variant: any) => {
          if (variant?.sku) normalizedVariantMap.set(String(variant.sku), variant);
        });
      }

      const rawVariants = raw.variants.length
        ? raw.variants
        : [
            {
              sku: raw.externalId ?? null,
              price: null,
              currency: raw.currency ?? "COP",
              images: raw.images,
            } as RawVariant,
          ];

      let createdVariants = 0;
      for (let index = 0; index < rawVariants.length; index += 1) {
        const rawVariant = rawVariants[index];
        const sku = buildVariantSku(rawVariant, `${product.id}-${index}`);
        const options = extractVariantOptions(rawVariant);
        const normalizedVariant = normalizedVariantMap.get(sku) ?? null;
        const color = options.color ?? normalizedVariant?.color ?? null;
        const size = options.size ?? normalizedVariant?.size ?? null;
        const variantImages = buildVariantImages(rawVariant, imageMapping, fallbackImages);
        const variantPayload = {
          sku,
          color,
          size,
          fit: normalizedVariant?.fit ?? null,
          material: normalizedVariant?.material ?? null,
          price: toNumber(rawVariant.price) ?? toNumber(normalizedVariant?.price) ?? 0,
          currency: rawVariant.currency ?? normalizedVariant?.currency ?? raw.currency ?? "COP",
          stock: typeof rawVariant.stock === "number" ? rawVariant.stock : null,
          stock_status: resolveStockStatus(rawVariant),
          images: variantImages,
          metadata: {
            compare_at_price: toNumber(rawVariant.compareAtPrice),
            source_variant_id: rawVariant.id ?? null,
            options: rawVariant.options ?? null,
            source_images: [rawVariant.image ?? "", ...(rawVariant.images ?? [])].filter(Boolean),
          },
        };
        const variantResult = await upsertVariant(product.id, variantPayload);
        if (variantResult.created) createdVariants += 1;
      }

      summary.processed += 1;
      if (created) summary.created += 1;
      if (!created && createdVariants === 0) summary.updated += 1;
    } catch (error) {
      summary.errors.push({
        url: ref.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
};
