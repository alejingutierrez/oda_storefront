import { z } from "zod";
import { getOpenAIClient } from "@/lib/openai";
import { normalizeUrl, safeOrigin } from "@/lib/catalog/utils";

const OPENAI_MODEL = process.env.CATALOG_OPENAI_MODEL ?? "gpt-5-mini";
const MAX_RETRIES = 3;
const MAX_HTML_CHARS = Math.max(5000, Number(process.env.CATALOG_PDP_LLM_MAX_HTML_CHARS ?? 40000));
const MAX_TEXT_CHARS = Math.max(2000, Number(process.env.CATALOG_PDP_LLM_MAX_TEXT_CHARS ?? 8000));
const MAX_IMAGES = Math.max(5, Number(process.env.CATALOG_PDP_LLM_MAX_IMAGES ?? 20));

const pdpDecisionSchema = z.object({
  is_pdp: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  product_name: z.string().nullable().optional(),
  price_hint: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
});

const rawVariantSchema = z.object({
  id: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  options: z.record(z.string()).nullable().optional(),
  price: z.number().nullable().optional(),
  compareAtPrice: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  available: z.boolean().nullable().optional(),
  stock: z.number().int().nullable().optional(),
  image: z.string().nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
});

const rawProductSchema = z.object({
  sourceUrl: z.string().url(),
  externalId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  images: z.array(z.string()).default([]),
  options: z
    .array(
      z.object({
        name: z.string(),
        values: z.array(z.string()),
      }),
    )
    .optional(),
  variants: z.array(rawVariantSchema).min(1),
  metadata: z.record(z.unknown()).optional(),
});

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
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON parse failed");
    return JSON.parse(match[0]);
  }
};

const stripHtmlToText = (html: string) =>
  html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseMetaImage = (html: string) => {
  const regex = /<meta[^>]+(property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi;
  const contentRegex = /content=["']([^"']+)["']/i;
  let match: RegExpExecArray | null = null;
  const urls: string[] = [];
  while ((match = regex.exec(html))) {
    const tag = match[0];
    const content = contentRegex.exec(tag)?.[1];
    if (content) urls.push(content);
  }
  return urls;
};

const parseImgSrcs = (html: string) => {
  const urls: string[] = [];
  const srcRegex = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = srcRegex.exec(html))) {
    if (match[1]) urls.push(match[1]);
  }
  const srcsetRegex = /srcset=["']([^"']+)["']/gi;
  while ((match = srcsetRegex.exec(html))) {
    const raw = match[1];
    raw
      .split(",")
      .map((entry) => entry.trim().split(" ")[0])
      .filter(Boolean)
      .forEach((entry) => urls.push(entry));
  }
  return urls;
};

const normalizeImageUrl = (value: string, origin: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(trimmed, origin);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

export const extractHtmlSignals = (html: string, baseUrl: string) => {
  const normalized = normalizeUrl(baseUrl) ?? baseUrl;
  const origin = safeOrigin(normalized);
  const text = stripHtmlToText(html).slice(0, MAX_TEXT_CHARS);
  const metaImages = parseMetaImage(html);
  const imgSrcs = parseImgSrcs(html);
  const combined = unique([...metaImages, ...imgSrcs]);
  const images = combined
    .map((entry) => normalizeImageUrl(entry, origin))
    .filter(Boolean)
    .slice(0, MAX_IMAGES) as string[];
  return {
    text,
    images,
  };
};

export type PdpDecision = z.infer<typeof pdpDecisionSchema>;

export const classifyPdpWithOpenAI = async ({
  url,
  html,
  text,
  images,
}: {
  url: string;
  html: string;
  text: string;
  images: string[];
}): Promise<PdpDecision> => {
  const client = getOpenAIClient() as any;
  let lastError: unknown = null;

  const trimmedHtml = html.slice(0, MAX_HTML_CHARS);
  const trimmedText = text.slice(0, MAX_TEXT_CHARS);

  const systemPrompt = `
Eres un clasificador de páginas de ecommerce de moda colombiana.
Debes responder SOLO JSON válido con este esquema:
{
  "is_pdp": boolean,
  "confidence": number (0-1),
  "reason": "string",
  "product_name": "string|null",
  "price_hint": "string|null",
  "currency": "string|null"
}
Reglas:
- "is_pdp" solo es true si la página es un detalle de producto (PDP).
- Si es home, listado, colección, blog, press, FAQ o contacto => is_pdp=false.
- Si la evidencia es insuficiente, usa is_pdp=false con baja confianza.
- No inventes datos: usa solo lo presente en HTML/texto.
`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        temperature: 0,
        input: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify(
              {
                url,
                html: trimmedHtml,
                text: trimmedText,
                images,
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
      const parsed = safeJsonParse(raw);
      const validation = pdpDecisionSchema.safeParse(parsed);
      if (!validation.success) {
        throw new Error(`JSON validation failed: ${validation.error.message}`);
      }
      return validation.data;
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw new Error(`OpenAI PDP classification failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
};

export const extractRawProductWithOpenAI = async ({
  url,
  html,
  text,
  images,
}: {
  url: string;
  html: string;
  text: string;
  images: string[];
}) => {
  const client = getOpenAIClient() as any;
  let lastError: unknown = null;

  const trimmedHtml = html.slice(0, MAX_HTML_CHARS);
  const trimmedText = text.slice(0, MAX_TEXT_CHARS);

  const systemPrompt = `
Eres un extractor de productos (PDP) para moda colombiana.
Devuelve SOLO JSON válido con este esquema (RawProduct):
{
  "sourceUrl": "string (url)",
  "externalId": "string|null",
  "title": "string|null",
  "description": "string|null",
  "vendor": "string|null",
  "currency": "string|null",
  "images": ["string"],
  "options": [{"name":"string","values":["string"]}],
  "variants": [{
    "id": "string|null",
    "sku": "string|null",
    "options": {"color":"rojo","size":"m"}|null,
    "price": "number|null",
    "compareAtPrice": "number|null",
    "currency": "string|null",
    "available": "boolean|null",
    "stock": "number|null",
    "image": "string|null",
    "images": ["string"]
  }],
  "metadata": {}
}
Reglas:
- Usa SOLO URLs de la lista de imágenes proporcionadas.
- Si no hay variantes explícitas, crea una variante única.
- No inventes precios ni stock si no aparecen.
- sourceUrl debe ser la URL recibida.
`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        temperature: 0,
        input: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify(
              {
                url,
                html: trimmedHtml,
                text: trimmedText,
                images,
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
      const parsed = safeJsonParse(raw);
      const validation = rawProductSchema.safeParse(parsed);
      if (!validation.success) {
        throw new Error(`JSON validation failed: ${validation.error.message}`);
      }
      const product = validation.data;
      return product;
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw new Error(`OpenAI PDP extraction failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
};
