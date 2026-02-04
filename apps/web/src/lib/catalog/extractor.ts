import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdapterContext, ExtractSummary, ProductRef, RawProduct, RawVariant } from "@/lib/catalog/types";
import { getCatalogAdapter } from "@/lib/catalog/registry";
import { normalizeCatalogProduct } from "@/lib/catalog/normalizer";
import { uploadImagesToBlob } from "@/lib/catalog/blob";
import { inferCatalogPlatform } from "@/lib/catalog/platform-detect";
import { classifyPdpWithOpenAI, extractHtmlSignals, extractRawProductWithOpenAI } from "@/lib/catalog/llm-pdp";
import {
  CATALOG_MAX_ATTEMPTS,
  getCatalogConsecutiveErrorLimit,
  isCatalogSoftError,
} from "@/lib/catalog/constants";
import {
  discoverFromSitemap,
  fetchText,
  guessCurrency,
  isLikelyProductUrl,
  normalizeImageUrls,
  normalizeSize,
  normalizeUrl,
  parsePriceValue,
  pickOption,
  safeOrigin,
} from "@/lib/catalog/utils";

const toNumber = (value: unknown) => parsePriceValue(value);
const chooseString = (
  existing: string | null | undefined,
  next: string | null | undefined,
  preserve: boolean,
) => {
  if (preserve && existing) return existing;
  return next ?? existing ?? null;
};

const chooseArray = (
  existing: string[] | null | undefined,
  next: string[] | null | undefined,
  preserve: boolean,
) => {
  if (preserve && Array.isArray(existing) && existing.length) return existing;
  if (Array.isArray(next) && next.length) return next;
  return Array.isArray(existing) ? existing : [];
};

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
  lastUrl?: string | null;
  lastStage?: string | null;
  consecutiveErrors?: number;
  errorSamples?: Array<{ url: string; error: string; at: string; stage?: string | null }>;
};

const CATALOG_STATE_KEY = "catalog_extract";
const PDP_LLM_ENABLED = process.env.CATALOG_PDP_LLM_ENABLED !== "false";
const CONSECUTIVE_ERROR_LIMIT = getCatalogConsecutiveErrorLimit();
const AUTO_PAUSE_ON_ERRORS = process.env.CATALOG_AUTO_PAUSE_ON_ERRORS === "true";
const PDP_LLM_MIN_CONFIDENCE = Math.max(
  0.1,
  Math.min(0.99, Number(process.env.CATALOG_PDP_LLM_CONFIDENCE_MIN ?? 0.55)),
);
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

const syncRunStateItems = (
  refs: CatalogRunState["refs"],
  items: CatalogRunState["items"] | undefined,
  now: string,
) => {
  const nextItems: CatalogRunState["items"] = { ...(items ?? {}) };
  const refSet = new Set(refs.map((ref) => ref.url));
  refs.forEach((ref) => {
    if (!nextItems[ref.url]) {
      nextItems[ref.url] = { status: "pending", attempts: 0, updatedAt: now };
    }
  });
  Object.keys(nextItems).forEach((url) => {
    if (!refSet.has(url)) delete nextItems[url];
  });
  return nextItems;
};

const findNextEligibleCursor = (
  refs: CatalogRunState["refs"],
  items: CatalogRunState["items"],
  startCursor: number,
) => {
  if (!refs.length) return 0;
  let cursor = startCursor % refs.length;
  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[cursor];
    const entry = items[ref.url];
    if (!entry || (entry.status !== "completed" && entry.attempts < CATALOG_MAX_ATTEMPTS)) {
      return cursor;
    }
    cursor = (cursor + 1) % refs.length;
  }
  return startCursor % refs.length;
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
    lastUrl: state.lastUrl ?? null,
    lastStage: state.lastStage ?? null,
    consecutiveErrors: state.consecutiveErrors ?? 0,
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

const pushErrorSample = (
  state: CatalogRunState,
  url: string,
  error: string,
  stage?: string | null,
) => {
  const samples = Array.isArray(state.errorSamples) ? [...state.errorSamples] : [];
  samples.push({ url, error, at: new Date().toISOString(), stage: stage ?? null });
  state.errorSamples = samples.slice(-10);
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
  const state = readCatalogRunState(metadata);
  if (!state) return true;
  const nextState: CatalogRunState = {
    ...state,
    status: "stopped",
    updatedAt: new Date().toISOString(),
  };
  await persistRunState(brand.id, metadata, nextState);
  return true;
};

const discoverRefsFromSitemap = async (siteUrl: string, limit: number) => {
  const normalized = normalizeUrl(siteUrl);
  if (!normalized) return [];
  const urls = await discoverFromSitemap(normalized, limit, { productAware: true });
  if (!urls.length) return [];
  const origin = safeOrigin(normalized);
  const filtered = urls.filter((url) => {
    if (!isLikelyProductUrl(url)) return false;
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  });
  if (!filtered.length) return [];
  return filtered.map((url) => ({ url }));
};

const buildVariantSku = (variant: RawVariant, fallback: string) => {
  if (variant.sku && variant.sku.trim()) return variant.sku.trim();
  if (variant.id && String(variant.id).trim()) return String(variant.id).trim();
  return fallback;
};

const toStringOrNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return null;
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

export const processCatalogRef = async ({
  brand,
  adapter,
  ctx,
  ref,
  canUseLlmPdp,
  onStage,
}: {
  brand: { id: string; slug: string };
  adapter: ReturnType<typeof getCatalogAdapter>;
  ctx: AdapterContext;
  ref: { url: string };
  canUseLlmPdp: boolean;
  onStage?: (stage: string) => void;
}) => {
  onStage?.("fetch");
  let raw = await adapter.fetchProduct(ctx, ref);
  if (!raw && canUseLlmPdp) {
    onStage?.("llm_classify");
    const htmlResponse = await fetchText(ref.url, { method: "GET" }, 15000);
    if (htmlResponse.status >= 400 || !htmlResponse.text) {
      throw new Error(`No se pudo obtener HTML (${htmlResponse.status}) para ${ref.url}`);
    }
    const signals = extractHtmlSignals(htmlResponse.text, htmlResponse.finalUrl ?? ref.url);
    const decision = await classifyPdpWithOpenAI({
      url: ref.url,
      html: htmlResponse.text,
      text: signals.text,
      images: signals.images,
    });
    if (!decision.is_pdp || decision.confidence < PDP_LLM_MIN_CONFIDENCE) {
      throw new Error(`llm_pdp_false:${decision.confidence.toFixed(2)}:${decision.reason}`);
    }
    onStage?.("llm_extract");
    const extracted = await extractRawProductWithOpenAI({
      url: ref.url,
      html: htmlResponse.text,
      text: signals.text,
      images: signals.images,
    });
    const fallbackImages = extracted.images?.length ? extracted.images : signals.images;
    const sanitizedVariants = extracted.variants.map((variant) => ({
      ...variant,
      options: variant.options ?? undefined,
      images: variant.images ?? [],
    }));
    raw = {
      ...extracted,
      sourceUrl: ref.url,
      images: fallbackImages,
      variants: sanitizedVariants,
      metadata: {
        ...(extracted.metadata ?? {}),
        platform: "custom",
        llm: {
          pdp: decision,
          extracted_at: new Date().toISOString(),
        },
      },
    };
  }
  if (!raw) {
    throw new Error(`No se pudo obtener producto (${adapter.platform}) para ${ref.url}`);
  }

  onStage?.("normalize_images");
  raw.externalId = toStringOrNull(raw.externalId);
  raw.variants = raw.variants.map((variant) => ({
    ...variant,
    id: toStringOrNull(variant.id),
    sku: toStringOrNull(variant.sku),
    options: variant.options
      ? Object.fromEntries(
          Object.entries(variant.options).map(([key, value]) => [
            key,
            value === null || value === undefined ? "" : String(value),
          ]),
        )
      : variant.options,
  }));
  const normalizedProductImages = normalizeImageUrls(raw.images);
  const normalizedVariants = raw.variants.map((variant) => {
    const variantImages = normalizeImageUrls([variant.image, ...(variant.images ?? [])]);
    return {
      ...variant,
      image: variantImages[0] ?? null,
      images: variantImages,
    };
  });
  raw.images = normalizedProductImages;
  raw.variants = normalizedVariants;

  const allImages = Array.from(
    new Set([
      ...normalizedProductImages,
      ...normalizedVariants.flatMap((variant) => [variant.image ?? "", ...(variant.images ?? [])]),
    ].filter(Boolean)),
  );
  const imagePrefix = `catalog/${brand.slug}/${raw.externalId ?? "product"}`;
  onStage?.("blob_upload");
  let imageMapping = new Map<string, { url: string }>();
  let blobFailure: string | null = null;
  try {
    imageMapping = await uploadImagesToBlob(allImages, imagePrefix);
  } catch (error) {
    blobFailure = error instanceof Error ? error.message : String(error);
    imageMapping = new Map();
  }
  const blobImages = raw.images
    .map((url) => imageMapping.get(url)?.url)
    .filter(Boolean) as string[];
  const fallbackImages = blobImages.length ? blobImages : raw.images;
  if (!fallbackImages.length) {
    throw new Error("No hay imágenes disponibles tras upload");
  }
  if (blobFailure) {
    raw.metadata = { ...(raw.metadata ?? {}), blob_upload_failed: blobFailure };
  }
  const coverImage = fallbackImages[0] ?? null;

  onStage?.("normalize");
  const normalized = await normalizeCatalogProduct(
    {
    ...raw,
    images: fallbackImages,
    },
    adapter.platform,
  );

  onStage?.("upsert");
  const { product, created } = await upsertProduct(brand.id, raw, normalized, coverImage);

  const variantFallbackImages = fallbackImages;
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
    const variantImages = buildVariantImages(rawVariant, imageMapping, variantFallbackImages);
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

  return { created, createdVariants };
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
        include: {
          enrichmentItems: { where: { status: "completed" }, select: { id: true } },
        },
      })
    : null;

  const samplePrice = toNumber(raw.variants?.[0]?.price ?? normalized?.variants?.[0]?.price ?? null);
  const currencyValue = guessCurrency(
    samplePrice,
    raw.currency ?? normalized?.variants?.[0]?.currency ?? raw.variants?.[0]?.currency ?? null,
  );

  const existingMetadata =
    existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};
  const normalizedMetadata =
    normalized?.metadata && typeof normalized.metadata === "object" && !Array.isArray(normalized.metadata)
      ? (normalized.metadata as Record<string, unknown>)
      : {};
  const hasCompletedEnrichment =
    Boolean(existingMetadata.enrichment) || Boolean(existing?.enrichmentItems && existing.enrichmentItems.length);
  const mergedMetadata: Record<string, unknown> = {
    ...existingMetadata,
    ...normalizedMetadata,
    platform: raw.metadata?.platform ?? existingMetadata.platform ?? null,
    llm: raw.metadata?.llm ?? existingMetadata.llm ?? null,
    extraction: {
      source_url: raw.sourceUrl,
      external_id: raw.externalId,
      scraped_at: new Date().toISOString(),
      source_images: raw.images ?? [],
    },
  };
  if (
    existingMetadata.enrichment !== undefined &&
    (normalizedMetadata.enrichment === undefined || normalizedMetadata.enrichment === null) &&
    (mergedMetadata.enrichment === undefined || mergedMetadata.enrichment === null)
  ) {
    mergedMetadata.enrichment = existingMetadata.enrichment;
  }

  const preserveEnrichment = hasCompletedEnrichment;
  const data = {
    brandId,
    externalId: raw.externalId ?? null,
    name: normalized.name ?? raw.title ?? existing?.name ?? "Sin nombre",
    description: chooseString(existing?.description, normalized.description ?? raw.description ?? null, preserveEnrichment),
    category: chooseString(existing?.category, normalized.category ?? null, preserveEnrichment),
    subcategory: chooseString(existing?.subcategory, normalized.subcategory ?? null, preserveEnrichment),
    styleTags: chooseArray(existing?.styleTags, normalized.style_tags ?? [], preserveEnrichment),
    materialTags: chooseArray(existing?.materialTags, normalized.material_tags ?? [], preserveEnrichment),
    patternTags: chooseArray(existing?.patternTags, normalized.pattern_tags ?? [], preserveEnrichment),
    occasionTags: chooseArray(existing?.occasionTags, normalized.occasion_tags ?? [], preserveEnrichment),
    gender: chooseString(existing?.gender, normalized.gender ?? null, preserveEnrichment),
    season: chooseString(existing?.season, normalized.season ?? null, preserveEnrichment),
    care: chooseString(existing?.care, normalized.care ?? null, preserveEnrichment),
    origin: chooseString(existing?.origin, normalized.origin ?? null, preserveEnrichment),
    status: chooseString(existing?.status, normalized.status ?? null, false),
    currency: currencyValue ?? null,
    sourceUrl: raw.sourceUrl ?? null,
    imageCoverUrl: imageCoverUrl ?? existing?.imageCoverUrl ?? null,
    metadata: mergedMetadata as Prisma.InputJsonValue,
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

  const now = new Date();
  const existingPrice =
    existing?.price && typeof (existing.price as any)?.toNumber === "function"
      ? (existing.price as any).toNumber()
      : existing?.price ?? null;
  const nextPrice = variant.price ?? 0;
  const existingStock = existing?.stock ?? null;
  const nextStock = variant.stock ?? null;
  const existingStatus = existing?.stockStatus ?? null;
  const nextStatus = variant.stock_status ?? null;
  const priceChanged = existing ? existingPrice !== nextPrice : true;
  const stockChanged = existing ? existingStock !== nextStock : true;
  const stockStatusChanged = existing ? existingStatus !== nextStatus : true;

  const existingMetadata =
    existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};
  const hasVariantEnrichment =
    existingMetadata.enrichment && typeof existingMetadata.enrichment === "object" && !Array.isArray(existingMetadata.enrichment);
  const changeMetadata: Record<string, unknown> = {};
  if (priceChanged) changeMetadata.last_price_changed_at = now.toISOString();
  if (stockChanged) changeMetadata.last_stock_changed_at = now.toISOString();
  if (stockStatusChanged) {
    changeMetadata.last_stock_status_changed_at = now.toISOString();
    changeMetadata.last_stock_status_change = existingStatus
      ? `${existingStatus}=>${nextStatus ?? "unknown"}`
      : `unknown=>${nextStatus ?? "unknown"}`;
  }

  const data = {
    productId,
    sku,
    color: chooseString(existing?.color, variant.color ?? null, Boolean(hasVariantEnrichment)),
    size: chooseString(existing?.size, variant.size ?? null, false),
    fit: chooseString(existing?.fit, variant.fit ?? null, Boolean(hasVariantEnrichment)),
    material: chooseString(existing?.material, variant.material ?? null, Boolean(hasVariantEnrichment)),
    price: variant.price ?? 0,
    currency: variant.currency ?? "COP",
    stock: variant.stock ?? null,
    stockStatus: variant.stock_status ?? null,
    images: variant.images ?? [],
    metadata: {
      ...existingMetadata,
      ...(variant.metadata ?? {}),
      ...changeMetadata,
    },
  };

  if (existing) {
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.variant.update({ where: { id: existing.id }, data });
      if (priceChanged) {
        await tx.priceHistory.create({
          data: {
            variantId: existing.id,
            price: data.price,
            currency: data.currency ?? "COP",
          },
        });
      }
      if (stockChanged) {
        await tx.stockHistory.create({
          data: {
            variantId: existing.id,
            stock: data.stock ?? null,
          },
        });
      }
      return next;
    });
    return { variant: updated, created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.variant.create({ data });
    await tx.priceHistory.create({
      data: {
        variantId: next.id,
        price: data.price,
        currency: data.currency ?? "COP",
      },
    });
    await tx.stockHistory.create({
      data: {
        variantId: next.id,
        stock: data.stock ?? null,
      },
    });
    return next;
  });
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

  const metadata = getBrandMetadata(brand);
  const existingState = readCatalogRunState(metadata);
  const storedInference =
    metadata.catalog_extract_inferred_platform &&
    typeof metadata.catalog_extract_inferred_platform === "object" &&
    !Array.isArray(metadata.catalog_extract_inferred_platform)
      ? (metadata.catalog_extract_inferred_platform as Record<string, unknown>)
      : null;

  let platformForRun = brand.ecommercePlatform ?? null;
  if (
    (!platformForRun || platformForRun.toLowerCase() === "unknown") &&
    storedInference?.platform &&
    typeof storedInference.platform === "string"
  ) {
    platformForRun = storedInference.platform;
  }

  let inferredPlatform: { platform: string; confidence: number; evidence: string[] } | null = null;
  if (
    (!existingState || !existingState.refs?.length) &&
    (!platformForRun || platformForRun.toLowerCase() === "unknown")
  ) {
    inferredPlatform = await inferCatalogPlatform(brand.siteUrl);
    if (inferredPlatform?.platform) {
      platformForRun = inferredPlatform.platform;
    }
  }

  const adapter = getCatalogAdapter(platformForRun);
  const ctx: AdapterContext = {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: platformForRun ?? brand.ecommercePlatform,
    },
  };
  const canUseLlmPdp =
    PDP_LLM_ENABLED &&
    (adapter.platform === "custom" || (platformForRun ?? "").toLowerCase() === "unknown");

  const metadataForRun =
    inferredPlatform?.platform && inferredPlatform.confidence >= 0.6
      ? {
          ...metadata,
          catalog_extract_inferred_platform: {
            platform: inferredPlatform.platform,
            confidence: inferredPlatform.confidence,
            evidence: inferredPlatform.evidence.slice(0, 5),
            detectedAt: new Date().toISOString(),
          },
        }
      : metadata;

  const batchSize = Math.max(1, Math.min(limit, 200));
  const rawDiscoveryLimit = Number(process.env.CATALOG_EXTRACT_DISCOVERY_LIMIT ?? NaN);
  const discoveryBase =
    Number.isFinite(rawDiscoveryLimit) && rawDiscoveryLimit > 0
      ? rawDiscoveryLimit
      : batchSize * 5;
  const discoveryLimit = Math.max(batchSize, discoveryBase);
  const rawSitemapLimit = Number(process.env.CATALOG_EXTRACT_SITEMAP_LIMIT ?? 5000);
  const normalizedSitemapLimit = Number.isFinite(rawSitemapLimit) ? rawSitemapLimit : 5000;
  const isVtex = adapter.platform === "vtex";
  const sitemapLimit = isVtex
    ? 0
    : normalizedSitemapLimit <= 0
      ? 0
      : Math.max(discoveryLimit, normalizedSitemapLimit);
  const startTime = Date.now();
  const maxRuntimeMs = Math.max(
    30000,
    Number(process.env.CATALOG_EXTRACT_MAX_RUNTIME_MS ?? 240000),
  );

  let state: CatalogRunState;
  let refs: CatalogRunState["refs"] = [];

  if (existingState && existingState.status !== "completed" && existingState.refs?.length) {
    const now = new Date().toISOString();
    const syncedItems = syncRunStateItems(existingState.refs, existingState.items, now);
    const nextCursor = findNextEligibleCursor(existingState.refs, syncedItems, existingState.cursor ?? 0);
    state = {
      ...existingState,
      status:
        existingState.status === "paused" || existingState.status === "stopped"
          ? "processing"
          : existingState.status,
      batchSize,
      items: syncedItems,
      cursor: nextCursor,
      consecutiveErrors: existingState.consecutiveErrors ?? 0,
      errorSamples: existingState.errorSamples ?? [],
      updatedAt: now,
    };
    refs = state.refs;
    await persistRunState(brand.id, metadataForRun, state);
  } else {
    const trySitemap =
      options.forceSitemap || process.env.CATALOG_TRY_SITEMAP_FIRST !== "false";
    let sitemapRefs: ProductRef[] = [];
    if (trySitemap) {
      try {
        sitemapRefs = await discoverRefsFromSitemap(brand.siteUrl, sitemapLimit);
      } catch (error) {
        console.warn("catalog: sitemap discovery failed", {
          siteUrl: brand.siteUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        sitemapRefs = [];
      }
    }
    refs = sitemapRefs.length
      ? sitemapRefs
      : await adapter.discoverProducts(ctx, discoveryLimit);
    if (!refs.length && canUseLlmPdp) {
      const broadUrls = await discoverFromSitemap(brand.siteUrl, discoveryLimit, {
        productAware: false,
      });
      const origin = safeOrigin(normalizeUrl(brand.siteUrl) ?? brand.siteUrl);
      refs = broadUrls
        .filter((url) => {
          try {
            return new URL(url).origin === origin;
          } catch {
            return false;
          }
        })
        .slice(0, discoveryLimit)
        .map((url) => ({ url }));
    }

    const now = new Date().toISOString();
    const hasRefs = refs.length > 0;
    if (!hasRefs) {
      const reason =
        adapter.platform === "vtex"
          ? "manual_review_vtex_no_products"
          : "manual_review_no_products";
      state = {
        runId: crypto.randomUUID(),
        status: "blocked",
        cursor: 0,
        batchSize,
        refs: [],
        items: {},
        startedAt: now,
        updatedAt: now,
        lastError: reason,
        blockReason: reason,
        consecutiveErrors: 0,
        errorSamples: [],
      };
      const nextMetadata = {
        ...metadataForRun,
        [CATALOG_STATE_KEY]: state,
        catalog_extract_review: {
          reason,
          detectedAt: now,
          platform: adapter.platform,
          siteUrl: brand.siteUrl,
        },
      };
      await prisma.brand.update({
        where: { id: brand.id },
        data: {
          metadata: nextMetadata as Prisma.InputJsonValue,
          manualReview: true,
        },
      });
    } else {
      state = {
        runId: crypto.randomUUID(),
        status: "processing",
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
        lastError: null,
        consecutiveErrors: 0,
        errorSamples: [],
      };
      await persistRunState(brand.id, metadataForRun, state);
    }
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
    lastUrl: state.lastUrl ?? null,
    lastStage: state.lastStage ?? null,
    consecutiveErrors: state.consecutiveErrors ?? 0,
  };

  if (state.status === "blocked") {
    summary.status = state.status;
    summary.lastError = state.lastError ?? null;
    summary.blockReason = state.blockReason ?? null;
    summary.lastUrl = state.lastUrl ?? null;
    summary.lastStage = state.lastStage ?? null;
    summary.consecutiveErrors = state.consecutiveErrors ?? 0;
    summary.pending = 0;
    summary.failed = 0;
    return summary;
  }

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
      await persistRunState(brand.id, metadataForRun, state);
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
      await persistRunState(brand.id, metadataForRun, state);
      summary.status = state.status;
      break;
    }

    if (!refs.length) break;
    const ref = refs[cursor % refs.length];
    cursor = (cursor + 1) % refs.length;
    iterations += 1;
    const itemState = state.items[ref.url] ?? { status: "pending", attempts: 0 };
    if (itemState.status === "completed") continue;
    if (itemState.attempts >= CATALOG_MAX_ATTEMPTS) continue;

    try {
      state.lastUrl = ref.url;
      state.lastStage = "fetch";
      state.items[ref.url] = {
        ...itemState,
        status: "in_progress",
        updatedAt: new Date().toISOString(),
      };
      await persistRunState(brand.id, metadata, state);

      const { created, createdVariants } = await processCatalogRef({
        brand: { id: brand.id, slug: brand.slug },
        adapter,
        ctx,
        ref,
        canUseLlmPdp,
        onStage: (stage) => {
          state.lastStage = stage;
        },
      });

      summary.processed += 1;
      if (created) summary.created += 1;
      if (!created && createdVariants === 0) summary.updated += 1;

      state.items[ref.url] = {
        status: "completed",
        attempts: itemState.attempts + 1,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      state.lastStage = "completed";
      state.lastUrl = ref.url;
      state.consecutiveErrors = 0;
      state.updatedAt = new Date().toISOString();
      await persistRunState(brand.id, metadata, state);
      processedThisBatch += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSoftError = isCatalogSoftError(message);
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
      state.lastUrl = ref.url;
      state.lastStage = "error";
      state.consecutiveErrors = isSoftError ? 0 : (state.consecutiveErrors ?? 0) + 1;
      pushErrorSample(state, ref.url, message, state.lastStage);
      if (isBlobTokenError(message)) {
        state.status = "blocked";
        state.blockReason = message;
        await persistRunState(brand.id, metadataForRun, state);
        summary.status = state.status;
        break;
      }
      if (AUTO_PAUSE_ON_ERRORS && state.consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
        state.status = "paused";
        state.blockReason = `consecutive_errors:${state.consecutiveErrors}`;
        await persistRunState(brand.id, metadataForRun, state);
        summary.status = state.status;
        summary.blockReason = state.blockReason ?? null;
        break;
      }
      await persistRunState(brand.id, metadataForRun, state);
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
    return entry.attempts < CATALOG_MAX_ATTEMPTS;
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
  await persistRunState(brand.id, metadataForRun, state);

  summary.status = state.status;
  summary.lastError = state.lastError ?? null;
  summary.blockReason = state.blockReason ?? null;
  summary.lastUrl = state.lastUrl ?? null;
  summary.lastStage = state.lastStage ?? null;
  summary.consecutiveErrors = state.consecutiveErrors ?? 0;
  summary.pending = pendingCount;
  summary.failed = failedCount;

  return summary;
};
