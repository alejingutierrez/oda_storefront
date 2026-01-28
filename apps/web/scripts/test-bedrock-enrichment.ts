import dotenv from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
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
} from "../src/lib/product-enrichment/constants";
import {
  normalizeEnumArray,
  normalizeEnumValue,
  normalizeHexColor,
  normalizePantoneCode,
} from "../src/lib/product-enrichment/utils";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const args = new Set(process.argv.slice(2));
const getArgValue = (name: string) => {
  const match = Array.from(args).find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
};

const PRODUCT_ID = getArgValue("--product-id");
const INFERENCE_PROFILE_ID = getArgValue("--profile-id") ?? process.env.BEDROCK_INFERENCE_PROFILE_ID;
const MODEL_ID =
  INFERENCE_PROFILE_ID ??
  process.env.BEDROCK_MODEL_ID ??
  "anthropic.claude-sonnet-4-5-20250929-v1:0";
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const AWS_ACCESS_KEY_ID =
  process.env.AWS_ACCESS_KEY_ID ?? process.env.BEDROCK_ACCESS_KEY ?? "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "";
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN ?? "";
const MAX_IMAGES = Math.max(0, Number(process.env.PRODUCT_ENRICHMENT_MAX_IMAGES ?? 6));
const INCLUDE_IMAGES = !args.has("--no-images");

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_REGION) {
  throw new Error("Missing AWS credentials (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION).");
}

const databaseUrl =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL.");
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

type RawEnrichedVariant = {
  variantId: string;
  sku?: string | null;
  colorHex: string | string[];
  colorPantone: string | string[];
  fit: string;
};

type RawEnrichedProduct = {
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

const normalizeEnrichment = (
  input: RawEnrichedProduct,
  variantIds: Set<string>,
  context: {
    productName: string;
    brandName?: string | null;
    description?: string | null;
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
  if (styleTags.length !== 10) {
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

  const fallbackTitle = [context.productName, context.brandName].filter(Boolean).join(" | ");
  const fallbackDescription = context.description?.trim() || context.productName?.trim() || "";

  const seoTitle = fallbackTitle.slice(0, 70);
  const seoDescription = fallbackDescription.slice(0, 160);

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
    seoTags: input.seoTags,
    variants,
  };
};

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

const extractTextFromBedrock = (payload: any) => {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const textParts = content
    .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
    .map((item: any) => item.text);
  return textParts.join("\n").trim();
};

const main = async () => {
  const product = PRODUCT_ID
    ? await prisma.product.findUnique({
        where: { id: PRODUCT_ID },
        include: { variants: true, brand: true },
      })
    : await prisma.product.findFirst({
        where: { variants: { some: {} } },
        include: { variants: true, brand: true },
        orderBy: { updatedAt: "desc" },
      });

  if (!product) {
    throw new Error("No product found to test. Provide --product-id=<id>.");
  }

  const client = new BedrockRuntimeClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      ...(AWS_SESSION_TOKEN ? { sessionToken: AWS_SESSION_TOKEN } : {}),
    },
  });

  const variantIds = new Set(product.variants.map((variant) => variant.id));
  const imageUrls: Array<{ url: string; variantId?: string | null }> = [];
  const seen = new Set<string>();

  if (INCLUDE_IMAGES && MAX_IMAGES > 0) {
    for (const variant of product.variants) {
      for (const img of (variant.images ?? []).slice(0, 2)) {
        if (imageUrls.length >= MAX_IMAGES) break;
        if (!img || seen.has(img)) continue;
        seen.add(img);
        imageUrls.push({ url: img, variantId: variant.id });
      }
      if (imageUrls.length >= MAX_IMAGES) break;
    }
    if (imageUrls.length < MAX_IMAGES && product.imageCoverUrl && !seen.has(product.imageCoverUrl)) {
      imageUrls.push({ url: product.imageCoverUrl, variantId: null });
    }
  }

  const imageBlocks: Array<{
    type: "image";
    source: { type: "base64"; media_type: string; data: string };
  }> = [];
  const imageManifest: Array<{ index: number; url: string; variant_id?: string | null }> = [];

  for (const entry of imageUrls) {
    const loaded = await fetchImageAsBase64(entry.url);
    if (!loaded) continue;
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: loaded.mediaType, data: loaded.base64 },
    });
    imageManifest.push({
      index: imageBlocks.length,
      url: entry.url,
      variant_id: entry.variantId ?? null,
    });
  }

  const userPayload = {
    product: {
      id: product.id,
      brand_name: product.brand?.name ?? null,
      name: product.name,
      description: product.description ?? null,
      category: product.category ?? null,
      subcategory: product.subcategory ?? null,
      styleTags: product.styleTags ?? [],
      materialTags: product.materialTags ?? [],
      patternTags: product.patternTags ?? [],
      occasionTags: product.occasionTags ?? [],
      gender: product.gender ?? null,
      season: product.season ?? null,
      care: product.care ?? null,
      origin: product.origin ?? null,
      status: product.status ?? null,
      sourceUrl: product.sourceUrl ?? null,
      imageCoverUrl: product.imageCoverUrl ?? null,
      metadata: product.metadata ?? null,
    },
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku ?? null,
      color: variant.color ?? null,
      size: variant.size ?? null,
      fit: variant.fit ?? null,
      material: variant.material ?? null,
      price: variant.price ? Number(variant.price) : null,
      currency: variant.currency ?? null,
      stock: variant.stock ?? null,
      stockStatus: variant.stockStatus ?? null,
      images: (variant.images ?? []).slice(0, 5),
      metadata: variant.metadata ?? null,
    })),
    image_manifest: imageManifest,
  };

  const systemPrompt = buildPrompt();
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: JSON.stringify(userPayload, null, 2) },
        ...imageBlocks,
      ],
    },
  ];

  const payload: Record<string, unknown> = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  console.log("bedrock.test.start", {
    model: MODEL_ID,
    productId: product.id,
    productName: product.name,
    brandName: product.brand?.name ?? null,
    sourceUrl: product.sourceUrl ?? null,
    imagesRequested: imageUrls.length,
    imagesSent: imageBlocks.length,
  });

  const response = await client.send(command);
  const body = response.body as Uint8Array;
  const raw = Buffer.from(body ?? []).toString("utf8");
  const parsed = JSON.parse(raw);
  const text = extractTextFromBedrock(parsed);
  if (!text) {
    throw new Error("Empty response text from Bedrock.");
  }

  const parsedJson = safeJsonParse(text);
  const validation = enrichmentResponseSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new Error(`JSON schema validation failed: ${validation.error.message}`);
  }

  console.log("bedrock.test.output", JSON.stringify(parsedJson, null, 2));

  const productOut = validation.data.product;
  const normalized = normalizeEnrichment(
    {
      category: productOut.category,
      subcategory: productOut.subcategory,
      styleTags: productOut.style_tags,
      materialTags: productOut.material_tags ?? [],
      patternTags: productOut.pattern_tags ?? [],
      occasionTags: productOut.occasion_tags ?? [],
      gender: productOut.gender,
      season: productOut.season,
      seoTitle: productOut.seo_title ?? "",
      seoDescription: productOut.seo_description ?? "",
      seoTags: productOut.seo_tags ?? [],
      variants: productOut.variants.map((variant) => ({
        variantId: variant.variant_id,
        sku: variant.sku ?? null,
        colorHex: variant.color_hex,
        colorPantone: variant.color_pantone,
        fit: variant.fit,
      })),
    },
    variantIds,
    {
      productName: product.name,
      brandName: product.brand?.name ?? null,
      description: product.description ?? null,
    },
  );

  console.log("bedrock.test.success", {
    category: normalized.category,
    subcategory: normalized.subcategory,
    gender: normalized.gender,
    season: normalized.season,
    styleTagsCount: normalized.styleTags.length,
    materialTagsCount: normalized.materialTags.length,
    patternTagsCount: normalized.patternTags.length,
    occasionTagsCount: normalized.occasionTags.length,
    variantCount: normalized.variants.length,
    firstVariant: normalized.variants[0]
      ? {
          id: normalized.variants[0].variantId,
          colorHex: normalized.variants[0].colorHex,
          colorPantone: normalized.variants[0].colorPantone,
          fit: normalized.variants[0].fit,
        }
      : null,
    usage: parsed?.usage ?? null,
  });
};

main()
  .catch((error) => {
    console.error("bedrock.test.failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
