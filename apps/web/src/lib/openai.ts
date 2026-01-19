import { OpenAI } from "openai";
import { z } from "zod";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const MAX_RETRIES = 3;

export type NormalizedVariant = {
  sku?: string | null;
  color?: string | null;
  size?: string | null;
  fit?: string | null;
  material?: string | null;
  price?: number | null;
  currency?: string | null;
  stock?: number | null;
  stock_status?: string | null;
  images?: string[] | null;
};

export type NormalizedProduct = {
  brand: string;
  name: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  style_tags?: string[];
  material_tags?: string[];
  pattern_tags?: string[];
  occasion_tags?: string[];
  gender?: string | null;
  season?: string | null;
  care?: string | null;
  origin?: string | null;
  status?: string | null;
  source_url?: string | null;
  image_cover_url?: string | null;
  variants: NormalizedVariant[];
  metadata?: Record<string, unknown>;
};

type OpenAIJsonResponse = {
  product: NormalizedProduct;
  cost?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; price_usd?: number };
};

let client: OpenAI | null = null;

export const getOpenAIClient = () => {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is missing. Set it in the environment to enable normalization.",
    );
  }
  client = new OpenAI({ apiKey });
  return client;
};

// Exported for potential validation in callers
export const productJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    product: {
      type: "object",
      required: ["brand", "name", "variants"],
      properties: {
        brand: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        subcategory: { type: "string" },
        style_tags: { type: "array", items: { type: "string" } },
        material_tags: { type: "array", items: { type: "string" } },
        pattern_tags: { type: "array", items: { type: "string" } },
        occasion_tags: { type: "array", items: { type: "string" } },
        gender: { type: "string" },
        season: { type: "string" },
        care: { type: "string" },
        origin: { type: "string" },
        status: { type: "string" },
        source_url: { type: "string" },
        image_cover_url: { type: "string" },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              color: { type: "string" },
              size: { type: "string" },
              fit: { type: "string" },
              material: { type: "string" },
              price: { type: "number" },
              currency: { type: "string" },
              stock: { type: "integer" },
              stock_status: { type: "string" },
              images: { type: "array", items: { type: "string" } },
            },
          },
        },
        metadata: { type: "object" },
      },
    },
    cost: {
      type: "object",
      properties: {
        prompt_tokens: { type: "number" },
        completion_tokens: { type: "number" },
        total_tokens: { type: "number" },
        price_usd: { type: "number" },
      },
    },
  },
  required: ["product"],
};

export const normalizedProductSchema = z.object({
  brand: z.string(),
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
  source_url: z.string().url().nullable().optional(),
  image_cover_url: z.string().url().nullable().optional(),
  variants: z
    .array(
      z.object({
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
      }),
    )
    .min(1),
  metadata: z.record(z.unknown()).optional(),
});

const openAIResponseSchema = z.object({
  product: normalizedProductSchema,
  cost: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
      price_usd: z.number().optional(),
    })
    .optional(),
});

const basePrompt = `
Eres un sistema de normalización de catálogo de moda colombiana. Devuelve SOLO JSON válido que siga exactamente el esquema indicado. No incluyas texto adicional.
- Completa campos faltantes con null cuando no haya evidencia.
- Variants deben contener color, talla/size, fit, material, precio, stock_status si se infiere (in_stock/out_of_stock/preorder), imágenes.
- No inventes enlaces: usa los que recibas.
- Las tags deben ser listas (array) y texto en minúsculas.
`;

export async function normalizeProductWithOpenAI({
  productHtml,
  images,
  sourceUrl,
}: {
  productHtml: string;
  images: string[];
  sourceUrl?: string;
}): Promise<OpenAIJsonResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await getOpenAIClient().chat.completions.create({
        model: OPENAI_MODEL,
        // json_schema no está tipado aún en el SDK; forzamos tipo
        response_format: { type: "json_object" } as unknown as { type: "json_object" },
        messages: [
          { role: "system", content: basePrompt },
          {
            role: "user",
            content: `URL de origen: ${sourceUrl ?? "n/a"}\n\nHTML o texto del producto:\n${productHtml}\n\nImágenes:\n${images.join(
              "\n",
            )}`,
          },
        ],
      });

      const raw = response.choices[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw) as OpenAIJsonResponse;
        const validation = openAIResponseSchema.safeParse(parsed);
        if (!validation.success) {
          throw new Error(`JSON validation failed: ${validation.error.message}`);
        }
        const cost = {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          total_tokens: response.usage?.total_tokens ?? 0,
          price_usd: response.usage?.total_tokens ? (response.usage.total_tokens / 1_000_000) * 15 : undefined, // rough placeholder pricing
        };
        console.info("openai.normalize.success", {
          total_tokens: cost.total_tokens,
          prompt_tokens: cost.prompt_tokens,
          completion_tokens: cost.completion_tokens,
          price_usd: cost.price_usd,
        });
        return {
          product: validation.data.product,
          cost,
        };
      }
      throw new Error("Respuesta sin JSON parseable");
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw new Error(`OpenAI normalization failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
}
