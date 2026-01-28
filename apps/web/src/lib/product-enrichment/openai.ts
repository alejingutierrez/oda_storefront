import { z } from "zod";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getOpenAIClient } from "@/lib/openai";
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
  slugify,
} from "@/lib/product-enrichment/utils";

const PRODUCT_ENRICHMENT_PROVIDER = (
  process.env.PRODUCT_ENRICHMENT_PROVIDER ??
  (process.env.BEDROCK_INFERENCE_PROFILE_ID ? "bedrock" : "openai")
).toLowerCase();
const OPENAI_MODEL = process.env.PRODUCT_ENRICHMENT_MODEL ?? "gpt-5-mini";
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_INFERENCE_PROFILE_ID ?? process.env.BEDROCK_MODEL_ID ?? "";
const BEDROCK_REGION = process.env.AWS_REGION ?? "";
const BEDROCK_ACCESS_KEY =
  process.env.AWS_ACCESS_KEY_ID ?? process.env.BEDROCK_ACCESS_KEY ?? "";
const BEDROCK_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "";
const BEDROCK_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN ?? "";
const MAX_RETRIES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_RETRIES ?? 3));
const MAX_IMAGES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_IMAGES ?? 8));

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

export const productEnrichmentProvider = PRODUCT_ENRICHMENT_PROVIDER;
export const productEnrichmentModel =
  PRODUCT_ENRICHMENT_PROVIDER === "bedrock" ? BEDROCK_MODEL_ID : OPENAI_MODEL;

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

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

type OpenAIResponsesClient = {
  responses: {
    create: (input: Record<string, unknown>) => Promise<OpenAIResponse>;
  };
};

let bedrockClient: BedrockRuntimeClient | null = null;

const getBedrockClient = () => {
  if (bedrockClient) return bedrockClient;
  if (!BEDROCK_MODEL_ID) {
    throw new Error(
      "BEDROCK_INFERENCE_PROFILE_ID (or BEDROCK_MODEL_ID) is missing for product enrichment.",
    );
  }
  if (!BEDROCK_REGION) {
    throw new Error("AWS_REGION is missing for Bedrock product enrichment.");
  }
  const hasExplicitCreds = Boolean(BEDROCK_ACCESS_KEY && BEDROCK_SECRET_KEY);
  if (!hasExplicitCreds && !process.env.AWS_PROFILE) {
    throw new Error(
      "AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are missing for Bedrock product enrichment.",
    );
  }
  bedrockClient = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    ...(hasExplicitCreds
      ? {
          credentials: {
            accessKeyId: BEDROCK_ACCESS_KEY,
            secretAccessKey: BEDROCK_SECRET_KEY,
            ...(BEDROCK_SESSION_TOKEN ? { sessionToken: BEDROCK_SESSION_TOKEN } : {}),
          },
        }
      : {}),
  });
  return bedrockClient;
};

const extractOutputText = (response: OpenAIResponse | null | undefined) => {
  if (typeof response?.output_text === "string") return response.output_text;
  const message = Array.isArray(response?.output)
    ? response.output.find((item) => item.type === "message")
    : null;
  const content = message?.content?.find((item) => item.type === "output_text" || item.type === "text");
  return content?.text ?? "";
};

const extractBedrockText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return "";
  const content = Array.isArray((payload as any).content) ? (payload as any).content : [];
  const textParts = content
    .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
    .map((item: any) => item.text);
  return textParts.join("\n").trim();
};

const safeJsonParse = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("JSON parse failed");
  }
};

const buildRepairSystemPrompt = (basePrompt: string) =>
  `${basePrompt}\nIMPORTANTE: Estás corrigiendo una salida previa. Devuelve SOLO JSON válido y completo según el esquema. No agregues texto adicional.`;

const buildRepairUserText = (errorNote: string, raw: string) =>
  `Se detectó un error al validar la salida:\n${errorNote}\n\nCorrige la siguiente salida para que sea JSON válido y cumpla el esquema:\n${raw}`;

const fetchImageAsBase64 = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return null;
    const arrayBuffer = await res.arrayBuffer();
    const sizeMb = arrayBuffer.byteLength / (1024 * 1024);
    if (sizeMb > 4) return null;
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { mediaType, base64, sizeMb };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
- subcategory debe ser una de las subcategorías listadas para la categoría seleccionada; nunca uses "otro".
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

const buildFallbackSeoTitle = (name: string, brand?: string | null) =>
  [name, brand].filter(Boolean).join(" | ");

const buildFallbackSeoDescription = (description?: string | null, name?: string | null) =>
  description?.trim() || name?.trim() || "";

const normalizeEnrichment = (
  input: RawEnrichedProduct,
  variantIds: Set<string>,
  context: {
    productName: string;
    brandName?: string | null;
    description?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
) => {
  if (input.variants.length !== variantIds.size) {
    throw new Error(
      `Variant count mismatch: expected ${variantIds.size}, got ${input.variants.length}`,
    );
  }
  const category = normalizeEnumValue(input.category, CATEGORY_VALUES);
  if (!category) throw new Error(`Invalid category: ${input.category}`);

  const subcategory = normalizeEnumValue(input.subcategory, SUBCATEGORY_VALUES);
  if (!subcategory) throw new Error(`Invalid subcategory: ${input.subcategory}`);

  const allowedSubs = SUBCATEGORY_BY_CATEGORY[category] ?? [];
  if (!allowedSubs.includes(subcategory)) {
    throw new Error(`Subcategory ${subcategory} does not belong to ${category}`);
  }

  const styleTags = normalizeEnumArray(input.styleTags, STYLE_TAGS);
  let fixedStyleTags = styleTags;
  if (styleTags.length !== 10) {
    const seen = new Set(styleTags);
    const padded = [...styleTags];
    for (const tag of STYLE_TAGS) {
      if (padded.length >= 10) break;
      if (seen.has(tag)) continue;
      padded.push(tag);
      seen.add(tag);
    }
    fixedStyleTags = padded.slice(0, 10);
    console.warn("enrichment.style_tags.adjusted", {
      before: styleTags.length,
      after: fixedStyleTags.length,
    });
    if (fixedStyleTags.length !== 10) {
      throw new Error(`Invalid style_tags length: ${styleTags.length}`);
    }
  }

  const materialTags = normalizeEnumArray(input.materialTags ?? [], MATERIAL_TAGS).slice(0, 3);
  const patternTags = normalizeEnumArray(input.patternTags ?? [], PATTERN_TAGS).slice(0, 2);
  const occasionTags = normalizeEnumArray(input.occasionTags ?? [], OCCASION_TAGS).slice(0, 2);

  const gender = normalizeEnumValue(input.gender, GENDER_OPTIONS.map((entry) => entry.value));
  if (!gender) throw new Error(`Invalid gender: ${input.gender}`);

  const season = normalizeEnumValue(input.season, SEASON_OPTIONS.map((entry) => entry.value));
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
  const variants = input.variants.map((variant) => {
    const variantId = variant.variantId;
    if (!variantIds.has(variantId)) {
      throw new Error(`Unknown variant_id: ${variantId}`);
    }
    if (seenVariantIds.has(variantId)) {
      throw new Error(`Duplicate variant_id: ${variantId}`);
    }
    seenVariantIds.add(variantId);
    const colorHexes = normalizeColorList(variant.colorHex);
    if (!colorHexes.length) throw new Error(`Invalid color_hex: ${variant.colorHex}`);
    const colorPantones = normalizePantoneList(variant.colorPantone);
    const colorHex = colorHexes[0];
    const colorPantone = colorPantones[0] ?? "19-4042";
    const fit = normalizeEnumValue(variant.fit, fitAllowed);
    if (!fit) throw new Error(`Invalid fit: ${variant.fit}`);
    return {
      ...variant,
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
    ...fixedStyleTags,
    ...materialTags,
    ...patternTags,
    ...occasionTags,
  ]);

  return {
    category,
    subcategory,
    styleTags: fixedStyleTags,
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
  const systemPrompt = buildPrompt();
  const provider = PRODUCT_ENRICHMENT_PROVIDER;
  let lastError: unknown = null;

  const variantIds = new Set(params.variants.map((variant) => variant.id));
  const imageCandidates: Array<{ url: string; variantId?: string | null }> = [];
  const seen = new Set<string>();

  const tryAddImage = (url: string | null | undefined, variantId?: string | null) => {
    if (!url || imageCandidates.length >= MAX_IMAGES) return;
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    imageCandidates.push({ url: trimmed, variantId: variantId ?? null });
  };

  params.variants.forEach((variant) => {
    (variant.images ?? []).slice(0, 2).forEach((img) => tryAddImage(img, variant.id));
  });
  if (imageCandidates.length < MAX_IMAGES && params.product.imageCoverUrl) {
    tryAddImage(params.product.imageCoverUrl, null);
  }

  const imageInputs = imageCandidates.map((entry) => ({
    type: "input_image" as const,
    image_url: entry.url,
  }));
  const imageManifest = imageCandidates.map((entry, index) => ({
    index: index + 1,
    url: entry.url,
    variant_id: entry.variantId ?? null,
  }));

  const userPayloadBase = {
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
    variants: params.variants.map((variant) => ({
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
      images: (variant.images ?? []).slice(0, 5),
      metadata: variant.metadata ?? null,
    })),
  };

  const parseAndNormalize = (raw: string) => {
    const parsed = safeJsonParse(raw);
    const validation = enrichmentResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`JSON schema validation failed: ${validation.error.message}`);
    }
    const product = validation.data.product;
    const normalized: RawEnrichedProduct = {
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
    };

    return normalizeEnrichment(normalized, variantIds, {
      productName: params.product.name,
      brandName: params.product.brandName ?? null,
      description: params.product.description ?? null,
      category: params.product.category ?? null,
      subcategory: params.product.subcategory ?? null,
    });
  };

  const callOpenAI = async () => {
    const client = getOpenAIClient() as OpenAIResponsesClient;
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({ ...userPayloadBase, image_manifest: imageManifest }, null, 2),
            },
            ...imageInputs,
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    });
    const raw = extractOutputText(response);
    if (!raw) throw new Error("Respuesta vacia de OpenAI");
    return raw;
  };

  const callOpenAIRepair = async (raw: string, errorNote: string) => {
    const client = getOpenAIClient() as OpenAIResponsesClient;
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: buildRepairSystemPrompt(systemPrompt) },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildRepairUserText(errorNote, raw),
            },
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    });
    const repaired = extractOutputText(response);
    if (!repaired) throw new Error("Respuesta vacia al reparar con OpenAI");
    return repaired;
  };

  const callBedrock = async () => {
    const imageBlocks: Array<{
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }> = [];
    const bedrockManifest: Array<{ index: number; url: string; variant_id?: string | null }> = [];

    for (const entry of imageCandidates) {
      const loaded = await fetchImageAsBase64(entry.url);
      if (!loaded) continue;
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: loaded.mediaType, data: loaded.base64 },
      });
      bedrockManifest.push({
        index: imageBlocks.length,
        url: entry.url,
        variant_id: entry.variantId ?? null,
      });
    }

    const payload: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ...userPayloadBase, image_manifest: bedrockManifest },
                null,
                2,
              ),
            },
            ...imageBlocks,
          ],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await getBedrockClient().send(command);
    const body = response.body as Uint8Array;
    const rawBody = Buffer.from(body ?? []).toString("utf8");
    const parsed = JSON.parse(rawBody);
    const rawText = extractBedrockText(parsed);
    if (!rawText) throw new Error("Respuesta vacia de Bedrock");
    console.info("bedrock.enrich.usage", parsed?.usage ?? {});
    return rawText;
  };

  const callBedrockRepair = async (raw: string, errorNote: string) => {
    const payload: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2048,
      system: buildRepairSystemPrompt(systemPrompt),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildRepairUserText(errorNote, raw),
            },
          ],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await getBedrockClient().send(command);
    const body = response.body as Uint8Array;
    const rawBody = Buffer.from(body ?? []).toString("utf8");
    const parsed = JSON.parse(rawBody);
    const rawText = extractBedrockText(parsed);
    if (!rawText) throw new Error("Respuesta vacia al reparar con Bedrock");
    console.info("bedrock.enrich.repair.usage", parsed?.usage ?? {});
    return rawText;
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const raw = provider === "bedrock" ? await callBedrock() : await callOpenAI();
      try {
        return parseAndNormalize(raw);
      } catch (error) {
        const note = error instanceof Error ? error.message : String(error);
        const repaired =
          provider === "bedrock" ? await callBedrockRepair(raw, note) : await callOpenAIRepair(raw, note);
        return parseAndNormalize(repaired);
      }
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  const providerLabel = provider === "bedrock" ? "Bedrock" : "OpenAI";
  throw new Error(
    `${providerLabel} enrichment failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

export const productEnrichmentPromptVersion = "v6";
export const productEnrichmentSchemaVersion = "v3";

export const toSlugLabel = (value: string) => slugify(value);
