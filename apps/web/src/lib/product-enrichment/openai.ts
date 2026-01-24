import { z } from "zod";
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

const OPENAI_MODEL = process.env.PRODUCT_ENRICHMENT_MODEL ?? "gpt-5-mini";
const MAX_RETRIES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_RETRIES ?? 3));
const MAX_IMAGES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_IMAGES ?? 8));

const variantSchema = z.object({
  variant_id: z.string(),
  sku: z.string().nullable().optional(),
  color_hex: z.string(),
  color_pantone: z.string(),
  fit: z.string(),
});

const productSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  style_tags: z.array(z.string()).min(5).max(10),
  material_tags: z.array(z.string()).max(3).default([]),
  pattern_tags: z.array(z.string()).max(2).default([]),
  occasion_tags: z.array(z.string()).max(2).default([]),
  gender: z.string(),
  season: z.string(),
  variants: z.array(variantSchema).min(1),
});

const enrichmentResponseSchema = z.object({
  product: productSchema,
});

export type EnrichedVariant = {
  variantId: string;
  sku?: string | null;
  colorHex: string;
  colorPantone: string;
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

const extractOutputText = (response: OpenAIResponse | null | undefined) => {
  if (typeof response?.output_text === "string") return response.output_text;
  const message = Array.isArray(response?.output)
    ? response.output.find((item) => item.type === "message")
    : null;
  const content = message?.content?.find((item) => item.type === "output_text" || item.type === "text");
  return content?.text ?? "";
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
    "variants": [
      {
        "variant_id": "string",
        "sku": "string|null",
        "color_hex": "#RRGGBB",
        "color_pantone": "NN-NNNN",
        "fit": "string"
      }
    ]
  }
}
Reglas estrictas:
- category, subcategory, gender, season, color_hex, color_pantone y fit deben tener UN SOLO valor.
- style_tags deben ser entre 5 y 10 elementos.
- material_tags máximo 3 elementos.
- pattern_tags máximo 2 elementos.
- occasion_tags máximo 2 elementos.
- Usa SOLO los valores permitidos (en formato slug sin tildes ni espacios).
- No inventes variantes: devuelve un objeto por cada variant_id recibido.
- color_hex debe ser hexadecimal #RRGGBB.
- color_pantone debe ser un código Pantone TCX NN-NNNN. No puede ser null. Usa el más cercano si no es exacto.

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

const normalizeEnrichment = (input: EnrichedProduct, variantIds: Set<string>) => {
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
  if (styleTags.length < 5 || styleTags.length > 10) {
    throw new Error(`Invalid style_tags length: ${styleTags.length}`);
  }

  const materialTags = normalizeEnumArray(input.materialTags ?? [], MATERIAL_TAGS).slice(0, 3);
  const patternTags = normalizeEnumArray(input.patternTags ?? [], PATTERN_TAGS).slice(0, 2);
  const occasionTags = normalizeEnumArray(input.occasionTags ?? [], OCCASION_TAGS).slice(0, 2);

  const gender = normalizeEnumValue(input.gender, GENDER_OPTIONS.map((entry) => entry.value));
  if (!gender) throw new Error(`Invalid gender: ${input.gender}`);

  const season = normalizeEnumValue(input.season, SEASON_OPTIONS.map((entry) => entry.value));
  if (!season) throw new Error(`Invalid season: ${input.season}`);

  const fitAllowed = FIT_OPTIONS.map((entry) => entry.value);

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
    const colorHex = normalizeHexColor(variant.colorHex);
    if (!colorHex) throw new Error(`Invalid color_hex: ${variant.colorHex}`);
    const colorPantone = normalizePantoneCode(variant.colorPantone) ?? "19-4042";
    const fit = normalizeEnumValue(variant.fit, fitAllowed);
    if (!fit) throw new Error(`Invalid fit: ${variant.fit}`);
    return {
      ...variant,
      colorHex,
      colorPantone,
      fit,
    };
  });

  if (seenVariantIds.size !== variantIds.size) {
    throw new Error("Missing variants in enrichment output");
  }

  return {
    category,
    subcategory,
    styleTags,
    materialTags,
    patternTags,
    occasionTags,
    gender,
    season,
    variants,
  };
};

export async function enrichProductWithOpenAI(params: {
  product: {
    id: string;
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
  const client = getOpenAIClient() as OpenAIResponsesClient;
  const systemPrompt = buildPrompt();
  let lastError: unknown = null;

  const variantIds = new Set(params.variants.map((variant) => variant.id));
  const imageInputs: Array<{ type: "input_image"; image_url: string }> = [];
  const imageManifest: Array<{ index: number; url: string; variantId?: string | null }> = [];
  const seen = new Set<string>();

  const tryAddImage = (url: string | null | undefined, variantId?: string | null) => {
    if (!url || imageInputs.length >= MAX_IMAGES) return;
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    imageInputs.push({ type: "input_image", image_url: trimmed });
    imageManifest.push({ index: imageInputs.length, url: trimmed, variantId: variantId ?? null });
  };

  params.variants.forEach((variant) => {
    (variant.images ?? []).slice(0, 2).forEach((img) => tryAddImage(img, variant.id));
  });
  if (imageInputs.length < MAX_IMAGES && params.product.imageCoverUrl) {
    tryAddImage(params.product.imageCoverUrl, null);
  }

  const userPayload = {
    product: {
      id: params.product.id,
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
    image_manifest: imageManifest.map((entry) => ({
      index: entry.index,
      url: entry.url,
      variant_id: entry.variantId ?? null,
    })),
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(userPayload, null, 2),
              },
              ...imageInputs,
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      });

      const raw = extractOutputText(response);
      if (!raw) throw new Error("Respuesta vacia de OpenAI");
      const parsed = safeJsonParse(raw);
      const validation = enrichmentResponseSchema.safeParse(parsed);
      if (!validation.success) {
        throw new Error(`JSON validation failed: ${validation.error.message}`);
      }
      const product = validation.data.product;
      const normalized: EnrichedProduct = {
        category: product.category,
        subcategory: product.subcategory,
        styleTags: product.style_tags,
        materialTags: product.material_tags ?? [],
        patternTags: product.pattern_tags ?? [],
        occasionTags: product.occasion_tags ?? [],
        gender: product.gender,
        season: product.season,
        variants: product.variants.map((variant) => ({
          variantId: variant.variant_id,
          sku: variant.sku ?? null,
          colorHex: variant.color_hex,
          colorPantone: variant.color_pantone,
          fit: variant.fit,
        })),
      };

      return normalizeEnrichment(normalized, variantIds);
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw new Error(`OpenAI enrichment failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
}

export const productEnrichmentPromptVersion = "v1";
export const productEnrichmentSchemaVersion = "v1";

export const toSlugLabel = (value: string) => slugify(value);
