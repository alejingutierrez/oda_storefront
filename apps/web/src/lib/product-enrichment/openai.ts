import { z } from "zod";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  CATEGORY_OPTIONS,
  CATEGORY_VALUES,
  FIT_OPTIONS,
  GENDER_OPTIONS,
  MATERIAL_TAGS,
  OCCASION_TAGS,
  PATTERN_TAGS,
  SEASON_OPTIONS,
  STYLE_TAGS,
  SUBCATEGORY_BY_CATEGORY,
  SUBCATEGORY_VALUES,
} from "@/lib/product-enrichment/constants";
import {
  normalizeEnumArray,
  normalizeEnumValue,
  normalizeHexColor,
  normalizePantoneCode,
  chunkArray,
  slugify,
} from "@/lib/product-enrichment/utils";

const BEDROCK_MODEL_ID =
  process.env.BEDROCK_INFERENCE_PROFILE_ID ??
  process.env.PRODUCT_ENRICHMENT_MODEL ??
  "";
const MAX_RETRIES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_RETRIES ?? 3));
const MAX_IMAGES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_IMAGES ?? 8));
const MAX_TOKENS = Math.max(256, Number(process.env.PRODUCT_ENRICHMENT_MAX_TOKENS ?? 1200));
const VARIANT_CHUNK_SIZE = Math.max(
  1,
  Number(process.env.PRODUCT_ENRICHMENT_VARIANT_CHUNK_SIZE ?? 8),
);
const INCLUDE_IMAGES = process.env.PRODUCT_ENRICHMENT_BEDROCK_INCLUDE_IMAGES === "true";
const IMAGE_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.PRODUCT_ENRICHMENT_BEDROCK_IMAGE_TIMEOUT_MS ?? 5000),
);
const IMAGE_MAX_BYTES = Math.max(
  50_000,
  Number(process.env.PRODUCT_ENRICHMENT_BEDROCK_IMAGE_MAX_BYTES ?? 1_000_000),
);
const REPAIR_MAX_CHARS = Math.max(
  4000,
  Number(process.env.PRODUCT_ENRICHMENT_REPAIR_MAX_CHARS ?? 12000),
);

const colorField = z.union([z.string(), z.array(z.string()).min(1).max(3)]);

const variantSchema = z.object({
  variant_id: z.string(),
  sku: z.string().nullable().optional(),
  color_hex: colorField,
  color_pantone: colorField,
  fit: z.string(),
});

const productSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  style_tags: z.array(z.string()).min(10).max(10),
  material_tags: z.array(z.string()).max(3).default([]),
  pattern_tags: z.array(z.string()).max(2).default([]),
  occasion_tags: z.array(z.string()).max(2).default([]),
  gender: z.string(),
  season: z.string(),
  seo_title: z.string().optional().default(""),
  seo_description: z.string().optional().default(""),
  seo_tags: z.array(z.string()).optional().default([]),
  variants: z.array(variantSchema).min(1),
});

const enrichmentResponseSchema = z.object({
  product: productSchema,
});

export type RawEnrichedVariant = {
  variantId: string;
  sku?: string | null;
  colorHex: string | string[];
  colorPantone: string | string[];
  fit: string;
};

export type RawEnrichedProduct = {
  category: string;
  subcategory: string;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  gender: string;
  season: string;
  seoTitle: string;
  seoDescription: string;
  seoTags: string[];
  variants: RawEnrichedVariant[];
};

export type EnrichedVariant = {
  variantId: string;
  sku?: string | null;
  colorHex: string;
  colorPantone: string;
  colorHexes: string[];
  colorPantones: string[];
  fit: string;
};

export type EnrichedProduct = {
  category: string;
  subcategory: string;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  gender: string;
  season: string;
  seoTitle: string;
  seoDescription: string;
  seoTags: string[];
  variants: EnrichedVariant[];
};

type BedrockResponse = {
  content?: Array<{ type?: string; text?: string }>;
  completion?: string;
  output_text?: string;
};

type BedrockImageInput = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};

let bedrockClient: BedrockRuntimeClient | null = null;

const getBedrockClient = () => {
  if (bedrockClient) return bedrockClient;
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  bedrockClient = new BedrockRuntimeClient({ region });
  return bedrockClient;
};

const extractBedrockText = (payload: BedrockResponse | null | undefined) => {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (typeof payload?.completion === "string") return payload.completion;
  if (Array.isArray(payload?.content)) {
    const text = payload.content.map((entry) => entry?.text).find(Boolean);
    if (text) return text;
  }
  return "";
};

const trimForRepair = (value: string) => {
  if (value.length <= REPAIR_MAX_CHARS) return value;
  return value.slice(0, REPAIR_MAX_CHARS);
};

const readBedrockBody = async (body: unknown) => {
  if (!body) return "";
  const maybe = body as { transformToString?: () => Promise<string> };
  if (typeof maybe.transformToString === "function") {
    return maybe.transformToString();
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }
  if (typeof body === "string") return body;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
};

const invokeBedrock = async (params: {
  systemPrompt: string;
  userText: string;
  imageInputs: BedrockImageInput[];
}) => {
  const response = await getBedrockClient().send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: MAX_TOKENS,
        temperature: Number(process.env.PRODUCT_ENRICHMENT_TEMPERATURE ?? 0) || 0,
        system: params.systemPrompt,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: params.userText }, ...params.imageInputs],
          },
        ],
      }),
    }),
  );

  const rawBody = await readBedrockBody(response.body);
  if (!rawBody) throw new Error("Respuesta vacia de Bedrock");
  let raw = "";
  try {
    const payload = JSON.parse(rawBody) as BedrockResponse;
    raw = extractBedrockText(payload) || "";
  } catch {
    raw = rawBody;
  }
  if (!raw) throw new Error("Respuesta vacia de Bedrock");
  return raw;
};

const safeJsonParse = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        throw new Error("JSON parse failed");
      }
    }
    throw new Error("JSON parse failed");
  }
};

const buildCategoryPrompt = () =>
  CATEGORY_OPTIONS.map((entry) => {
    const subs = entry.subcategories.map((sub) => sub.value).join(", ");
    return `- ${entry.value}: [${subs}]`;
  }).join("\n");

const buildPrompt = () => {
  const categories = buildCategoryPrompt();
  return `Eres un clasificador de enriquecimiento de producto de moda colombiana.
Debes devolver SOLO JSON válido con el siguiente esquema:
{
  "product": {
    "category": "string",
    "subcategory": "string",
    "style_tags": ["string"],
    "material_tags": ["string"],
    "pattern_tags": ["string"],
    "occasion_tags": ["string"],
    "gender": "string",
    "season": "string",
    "seo_title": "string",
    "seo_description": "string",
    "seo_tags": ["string"],
    "variants": [
      {
        "variant_id": "string",
        "sku": "string|null",
        "color_hex": "#RRGGBB | [\"#RRGGBB\", \"#RRGGBB\"]",
        "color_pantone": "NN-NNNN | [\"NN-NNNN\", \"NN-NNNN\"]",
        "fit": "string"
      }
    ]
  }
}
Reglas estrictas:
- category, subcategory, gender, season y fit deben tener UN SOLO valor.
- style_tags deben ser EXACTAMENTE 10 elementos.
- material_tags máximo 3 elementos.
- pattern_tags máximo 2 elementos.
- occasion_tags máximo 2 elementos.
- seo_title debe ser conciso (<= 70 caracteres) y combinar nombre del producto + marca si existe.
- seo_description debe tener entre 120-160 caracteres, sin emojis, en español neutro.
- seo_tags debe tener entre 6-12 etiquetas, en español, sin duplicados.
- Usa SOLO los valores permitidos (en formato slug sin tildes ni espacios) para category/subcategory/style/material/pattern/occasion/gender/season/fit.
- seo_title, seo_description y seo_tags son libres (texto natural).
- No inventes variantes: devuelve un objeto por cada variant_id recibido.
- color_hex debe ser hexadecimal #RRGGBB. Puede ser string o array (1-3). Si hay varios colores, devuelve array con máximo 3 en orden de predominancia.
- color_pantone debe ser un código Pantone TCX NN-NNNN. Puede ser string o array (1-3). Si hay varios colores, devuelve array con máximo 3 en orden de predominancia.
- Si hay dudas sobre el género o es mixto, usa "no_binario_unisex".
- Si no estás seguro de subcategory, elige la subcategoría más general que pertenezca a la categoría; NUNCA uses "otro".
- Si no hay evidencia para completar style_tags, rellena hasta 10 usando tags neutrales de la lista permitida (no inventes).
Reglas de evidencia y consistencia:
- Prioriza la señal de texto en este orden: product.name, product.description, metadata (og:title, og:description, jsonld, etc.).
- Si viene product.brand_name úsalo para enriquecer seo_title y seo_description.
- Si el texto es claro sobre el tipo de prenda (ej: "top", "camisa", "blusa", "camiseta", "falda", "vestido", "pantalón", "jean", "short", "bikini"), ESA familia manda.
- Las imágenes solo ayudan a desambiguar detalles (fit, color, pattern), nunca para contradecir el texto.
- Si hay conflicto entre imagen y texto, gana el texto.
- No clasifiques como falda/pantalón/vestido si el texto indica explícitamente que es un top/camiseta/blusa (y viceversa).

Valores permitidos:
category -> subcategory
${categories}

style_tags:
${STYLE_TAGS.join(", ")}

material_tags:
${MATERIAL_TAGS.join(", ")}

pattern_tags:
${PATTERN_TAGS.join(", ")}

occasion_tags:
${OCCASION_TAGS.join(", ")}

gender:
${GENDER_OPTIONS.map((entry) => entry.value).join(", ")}

season:
${SEASON_OPTIONS.map((entry) => entry.value).join(", ")}

fit:
${FIT_OPTIONS.map((entry) => entry.value).join(", ")}

Si no hay suficiente evidencia para material/pattern/occasion, usa "otro" cuando esté disponible.`;
};

const buildRepairPrompt = (errorMessage: string) => {
  return `${buildPrompt()}

Tu salida anterior fue invalida y no cumple el esquema. Corrige el JSON respetando todas las reglas.
Devuelve SOLO JSON valido (sin markdown, sin texto extra).
Debes devolver EXACTAMENTE las variantes solicitadas en el mismo conteo.
Error detectado: ${errorMessage}`;
};

const clampText = (value: string, maxLength: number) => {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
};

const normalizeSeoTags = (tags: string[], fallback: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const output: string[] = [];
  const pushTag = (value: string | null | undefined) => {
    if (!value) return;
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const normalized = cleaned.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  };
  tags.forEach((tag) => pushTag(tag));
  fallback.forEach((tag) => pushTag(tag));
  return output.slice(0, 12);
};

const STYLE_TAGS_FALLBACK = [
  "estetica_minimalista",
  "estetica_normcore",
  "vibra_sobria",
  "vibra_relajada",
  "vibra_fresca",
  "vibra_ligera",
  "formalidad_casual",
  "formalidad_smart_casual",
  "contexto_fin_de_semana",
  "contexto_oficina",
];

const repairStyleTags = (tags: string[]) => {
  const unique = [...new Set(tags)];
  if (unique.length >= 10) return unique.slice(0, 10);
  const fallback = STYLE_TAGS_FALLBACK.filter((tag) => STYLE_TAGS.includes(tag));
  for (const tag of fallback) {
    if (unique.length >= 10) break;
    if (!unique.includes(tag)) unique.push(tag);
  }
  for (const tag of STYLE_TAGS) {
    if (unique.length >= 10) break;
    if (!unique.includes(tag)) unique.push(tag);
  }
  return unique.slice(0, 10);
};

const buildFallbackSeoTitle = (name: string, brand?: string | null) =>
  [name, brand].filter(Boolean).join(" | ");

const buildFallbackSeoDescription = (description?: string | null, name?: string | null) =>
  description?.trim() || name?.trim() || "";

const normalizeEnrichment = (
  input: RawEnrichedProduct,
  variantIds: Set<string>,
  variantIdList: string[],
  context: {
    productName: string;
    brandName?: string | null;
    description?: string | null;
    category?: string | null;
    subcategory?: string | null;
    gender?: string | null;
    season?: string | null;
  },
) => {
  if (input.variants.length !== variantIds.size) {
    throw new Error(
      `Variant count mismatch: expected ${variantIds.size}, got ${input.variants.length}`,
    );
  }
  const contextCategory = normalizeEnumValue(context.category ?? null, CATEGORY_VALUES);
  const category = normalizeEnumValue(input.category, CATEGORY_VALUES) ?? contextCategory;
  if (!category) throw new Error(`Invalid category: ${input.category}`);

  const allowedSubs = SUBCATEGORY_BY_CATEGORY[category] ?? [];
  const inputSubcategory = normalizeEnumValue(input.subcategory, SUBCATEGORY_VALUES);
  const contextSubcategory = normalizeEnumValue(context.subcategory ?? null, SUBCATEGORY_VALUES);
  let subcategory = inputSubcategory;
  if (!subcategory || !allowedSubs.includes(subcategory)) {
    if (contextSubcategory && allowedSubs.includes(contextSubcategory)) {
      subcategory = contextSubcategory;
    } else {
      subcategory = allowedSubs[0];
    }
  }
  if (!subcategory) throw new Error(`Invalid subcategory: ${input.subcategory}`);

  const styleTags = repairStyleTags(normalizeEnumArray(input.styleTags, STYLE_TAGS));
  if (styleTags.length !== 10) {
    throw new Error(`Invalid style_tags length: ${styleTags.length}`);
  }

  const materialTags = normalizeEnumArray(input.materialTags ?? [], MATERIAL_TAGS).slice(0, 3);
  const patternTags = normalizeEnumArray(input.patternTags ?? [], PATTERN_TAGS).slice(0, 2);
  const occasionTags = normalizeEnumArray(input.occasionTags ?? [], OCCASION_TAGS).slice(0, 2);

  const gender =
    normalizeEnumValue(input.gender, GENDER_OPTIONS.map((entry) => entry.value)) ??
    normalizeEnumValue(context.gender ?? null, GENDER_OPTIONS.map((entry) => entry.value)) ??
    "no_binario_unisex";
  if (!gender) throw new Error(`Invalid gender: ${input.gender}`);

  const season =
    normalizeEnumValue(input.season, SEASON_OPTIONS.map((entry) => entry.value)) ??
    normalizeEnumValue(context.season ?? null, SEASON_OPTIONS.map((entry) => entry.value)) ??
    SEASON_OPTIONS[0]?.value;
  if (!season) throw new Error(`Invalid season: ${input.season}`);

  const fitAllowed = FIT_OPTIONS.map((entry) => entry.value);
  const toArray = (value: string | string[]) => (Array.isArray(value) ? value : [value]);
  const normalizeColorList = (value: string | string[]) =>
    toArray(value)
      .map((entry) => normalizeHexColor(entry))
      .filter(Boolean)
      .slice(0, 3) as string[];
  const normalizePantoneList = (value: string | string[]) =>
    toArray(value)
      .map((entry) => normalizePantoneCode(entry))
      .filter(Boolean)
      .slice(0, 3) as string[];

  const seenVariantIds = new Set<string>();
  const outputValidIds = new Set(
    input.variants.map((variant) => variant.variantId).filter((id) => variantIds.has(id)),
  );
  const missingIds = variantIdList.filter((id) => !outputValidIds.has(id));
  const missingQueue = [...missingIds];

  const assignVariantId = (candidate: string, index: number) => {
    if (variantIds.has(candidate) && !seenVariantIds.has(candidate)) return candidate;
    while (missingQueue.length) {
      const next = missingQueue.shift();
      if (next && !seenVariantIds.has(next)) return next;
    }
    const fallback = variantIdList[index];
    if (fallback && !seenVariantIds.has(fallback)) return fallback;
    return candidate;
  };

  const variants = input.variants.map((variant, index) => {
    const variantId = assignVariantId(variant.variantId, index);
    if (!variantIds.has(variantId)) {
      throw new Error(`Unknown variant_id: ${variant.variantId}`);
    }
    if (seenVariantIds.has(variantId)) {
      throw new Error(`Duplicate variant_id: ${variant.variantId}`);
    }
    seenVariantIds.add(variantId);
    const colorHexes = normalizeColorList(variant.colorHex);
    if (!colorHexes.length) throw new Error(`Invalid color_hex: ${variant.colorHex}`);
    const colorPantones = normalizePantoneList(variant.colorPantone);
    const colorHex = colorHexes[0];
    const colorPantone = colorPantones[0] ?? "19-4042";
    const fit = normalizeEnumValue(variant.fit, fitAllowed) ?? "normal";
    if (!fit) throw new Error(`Invalid fit: ${variant.fit}`);
    return {
      ...variant,
      variantId,
      colorHex,
      colorPantone,
      colorHexes,
      colorPantones: colorPantones.length ? colorPantones : [colorPantone],
      fit,
    };
  });

  if (seenVariantIds.size !== variantIds.size) {
    throw new Error("Missing variants in enrichment output");
  }

  const fallbackTitle = buildFallbackSeoTitle(context.productName, context.brandName);
  const seoTitle = clampText(input.seoTitle || fallbackTitle, 70) || clampText(fallbackTitle, 70);
  const fallbackDescription = buildFallbackSeoDescription(context.description, context.productName);
  const seoDescription = clampText(
    input.seoDescription || fallbackDescription,
    160,
  );
  const seoTags = normalizeSeoTags(input.seoTags ?? [], [
    context.brandName,
    category,
    subcategory,
    ...styleTags,
    ...materialTags,
    ...patternTags,
    ...occasionTags,
  ]);

  return {
    category,
    subcategory,
    styleTags,
    materialTags,
    patternTags,
    occasionTags,
    gender,
    season,
    seoTitle,
    seoDescription,
    seoTags,
    variants,
  };
};

export async function enrichProductWithOpenAI(params: {
  product: {
    id: string;
    brandName?: string | null;
    name: string;
    description?: string | null;
    category?: string | null;
    subcategory?: string | null;
    styleTags?: string[];
    materialTags?: string[];
    patternTags?: string[];
    occasionTags?: string[];
    gender?: string | null;
    season?: string | null;
    care?: string | null;
    origin?: string | null;
    status?: string | null;
    sourceUrl?: string | null;
    imageCoverUrl?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  variants: Array<{
    id: string;
    sku?: string | null;
    color?: string | null;
    size?: string | null;
    fit?: string | null;
    material?: string | null;
    price?: number | null;
    currency?: string | null;
    stock?: number | null;
    stockStatus?: string | null;
    images?: string[] | null;
    metadata?: Record<string, unknown> | null;
  }>;
}): Promise<EnrichedProduct> {
  if (!BEDROCK_MODEL_ID) {
    throw new Error(
      "BEDROCK_INFERENCE_PROFILE_ID is required for product enrichment (Bedrock).",
    );
  }
  const systemPrompt = buildPrompt();
  let lastError: unknown = null;

  const variantIdList = params.variants.map((variant) => variant.id);
  const variantIds = new Set(variantIdList);
  const baseProductPayload = {
    product: {
      id: params.product.id,
      brand_name: params.product.brandName ?? null,
      name: params.product.name,
      description: params.product.description ?? null,
      category: params.product.category ?? null,
      subcategory: params.product.subcategory ?? null,
      styleTags: params.product.styleTags ?? [],
      materialTags: params.product.materialTags ?? [],
      patternTags: params.product.patternTags ?? [],
      occasionTags: params.product.occasionTags ?? [],
      gender: params.product.gender ?? null,
      season: params.product.season ?? null,
      care: params.product.care ?? null,
      origin: params.product.origin ?? null,
      status: params.product.status ?? null,
      sourceUrl: params.product.sourceUrl ?? null,
      imageCoverUrl: params.product.imageCoverUrl ?? null,
      metadata: params.product.metadata ?? null,
    },
  };

  const buildUserPayload = (variantsSubset: typeof params.variants) => {
    const imageManifest: Array<{ index: number; url: string; variantId?: string | null }> = [];
    const imageUrls: Array<{ url: string; variantId?: string | null }> = [];
    const seen = new Set<string>();

    const tryAddImage = (url: string | null | undefined, variantId?: string | null) => {
      if (!url || imageUrls.length >= MAX_IMAGES) return;
      const trimmed = url.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      imageUrls.push({ url: trimmed, variantId: variantId ?? null });
      imageManifest.push({ index: imageUrls.length, url: trimmed, variantId: variantId ?? null });
    };

    variantsSubset.forEach((variant) => {
      (variant.images ?? []).slice(0, 1).forEach((img) => tryAddImage(img, variant.id));
    });
    if (imageUrls.length < MAX_IMAGES && params.product.imageCoverUrl) {
      tryAddImage(params.product.imageCoverUrl, null);
    }

    return {
      userPayload: {
        ...baseProductPayload,
        variants: variantsSubset.map((variant) => ({
          id: variant.id,
          sku: variant.sku ?? null,
          color: variant.color ?? null,
          size: variant.size ?? null,
          fit: variant.fit ?? null,
          material: variant.material ?? null,
          price: variant.price ?? null,
          currency: variant.currency ?? null,
          stock: variant.stock ?? null,
          stockStatus: variant.stockStatus ?? null,
          images: (variant.images ?? []).slice(0, 1),
          metadata: variant.metadata ?? null,
        })),
        image_manifest: imageManifest.map((entry) => ({
          index: entry.index,
          url: entry.url,
          variant_id: entry.variantId ?? null,
        })),
      },
      imageUrls,
    };
  };

  const toBedrockImage = async (url: string): Promise<BedrockImageInput | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > IMAGE_MAX_BYTES) return null;
      const contentType = res.headers.get("content-type") ?? "";
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > IMAGE_MAX_BYTES) return null;
      const lowerUrl = url.toLowerCase();
      const mediaType =
        contentType.split(";")[0] ||
        (lowerUrl.endsWith(".png")
          ? "image/png"
          : lowerUrl.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg");
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: Buffer.from(buffer).toString("base64"),
        },
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const parseRawProduct = (raw: string) => {
    const parsed = safeJsonParse(raw);
    const validation = enrichmentResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`JSON validation failed: ${validation.error.message}`);
    }
    const product = validation.data.product;
    return {
      category: product.category,
      subcategory: product.subcategory,
      styleTags: product.style_tags,
      materialTags: product.material_tags ?? [],
      patternTags: product.pattern_tags ?? [],
      occasionTags: product.occasion_tags ?? [],
      gender: product.gender,
      season: product.season,
      seoTitle: product.seo_title ?? "",
      seoDescription: product.seo_description ?? "",
      seoTags: product.seo_tags ?? [],
      variants: product.variants.map((variant) => ({
        variantId: variant.variant_id,
        sku: variant.sku ?? null,
        colorHex: variant.color_hex,
        colorPantone: variant.color_pantone,
        fit: variant.fit,
      })),
    } satisfies RawEnrichedProduct;
  };

  const callBedrockForChunk = async (
    variantsSubset: typeof params.variants,
  ): Promise<RawEnrichedProduct> => {
    const { userPayload, imageUrls } = buildUserPayload(variantsSubset);
    const userText = JSON.stringify(userPayload, null, 2);
    const requiredVariantIds = variantsSubset.map((variant) => variant.id);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const imageInputs: BedrockImageInput[] = INCLUDE_IMAGES
          ? (
              await Promise.all(imageUrls.map((entry) => toBedrockImage(entry.url)))
            ).filter((entry): entry is BedrockImageInput => Boolean(entry))
          : [];

        const raw = await invokeBedrock({
          systemPrompt,
          userText,
          imageInputs,
        });

        try {
          return parseRawProduct(raw);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            !/JSON parse failed|JSON validation failed|Variant count mismatch|Unknown variant_id|Duplicate variant_id/i.test(
              message,
            )
          ) {
            throw error;
          }
          const repairPrompt = buildRepairPrompt(message);
          const repairText = [
            "Corrige el siguiente JSON para que cumpla el esquema:",
            "variant_ids requeridos (usa exactamente estos):",
            JSON.stringify(requiredVariantIds),
            trimForRepair(raw),
          ].join("\n\n");
          const repaired = await invokeBedrock({
            systemPrompt: repairPrompt,
            userText: repairText,
            imageInputs: [],
          });
          return parseRawProduct(repaired);
        }
      } catch (error) {
        lastError = error;
        const backoff = Math.pow(2, attempt) * 200;
        await new Promise((res) => setTimeout(res, backoff));
      }
    }

    throw new Error(`Bedrock chunk failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
  };

  const chunks =
    params.variants.length > VARIANT_CHUNK_SIZE
      ? chunkArray(params.variants, VARIANT_CHUNK_SIZE)
      : [params.variants];

  const aggregatedVariants: RawEnrichedVariant[] = [];
  let baseProduct: RawEnrichedProduct | null = null;

  for (const chunk of chunks) {
    const rawProduct = await callBedrockForChunk(chunk);
    if (!baseProduct) {
      baseProduct = rawProduct;
    }
    aggregatedVariants.push(...rawProduct.variants);
  }

  if (!baseProduct) {
    throw new Error("Bedrock enrichment failed: missing base product output.");
  }

  const merged: RawEnrichedProduct = {
    ...baseProduct,
    variants: aggregatedVariants,
  };

  return normalizeEnrichment(merged, variantIds, variantIdList, {
    productName: params.product.name,
    brandName: params.product.brandName ?? null,
    description: params.product.description ?? null,
    category: params.product.category ?? null,
    subcategory: params.product.subcategory ?? null,
    gender: params.product.gender ?? null,
    season: params.product.season ?? null,
  });

  throw new Error(
    `Bedrock enrichment failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

export const productEnrichmentPromptVersion = "v5";
export const productEnrichmentSchemaVersion = "v3";

export const toSlugLabel = (value: string) => slugify(value);
