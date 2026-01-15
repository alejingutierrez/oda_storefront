import { OpenAI } from "openai";

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

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const jsonSchema = {
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

const basePrompt = `
Eres un sistema de normalización de catálogo de moda colombiana. Devuelve SOLO JSON válido que siga exactamente el esquema indicado. No incluyas texto adicional.
- Completa campos faltantes con null cuando no haya evidencia.
- Variants deben contener color, talla/size, fit, material, precio, stock_status si se infiere (in_stock/out_of_stock/preorder), imágenes.
- No inventes enlaces: usa los que recibas.
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
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        // json_schema no está tipado aún en el SDK; forzamos tipo
        response_format: { type: "json_object" } as any,
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
        return {
          product: parsed.product,
          cost: {
            prompt_tokens: response.usage?.prompt_tokens ?? 0,
            completion_tokens: response.usage?.completion_tokens ?? 0,
            total_tokens: response.usage?.total_tokens ?? 0,
            price_usd: response.usage?.total_tokens ? (response.usage.total_tokens / 1_000_000) * 15 : undefined, // rough placeholder pricing
          },
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
