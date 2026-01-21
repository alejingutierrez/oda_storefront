import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdapterContext, ExtractSummary, RawProduct, RawVariant } from "@/lib/catalog/types";
import { getCatalogAdapter } from "@/lib/catalog/registry";
import { normalizeCatalogProductWithOpenAI } from "@/lib/catalog/normalizer";
import { uploadImagesToBlob } from "@/lib/catalog/blob";
import {
  discoverFromSitemap,
  guessCurrency,
  normalizeSize,
  normalizeUrl,
  parsePriceValue,
  pickOption,
} from "@/lib/catalog/utils";

const toNumber = (value: unknown) => parsePriceValue(value);

const resolveStockStatus = (variant: RawVariant) => {
  if (variant.available === false) return "out_of_stock";
  if (variant.available === true) return "in_stock";
  if (typeof variant.stock === "number") {
    return variant.stock > 0 ? "in_stock" : "out_of_stock";
  }
  return null;
};

type CatalogItemState = {
  status: "pending" | "in_progress" | "completed" | "failed";
  attempts: number;
  lastError?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

type CatalogRunState = {
  runId: string;
  status: "processing" | "paused" | "completed" | "blocked" | "stopped";
  cursor: number;
  batchSize: number;
  refs: Array<{ url: string; externalId?: string | null; handle?: string | null }>;
  items: Record<string, CatalogItemState>;
  startedAt: string;
  updatedAt: string;
  lastError?: string | null;
  blockReason?: string | null;
};

const CATALOG_STATE_KEY = "catalog_extract";
const MAX_ATTEMPTS = 3;
const PRODUCT_TOKENS = ["/products", "/product", "/producto", "/productos", "/p/", "/shop", "/tienda"];

const isBlobTokenError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("blob") &&
    (normalized.includes("access denied") || normalized.includes("missing blob_read_write_token"))
  );
};

const getBrandMetadata = (brand: { metadata: unknown }) =>
  brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
    ? (brand.metadata as Record<string, unknown>)
    : {};

export const readCatalogRunState = (metadata: Record<string, unknown>) => {
  const state = metadata[CATALOG_STATE_KEY];
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return state as CatalogRunState;
};

export const summarizeCatalogRunState = (state: CatalogRunState | null) => {
  if (!state) return null;
  const itemStates = Object.values(state.items ?? {});
  const completed = itemStates.filter((item) => item.status === "completed").length;
  const failed = itemStates.filter((item) => item.status === "failed").length;
  const total = state.refs?.length ?? 0;
  const pending = Math.max(0, total - completed - failed);
  return {
    status: state.status,
    runId: state.runId,
    cursor: state.cursor,
    total,
    completed,
    failed,
    pending,
    lastError: state.lastError ?? null,
    blockReason: state.blockReason ?? null,
  };
};

const persistRunState = async (
  brandId: string,
  metadata: Record<string, unknown>,
  state: CatalogRunState,
) => {
  const nextMetadata = { ...metadata, [CATALOG_STATE_KEY]: state };
  await prisma.brand.update({ where: { id: brandId }, data: { metadata: nextMetadata } });
  return nextMetadata;
};

export const pauseCatalogRun = async (brandId: string) => {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return null;
  const metadata = getBrandMetadata(brand);
  const state = readCatalogRunState(metadata);
  if (!state) return null;
  const nextState = {
    ...state,
    status: "paused" as const,
    updatedAt: new Date().toISOString(),
  };
  await persistRunState(brand.id, metadata, nextState);
  return summarizeCatalogRunState(nextState);
};

export const stopCatalogRun = async (brandId: string) => {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return false;
  const metadata = getBrandMetadata(brand);
  if (!(CATALOG_STATE_KEY in metadata)) return true;
  const nextMetadata = { ...metadata };
  delete nextMetadata[CATALOG_STATE_KEY];
  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });
  return true;
};

const discoverRefsFromSitemap = async (siteUrl: string, limit: number) => {
  const normalized = normalizeUrl(siteUrl);
  if (!normalized) return [];
  const urls = await discoverFromSitemap(normalized, limit);
  if (!urls.length) return [];
  const filtered = urls.filter((url) => PRODUCT_TOKENS.some((token) => url.includes(token)));
  const selected = filtered.length ? filtered : urls;
  return selected.map((url) => ({ url }));
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

  const samplePrice = toNumber(raw.variants?.[0]?.price ?? normalized?.variants?.[0]?.price ?? null);
  const currencyValue = guessCurrency(
    samplePrice,
    raw.currency ?? normalized?.variants?.[0]?.currency ?? raw.variants?.[0]?.currency ?? null,
  );

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
    currency: currencyValue ?? null,
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

export const extractCatalogForBrand = async (
  brandId: string,
  limit = 20,
  options: { forceSitemap?: boolean } = {},
): Promise<ExtractSummary> => {
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

  const metadata = getBrandMetadata(brand);
  const existingState = readCatalogRunState(metadata);
  const batchSize = Math.max(1, Math.min(limit, 200));
  const discoveryLimit = Math.max(
    batchSize,
    Math.min(Number(process.env.CATALOG_EXTRACT_DISCOVERY_LIMIT ?? batchSize * 5), 500),
  );
  const sitemapLimit = Math.max(
    discoveryLimit,
    Math.min(Number(process.env.CATALOG_EXTRACT_SITEMAP_LIMIT ?? 5000), 20000),
  );
  const startTime = Date.now();
  const maxRuntimeMs = Math.max(
    30000,
    Number(process.env.CATALOG_EXTRACT_MAX_RUNTIME_MS ?? 240000),
  );

  let state: CatalogRunState;
  let refs: CatalogRunState["refs"] = [];

  if (
    existingState &&
    existingState.status !== "completed" &&
    existingState.status !== "stopped" &&
    existingState.refs?.length
  ) {
    state = {
      ...existingState,
      status: existingState.status === "paused" ? "processing" : existingState.status,
      batchSize,
      updatedAt: new Date().toISOString(),
    };
    refs = state.refs;
  } else {
    const sitemapRefs = options.forceSitemap
      ? await discoverRefsFromSitemap(brand.siteUrl, sitemapLimit)
      : [];
    refs = sitemapRefs.length
      ? sitemapRefs
      : await adapter.discoverProducts(ctx, discoveryLimit);
    const now = new Date().toISOString();
    state = {
      runId: crypto.randomUUID(),
      status: refs.length ? "processing" : "paused",
      cursor: 0,
      batchSize,
      refs,
      items: Object.fromEntries(
        refs.map((ref) => [
          ref.url,
          { status: "pending", attempts: 0, updatedAt: now } as CatalogItemState,
        ]),
      ),
      startedAt: now,
      updatedAt: now,
      lastError: refs.length ? null : "no_products_discovered",
    };
    await persistRunState(brand.id, metadata, state);
  }

  const summary: ExtractSummary = {
    brandId: brand.id,
    platform: adapter.platform,
    discovered: refs.length,
    processed: 0,
    created: 0,
    updated: 0,
    errors: [],
    status: state.status,
    runId: state.runId,
    pending: 0,
    failed: 0,
    total: refs.length,
  };

  let processedThisBatch = 0;
  let cursor = state.cursor ?? 0;
  let iterations = 0;

  const shouldStopForTime = () => Date.now() - startTime > maxRuntimeMs;

  const shouldAbortExternally = async () => {
    const latest = await prisma.brand.findUnique({
      where: { id: brand.id },
      select: { metadata: true },
    });
    if (!latest) return false;
    const latestState = readCatalogRunState(getBrandMetadata(latest));
    if (!latestState) {
      summary.status = "stopped";
      return true;
    }
    if (latestState.status === "paused" || latestState.status === "stopped") {
      state.status = latestState.status;
      state.updatedAt = new Date().toISOString();
      await persistRunState(brand.id, metadata, state);
      summary.status = state.status;
      return true;
    }
    return false;
  };

  while (processedThisBatch < batchSize && iterations < refs.length * 2) {
    if (await shouldAbortExternally()) break;
    if (shouldStopForTime()) {
      state.status = "paused";
      state.updatedAt = new Date().toISOString();
      state.lastError = "time_budget_exceeded";
      await persistRunState(brand.id, metadata, state);
      summary.status = state.status;
      break;
    }

    if (!refs.length) break;
    const ref = refs[cursor % refs.length];
    cursor = (cursor + 1) % refs.length;
    iterations += 1;
    const itemState = state.items[ref.url] ?? { status: "pending", attempts: 0 };
    if (itemState.status === "completed") continue;
    if (itemState.attempts >= MAX_ATTEMPTS) continue;

    try {
      state.items[ref.url] = {
        ...itemState,
        status: "in_progress",
        updatedAt: new Date().toISOString(),
      };
      await persistRunState(brand.id, metadata, state);

      const raw = await adapter.fetchProduct(ctx, ref);
      if (!raw) {
        throw new Error("No se pudo obtener producto (raw vacío)");
      }

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
      if (!blobImages.length) {
        throw new Error("Blob upload produjo 0 imágenes");
      }
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
        const priceValue = toNumber(rawVariant.price) ?? toNumber(normalizedVariant?.price) ?? 0;
        const currencyValue = guessCurrency(
          priceValue,
          rawVariant.currency ?? normalizedVariant?.currency ?? raw.currency ?? null,
        );
        const variantPayload = {
          sku,
          color,
          size,
          fit: normalizedVariant?.fit ?? null,
          material: normalizedVariant?.material ?? null,
          price: priceValue,
          currency: currencyValue ?? "COP",
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

      state.items[ref.url] = {
        status: "completed",
        attempts: itemState.attempts + 1,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      state.updatedAt = new Date().toISOString();
      await persistRunState(brand.id, metadata, state);
      processedThisBatch += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push({
        url: ref.url,
        error: message,
      });
      state.items[ref.url] = {
        status: "failed",
        attempts: itemState.attempts + 1,
        lastError: message,
        updatedAt: new Date().toISOString(),
      };
      state.updatedAt = new Date().toISOString();
      state.lastError = message;
      if (isBlobTokenError(message)) {
        state.status = "blocked";
        state.blockReason = message;
        await persistRunState(brand.id, metadata, state);
        summary.status = state.status;
        break;
      }
      await persistRunState(brand.id, metadata, state);
      processedThisBatch += 1;
    }
  }

  const itemStates = Object.values(state.items ?? {});
  const completedCount = itemStates.filter((item) => item.status === "completed").length;
  const failedCount = itemStates.filter((item) => item.status === "failed").length;
  const pendingCount = Math.max(0, refs.length - completedCount - failedCount);
  const remainingEligible = refs.filter((ref) => {
    const entry = state.items[ref.url];
    if (!entry) return true;
    if (entry.status === "completed") return false;
    return entry.attempts < MAX_ATTEMPTS;
  }).length;

  state.cursor = cursor;
  if (summary.status === "stopped") {
    summary.lastError = state.lastError ?? null;
    summary.blockReason = state.blockReason ?? null;
    summary.pending = pendingCount;
    summary.failed = failedCount;
    return summary;
  }
  if (completedCount === refs.length && refs.length > 0) {
    state.status = "completed";
  } else if (state.status !== "blocked" && state.status !== "paused") {
    state.status = remainingEligible === 0 ? "paused" : "processing";
  }
  state.updatedAt = new Date().toISOString();
  await persistRunState(brand.id, metadata, state);

  summary.status = state.status;
  summary.lastError = state.lastError ?? null;
  summary.blockReason = state.blockReason ?? null;
  summary.pending = pendingCount;
  summary.failed = failedCount;

  return summary;
};
