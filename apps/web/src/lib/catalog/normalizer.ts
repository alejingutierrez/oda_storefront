import { z } from "zod";
import { getOpenAIClient } from "@/lib/openai";
import { guessCurrency } from "@/lib/catalog/utils";
import type { CanonicalProduct, RawProduct } from "@/lib/catalog/types";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const MAX_RETRIES = 3;

const catalogVariantSchema = z.object({
  sku: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  fit: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  stock: z.number().int().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
});

const catalogProductSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  style_tags: z.array(z.string()).default([]),
  material_tags: z.array(z.string()).default([]),
  pattern_tags: z.array(z.string()).default([]),
  occasion_tags: z.array(z.string()).default([]),
  gender: z.string().nullable().optional(),
  season: z.string().nullable().optional(),
  care: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  image_cover_url: z.string().nullable().optional(),
  variants: z.array(catalogVariantSchema).min(1),
  metadata: z.record(z.unknown()).optional(),
});

const openAiResponseSchema = z.object({
  product: catalogProductSchema,
});

const basePrompt = `
Eres un sistema de normalizacion de catalogo de moda colombiana. Devuelve SOLO JSON valido y estrictamente en este formato:
{
  "product": {
    "name": "string",
    "description": "string|null",
    "category": "string|null",
    "subcategory": "string|null",
    "style_tags": ["string"],
    "material_tags": ["string"],
    "pattern_tags": ["string"],
    "occasion_tags": ["string"],
    "gender": "string|null",
    "season": "string|null",
    "care": "string|null",
    "origin": "string|null",
    "status": "string|null",
    "source_url": "string|null",
    "image_cover_url": "string|null",
    "variants": [
      {
        "sku": "string|null",
        "color": "string|null",
        "size": "string|null",
        "fit": "string|null",
        "material": "string|null",
        "price": "number|null",
        "currency": "string|null",
        "stock": "number|null",
        "stock_status": "string|null",
        "images": ["string"]
      }
    ],
    "metadata": {}
  }
}
- No inventes precios, stock ni variantes: usa los valores provistos en raw_product.
- Si un precio viene con separador de miles (ej: 160.000), interpretalo como 160000.
- Si no hay currency, asume USD para precios <= 999 y COP para precios >= 10000.
- Si falta un dato, usa null o listas vacias.
- style_tags, material_tags, pattern_tags, occasion_tags deben ser arrays en minusculas.
- source_url debe ser la URL externa original del producto si existe.
- image_cover_url debe ser una URL de imagen (preferir blob_url si se provee).
`;

const extractOutputText = (response: any) => {
  if (typeof response?.output_text === "string") return response.output_text;
  const message = Array.isArray(response?.output)
    ? response.output.find((item: any) => item.type === "message")
    : null;
  const content = message?.content?.find((item: any) => item.type === "output_text" || item.type === "text");
  return content?.text ?? "";
};

const safeJsonParse = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = raw.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error("JSON parse failed");
  }
};

const coerceProductWrapper = (parsed: any) => {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (parsed.product && typeof parsed.product === "object") return parsed;
  const hasProductShape = parsed.name && parsed.variants;
  if (hasProductShape) {
    return { product: parsed };
  }
  return parsed;
};

export const normalizeCatalogProductWithOpenAI = async (rawProduct: RawProduct) => {
  const client = getOpenAIClient() as any;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: basePrompt },
          {
            role: "user",
            content: JSON.stringify(
              {
                raw_product: rawProduct,
              },
              null,
              2,
            ),
          },
        ],
        text: { format: { type: "json_object" } },
      });

      const raw = extractOutputText(response);
      if (!raw) throw new Error("Respuesta vacia de OpenAI");
      const parsed = coerceProductWrapper(safeJsonParse(raw));
      const validation = openAiResponseSchema.safeParse(parsed);
      if (!validation.success) {
        throw new Error(`JSON validation failed: ${validation.error.message}`);
      }
      const product = validation.data.product as CanonicalProduct;
      if (Array.isArray(product.variants)) {
        product.variants = product.variants.map((variant) => {
          const price = typeof variant.price === "number" ? variant.price : null;
          const currency = guessCurrency(price, variant.currency ?? null);
          return { ...variant, currency: currency ?? variant.currency ?? null };
        });
      }
      return product;
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw new Error(`OpenAI catalog normalization failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
};
