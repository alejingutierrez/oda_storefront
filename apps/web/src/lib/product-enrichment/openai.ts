import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { getOpenAIClient } from "@/lib/openai";
import {
  FIT_OPTIONS,
  GENDER_OPTIONS,
  SEASON_OPTIONS,
} from "@/lib/product-enrichment/constants";
import { getPublishedTaxonomyMeta } from "@/lib/taxonomy/server";
import {
  normalizeEnumArray,
  normalizeEnumValue,
  normalizeHexColor,
  normalizePantoneCode,
  chunkArray,
  slugify,
} from "@/lib/product-enrichment/utils";
import {
  harvestProductSignals,
  buildSignalPayloadForPrompt,
  type HarvestedSignals,
} from "@/lib/product-enrichment/signal-harvester";
import {
  routeToPromptGroup,
  type PromptRouteResult,
} from "@/lib/product-enrichment/pre-classifier";
import {
  getCategoriesForPromptGroup,
  type PromptGroup,
} from "@/lib/product-enrichment/category-groups";
import { resolveImageLimitsForGroup } from "@/lib/product-enrichment/image-strategy";
import {
  buildProductEnrichmentPrompt,
  type PromptTaxonomy,
} from "@/lib/product-enrichment/prompt-templates";
import {
  validateAndAutofixEnrichment,
  type ConsistencyIssue,
  type ConsistencyAutoFix,
  type EnrichmentConfidence,
} from "@/lib/product-enrichment/consistency-validator";

const RAW_PROVIDER = (process.env.PRODUCT_ENRICHMENT_PROVIDER ?? "openai").toLowerCase();
const PRODUCT_ENRICHMENT_PROVIDER: "openai" | "bedrock" = "openai";
if (RAW_PROVIDER !== PRODUCT_ENRICHMENT_PROVIDER) {
  console.warn("[product-enrichment] provider override", {
    requested: RAW_PROVIDER,
    effective: PRODUCT_ENRICHMENT_PROVIDER,
  });
}
const OPENAI_MODEL = process.env.PRODUCT_ENRICHMENT_MODEL ?? "gpt-5-mini";
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_INFERENCE_PROFILE_ID ?? process.env.BEDROCK_MODEL_ID ?? "";
const BEDROCK_REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";
const BEDROCK_ACCESS_KEY =
  process.env.AWS_ACCESS_KEY_ID ?? process.env.BEDROCK_ACCESS_KEY ?? "";
const BEDROCK_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "";
const BEDROCK_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN ?? "";
const MAX_RETRIES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_RETRIES ?? 3));
const MAX_IMAGES = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_MAX_IMAGES ?? 8));
const MAX_TOKENS = Math.max(256, Number(process.env.PRODUCT_ENRICHMENT_MAX_TOKENS ?? 1200));
const VARIANT_LIMIT = Math.max(
  1,
  Number(process.env.PRODUCT_ENRICHMENT_VARIANT_LIMIT ?? 2),
);
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
const BEDROCK_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.PRODUCT_ENRICHMENT_BEDROCK_TIMEOUT_MS ?? 25000),
);
const BEDROCK_MAX_IMAGES = Math.max(
  0,
  Number(process.env.PRODUCT_ENRICHMENT_BEDROCK_MAX_IMAGES ?? Math.min(MAX_IMAGES, 4)),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitterDelay = async (minMs = 100, maxMs = 400) => {
  const min = Math.max(0, minMs);
  const max = Math.max(min, maxMs);
  const value = Math.floor(min + Math.random() * (max - min + 1));
  await sleep(value);
};

const patchVariantIds = (value: unknown, requiredVariantIds: string[]) => {
  if (!value || typeof value !== "object") return;
  const product = (value as { product?: unknown }).product;
  if (!product || typeof product !== "object") return;
  const variants = (product as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return;

  const used = new Set<string>();
  variants.forEach((variant) => {
    const id = (variant as { variant_id?: unknown })?.variant_id;
    if (typeof id === "string" && id.trim()) used.add(id);
  });

  for (let i = 0; i < variants.length && i < requiredVariantIds.length; i += 1) {
    const variant = variants[i];
    if (!variant || typeof variant !== "object") continue;
    const current = (variant as { variant_id?: unknown }).variant_id;
    if (typeof current === "string" && current.trim()) continue;
    const fallback = requiredVariantIds[i];
    if (!fallback || used.has(fallback)) continue;
    (variant as { variant_id?: string }).variant_id = fallback;
    used.add(fallback);
  }
};

const selectVariantsForEnrichment = <T extends { id: string; images?: string[] | null }>(
  variants: T[],
  limit: number,
) => {
  if (variants.length <= limit) return variants;
  const picked: T[] = [];
  const seen = new Set<string>();
  const push = (variant: T) => {
    if (picked.length >= limit) return;
    if (seen.has(variant.id)) return;
    seen.add(variant.id);
    picked.push(variant);
  };
  variants.forEach((variant) => {
    if ((variant.images ?? []).length) push(variant);
  });
  variants.forEach((variant) => push(variant));
  return picked;
};

const coerceStringArray = (max: number) =>
  z.preprocess(
    (value) => {
      if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
      if (typeof value === "string") return [value];
      return [];
    },
    z.array(z.string()).max(max),
  );

const coerceString = z.preprocess((value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string");
    return first ?? "";
  }
  if (value == null) return "";
  return String(value);
}, z.string());

const colorField = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === "string" ? entry : String(entry)));
  }
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}, z.union([z.string(), z.array(z.string()).min(1).max(3)]));

const variantSchema = z.object({
  variant_id: z.string(),
  sku: z.string().nullable().optional(),
  color_hex: colorField,
  color_pantone: colorField,
  fit: coerceString,
});

const productSchema = z.object({
  description: z.string().nullable().optional().default(""),
  category: coerceString,
  subcategory: coerceString,
  style_tags: coerceStringArray(20),
  material_tags: coerceStringArray(10),
  pattern_tags: coerceStringArray(10),
  occasion_tags: coerceStringArray(10),
  gender: coerceString,
  season: coerceString,
  seo_title: z.string().nullable().optional().default(""),
  seo_description: z.string().nullable().optional().default(""),
  seo_tags: coerceStringArray(20),
  variants: z.array(variantSchema).min(1),
});

const enrichmentResponseSchema = z.object({
  product: productSchema,
});

export const productEnrichmentProvider = PRODUCT_ENRICHMENT_PROVIDER;
export const productEnrichmentModel = OPENAI_MODEL;

export type RawEnrichedVariant = {
  variantId: string;
  sku?: string | null;
  colorHex: string | string[];
  colorPantone: string | string[];
  fit: string;
};

export type RawEnrichedProduct = {
  description: string;
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
  description: string;
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
  confidence?: EnrichmentConfidence;
  reviewRequired?: boolean;
  reviewReasons?: string[];
  diagnostics?: {
    signals: HarvestedSignals;
    promptGroup: PromptGroup | "generic";
    route: PromptRouteResult;
    consistencyIssues: ConsistencyIssue[];
    autoFixes: ConsistencyAutoFix[];
  };
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

type BedrockResponse = {
  content?: Array<{ type?: string; text?: string }>;
  completion?: string;
  output_text?: string;
};

type BedrockToolUse = {
  type?: string;
  name?: string;
  input?: unknown;
};

const BEDROCK_TOOL_NAME = "enrich_product";

const bedrockToolSchema = {
  name: BEDROCK_TOOL_NAME,
  description: "Devuelve el enriquecimiento normalizado del producto según el esquema.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["product"],
    properties: {
      product: {
        type: "object",
        additionalProperties: false,
        required: [
          "description",
          "category",
          "subcategory",
          "style_tags",
          "material_tags",
          "pattern_tags",
          "occasion_tags",
          "gender",
          "season",
          "seo_title",
          "seo_description",
          "seo_tags",
          "variants",
        ],
        properties: {
          description: { type: "string" },
          category: { type: "string" },
          subcategory: { type: "string" },
          style_tags: { type: "array", items: { type: "string" } },
          material_tags: { type: "array", items: { type: "string" } },
          pattern_tags: { type: "array", items: { type: "string" } },
          occasion_tags: { type: "array", items: { type: "string" } },
          gender: { type: "string" },
          season: { type: "string" },
          seo_title: { type: "string" },
          seo_description: { type: "string" },
          seo_tags: { type: "array", items: { type: "string" } },
          variants: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["variant_id", "sku", "color_hex", "color_pantone", "fit"],
              properties: {
                variant_id: { type: "string" },
                sku: { type: ["string", "null"] },
                color_hex: {
                  anyOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
                  ],
                },
                color_pantone: {
                  anyOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
                  ],
                },
                fit: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

const openAiResponseSchema = bedrockToolSchema.input_schema;

type BedrockModule = typeof import("@aws-sdk/client-bedrock-runtime");
type BedrockClientLike = InstanceType<BedrockModule["BedrockRuntimeClient"]>;
let bedrockModulePromise: Promise<BedrockModule> | null = null;
let bedrockClient: BedrockClientLike | null = null;

const loadBedrockModule = async () => {
  if (!bedrockModulePromise) {
    bedrockModulePromise = import("@aws-sdk/client-bedrock-runtime");
  }
  return bedrockModulePromise;
};

const getBedrockClient = async () => {
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
  const { BedrockRuntimeClient } = await loadBedrockModule();
  bedrockClient = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: BEDROCK_TIMEOUT_MS,
      socketTimeout: BEDROCK_TIMEOUT_MS,
    }),
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

const extractBedrockText = (payload: BedrockResponse | null | undefined) => {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (typeof payload?.completion === "string") return payload.completion;
  if (Array.isArray(payload?.content)) {
    const text = payload.content.map((entry) => entry?.text).find(Boolean);
    if (text) return text;
  }
  return "";
};

const findBedrockToolUse = (payload: unknown, toolName: string) => {
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const node = queue.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    const candidate = node as BedrockToolUse & { [key: string]: unknown };
    const nameMatches = !toolName || candidate.name === toolName;
    if (candidate.type === "tool_use" && nameMatches) {
      return candidate;
    }
    if (nameMatches && typeof candidate.name === "string" && "input" in candidate) {
      return candidate;
    }

    queue.push(...Object.values(node as Record<string, unknown>));
  }
  return null;
};

const extractBedrockToolInput = (payload: unknown, toolName: string) => {
  const tool = findBedrockToolUse(payload, toolName);
  if (!tool) return null;
  const input =
    (tool as { input?: unknown }).input ??
    (tool as { arguments?: unknown }).arguments ??
    (tool as { input_json?: unknown }).input_json ??
    null;
  if (typeof input === "string") {
    try {
      return safeJsonParse(input);
    } catch {
      return null;
    }
  }
  return input ?? null;
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

const sanitizeJsonText = (raw: string) =>
  raw
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const findMatchingBrace = (value: string, startIndex: number) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const extractJsonCandidates = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const candidates: string[] = [];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());
  const tagMatch = trimmed.match(/<json>\s*([\s\S]*?)\s*<\/json>/i);
  if (tagMatch?.[1]) candidates.push(tagMatch[1].trim());
  const productIndex = trimmed.indexOf("\"product\"");
  if (productIndex !== -1) {
    const start = trimmed.lastIndexOf("{", productIndex);
    if (start !== -1) {
      const end = findMatchingBrace(trimmed, start);
      if (end !== -1) candidates.push(trimmed.slice(start, end + 1));
    }
  }
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    const end = findMatchingBrace(trimmed, firstBrace);
    if (end !== -1) candidates.push(trimmed.slice(firstBrace, end + 1));
  }
  candidates.push(trimmed);
  return [...new Set(candidates)];
};

const safeJsonParse = (raw: string) => {
  const candidates = extractJsonCandidates(raw);
  for (const candidate of candidates) {
    const sanitized = sanitizeJsonText(candidate);
    try {
      return JSON.parse(sanitized);
    } catch {
    }
    try {
      const repaired = jsonrepair(sanitized);
      return JSON.parse(repaired);
    } catch {
    }
  }
  throw new Error("JSON parse failed");
};

const trimForRepair = (value: string) => {
  if (value.length <= REPAIR_MAX_CHARS) return value;
  return value.slice(0, REPAIR_MAX_CHARS);
};

const buildRepairSystemPrompt = (basePrompt: string) =>
  `${basePrompt}\nIMPORTANTE: Estás corrigiendo una salida previa. Devuelve SOLO JSON válido y completo según el esquema. No agregues texto adicional ni uses markdown o bloques de código.`;

const buildRepairUserText = (errorNote: string, raw: string) =>
  `Se detectó un error al validar la salida:\n${errorNote}\n\nCorrige la siguiente salida para que sea JSON válido y cumpla el esquema:\n${raw}`;


const fetchImageAsBase64 = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return null;
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > IMAGE_MAX_BYTES) return null;
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > IMAGE_MAX_BYTES) return null;
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const sizeMb = arrayBuffer.byteLength / (1024 * 1024);
    return { mediaType, base64, sizeMb };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

type EnrichmentTaxonomy = {
  categories: Array<{
    key: string;
    label: string;
    description: string | null;
    subcategories: Array<{ key: string; label: string; description: string | null }>;
  }>;
  categoryValues: string[];
  subcategoryValues: string[];
  subcategoryByCategory: Record<string, string[]>;
  styleTags: string[];
  styleTagDetails: Array<{ key: string; label: string; description: string | null }>;
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  genderValues: string[];
  seasonValues: string[];
  fitValues: string[];
};

const getEnrichmentTaxonomy = async (): Promise<EnrichmentTaxonomy> => {
  const meta = await getPublishedTaxonomyMeta();
  const data = meta.data;

  const categories = (data.categories ?? [])
    .filter((category) => category.isActive !== false)
    .map((category) => ({
      key: category.key,
      label: category.label ?? category.key,
      description: category.description ?? null,
      subcategories: (category.subcategories ?? [])
        .filter((sub) => sub.isActive !== false)
        .map((sub) => ({
          key: sub.key,
          label: sub.label ?? sub.key,
          description: sub.description ?? null,
        })),
    }))
    .filter((category) => category.subcategories.length > 0);

  const categoryValues = categories.map((category) => category.key);
  const subcategoryValues = categories.flatMap((category) => category.subcategories.map((sub) => sub.key));
  const subcategoryByCategory: Record<string, string[]> = Object.fromEntries(
    categories.map((category) => [category.key, category.subcategories.map((sub) => sub.key)]),
  );

  const styleTags = (data.styleTags ?? [])
    .filter((tag) => tag.isActive !== false)
    .map((tag) => tag.key);
  const styleTagDetails = (data.styleTags ?? [])
    .filter((tag) => tag.isActive !== false)
    .map((tag) => ({
      key: tag.key,
      label: tag.label ?? tag.key,
      description: tag.description ?? null,
    }));
  const materialTags = (data.materials ?? [])
    .filter((tag) => tag.isActive !== false)
    .map((tag) => tag.key);
  const patternTags = (data.patterns ?? [])
    .filter((tag) => tag.isActive !== false)
    .map((tag) => tag.key);
  const occasionTags = (data.occasions ?? [])
    .filter((tag) => tag.isActive !== false)
    .map((tag) => tag.key);

  if (styleTags.length < 10) {
    throw new Error("taxonomy.styleTags must contain at least 10 active entries.");
  }
  if (categoryValues.length === 0 || subcategoryValues.length === 0) {
    throw new Error("taxonomy.categories/subcategories cannot be empty.");
  }

  return {
    categories,
    categoryValues,
    subcategoryValues,
    subcategoryByCategory,
    styleTags,
    styleTagDetails,
    materialTags,
    patternTags,
    occasionTags,
    genderValues: GENDER_OPTIONS.map((entry) => entry.value),
    seasonValues: SEASON_OPTIONS.map((entry) => entry.value),
    fitValues: FIT_OPTIONS.map((entry) => entry.value),
  };
};

const buildPrompt = (
  taxonomy: EnrichmentTaxonomy,
  routing: PromptRouteResult,
) => {
  const routedCategories = getCategoriesForPromptGroup(routing.group);
  return buildProductEnrichmentPrompt({
    taxonomy: taxonomy as PromptTaxonomy,
    group: routing.group,
    routedCategories,
  });
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

const stripHtml = (value: string) => {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const normalizeImageUrl = (
  value: string | null | undefined,
  sourceUrl?: string | null,
): string | null => {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  let normalized = raw;
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  } else if (normalized.startsWith("/")) {
    if (!sourceUrl) return null;
    try {
      normalized = new URL(normalized, sourceUrl).toString();
    } catch {
      return null;
    }
  }

  normalized = normalized.replace(/\s/g, "%20");
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveOriginalDescription = (
  description: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
) => {
  const enrichment = asRecord(metadata?.enrichment);
  const savedOriginal = typeof enrichment?.original_description === "string"
    ? enrichment.original_description
    : null;
  return savedOriginal ?? description ?? null;
};

const normalizeEnrichment = (
  taxonomy: EnrichmentTaxonomy,
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
  const plainDescription =
    stripHtml(input.description) || stripHtml(context.description ?? "") || "";
  if (input.variants.length !== variantIds.size) {
    throw new Error(
      `Variant count mismatch: expected ${variantIds.size}, got ${input.variants.length}`,
    );
  }
  const category = normalizeEnumValue(input.category, taxonomy.categoryValues);
  if (!category) throw new Error(`Invalid category: ${input.category}`);

  const subcategory = normalizeEnumValue(input.subcategory, taxonomy.subcategoryValues);
  if (!subcategory) throw new Error(`Invalid subcategory: ${input.subcategory}`);

  const allowedSubs = taxonomy.subcategoryByCategory[category] ?? [];
  if (!allowedSubs.includes(subcategory)) {
    throw new Error(`Subcategory ${subcategory} does not belong to ${category}`);
  }

  const styleTags = normalizeEnumArray(input.styleTags, taxonomy.styleTags);
  let fixedStyleTags = styleTags;
  if (styleTags.length !== 10) {
    const seen = new Set(styleTags);
    const padded = [...styleTags];
    for (const tag of taxonomy.styleTags) {
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

  const materialTags = normalizeEnumArray(input.materialTags ?? [], taxonomy.materialTags).slice(0, 3);
  const patternTags = normalizeEnumArray(input.patternTags ?? [], taxonomy.patternTags).slice(0, 2);
  const occasionTags = normalizeEnumArray(input.occasionTags ?? [], taxonomy.occasionTags).slice(0, 2);

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
  const fallbackDescription = buildFallbackSeoDescription(plainDescription, context.productName);
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
    description: plainDescription,
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
  const taxonomy = await getEnrichmentTaxonomy();
  const provider = PRODUCT_ENRICHMENT_PROVIDER;
  let lastError: unknown = null;

  if (!params.variants.length) {
    throw new Error("Missing variants for product enrichment.");
  }

  const originalDescription = resolveOriginalDescription(
    params.product.description,
    params.product.metadata ?? null,
  );
  const signals = harvestProductSignals({
    name: params.product.name,
    description: originalDescription ?? params.product.description ?? null,
    brandName: params.product.brandName ?? null,
    metadata: params.product.metadata ?? null,
    sourceUrl: params.product.sourceUrl ?? null,
    allowedCategoryValues: taxonomy.categoryValues,
    subcategoryByCategory: taxonomy.subcategoryByCategory,
    allowedMaterialTags: taxonomy.materialTags,
    allowedPatternTags: taxonomy.patternTags,
  });
  const promptRoute = routeToPromptGroup(signals);
  const systemPrompt = buildPrompt(taxonomy, promptRoute);
  const signalPayload = buildSignalPayloadForPrompt(signals);
  const imageLimits = resolveImageLimitsForGroup(promptRoute.group, MAX_IMAGES);
  const sourceUrl = params.product.sourceUrl ?? null;

  const selectedVariants = selectVariantsForEnrichment(params.variants, VARIANT_LIMIT);
  const variantIdList = selectedVariants.map((variant) => variant.id);
  const variantIds = new Set(variantIdList);

  const productPayload = {
    id: params.product.id,
    brand_name: params.product.brandName ?? null,
    name: params.product.name,
    name_original: params.product.name,
    description_original: originalDescription ?? null,
    description: signals.descriptionCleanText || originalDescription || null,
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
    imageCoverUrl: normalizeImageUrl(params.product.imageCoverUrl ?? null, sourceUrl)
      ?? params.product.imageCoverUrl
      ?? null,
    metadata_compact: {
      platform: signals.vendorPlatform,
      vendor_category: signals.vendorCategory,
      vendor_tags: signals.vendorTags,
      og_title: signals.ogTitle,
      og_description: signals.ogDescription,
    },
  };

  const buildVariantPayload = (
    variantsSubset: typeof params.variants,
    imageLimit = imageLimits.perVariantImages,
  ) =>
    variantsSubset.map((variant) => ({
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
      images: (variant.images ?? [])
        .map((image) => normalizeImageUrl(image, sourceUrl))
        .filter((image): image is string => Boolean(image))
        .slice(0, imageLimit),
      metadata_compact: variant.metadata && typeof variant.metadata === "object"
        ? {
            standardColorId: (variant.metadata as Record<string, unknown>).standardColorId ?? null,
            enrichment: (variant.metadata as Record<string, unknown>).enrichment ?? null,
          }
        : null,
    }));

  const buildUserPayload = (
    variantsSubset: typeof params.variants,
    imageManifestEntries: Array<{ index: number; url: string; variant_id?: string | null }>,
    imageLimit = imageLimits.perVariantImages,
  ) => ({
    product: productPayload,
    variants: buildVariantPayload(variantsSubset, imageLimit),
    signals: signalPayload,
    route: {
      group: promptRoute.group,
      confidence: promptRoute.confidence,
      reason: promptRoute.reason,
    },
    image_manifest: imageManifestEntries,
  });
  const imageCandidates: Array<{ url: string; variantId?: string | null }> = [];
  const seen = new Set<string>();

  const tryAddImage = (url: string | null | undefined, variantId?: string | null) => {
    if (!url || imageCandidates.length >= imageLimits.maxImages) return;
    const normalized = normalizeImageUrl(url, sourceUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    imageCandidates.push({ url: normalized, variantId: variantId ?? null });
  };

  selectedVariants.forEach((variant) => {
    (variant.images ?? []).slice(0, imageLimits.perVariantImages).forEach((img) => tryAddImage(img, variant.id));
  });
  if (imageCandidates.length < imageLimits.maxImages && params.product.imageCoverUrl) {
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

  const openAiPayload = buildUserPayload(
    selectedVariants,
    imageManifest,
    imageLimits.perVariantImages,
  );

  const parseRawProduct = (raw: string): RawEnrichedProduct => {
    const parsed = safeJsonParse(raw);
    return parseRawProductValue(parsed);
  };

  const parseRawProductValue = (value: unknown): RawEnrichedProduct => {
    patchVariantIds(value, variantIdList);
    const validation = enrichmentResponseSchema.safeParse(value);
    if (!validation.success) {
      throw new Error(`JSON schema validation failed: ${validation.error.message}`);
    }
    const product = validation.data.product;
    return {
      description: product.description ?? "",
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
  };

  const normalizeParsed = (normalized: RawEnrichedProduct) =>
    normalizeEnrichment(taxonomy, normalized, variantIds, {
      productName: params.product.name,
      brandName: params.product.brandName ?? null,
      description: originalDescription ?? params.product.description ?? null,
      category: params.product.category ?? null,
      subcategory: params.product.subcategory ?? null,
    });

  const finalizeNormalized = (normalized: EnrichedProduct): EnrichedProduct => {
    const validation = validateAndAutofixEnrichment({
      signals,
      enriched: normalized,
      taxonomy: {
        categoryValues: taxonomy.categoryValues,
        subcategoryByCategory: taxonomy.subcategoryByCategory,
        materialTags: taxonomy.materialTags,
      },
      routeConfidence: promptRoute.confidence,
      routeReason: promptRoute.reason,
    });
    return {
      ...validation.enriched,
      confidence: validation.confidence,
      reviewRequired: validation.reviewRequired,
      reviewReasons: validation.reviewReasons,
      diagnostics: {
        signals,
        promptGroup: promptRoute.group ?? "generic",
        route: promptRoute,
        consistencyIssues: validation.issues,
        autoFixes: validation.autoFixes,
      },
    };
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
              text: JSON.stringify(openAiPayload, null, 2),
            },
            ...imageInputs,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "product_enrichment",
          strict: true,
          schema: openAiResponseSchema,
        },
      },
    });
    const raw = extractOutputText(response);
    if (!raw) throw new Error("Respuesta vacia de OpenAI");
    return raw;
  };

  const callOpenAIRepair = async (raw: string, errorNote: string) => {
    const client = getOpenAIClient() as OpenAIResponsesClient;
    const trimmed = trimForRepair(raw);
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: buildRepairSystemPrompt(systemPrompt) },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildRepairUserText(errorNote, trimmed),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "product_enrichment_repair",
          strict: true,
          schema: openAiResponseSchema,
        },
      },
    });
    const repaired = extractOutputText(response);
    if (!repaired) throw new Error("Respuesta vacia al reparar con OpenAI");
    return repaired;
  };

  const invokeBedrock = async (options: {
    systemPrompt: string;
    userText: string;
    imageInputs: Array<{
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }>;
    usageLabel?: string;
    useTool?: boolean;
  }) => {
    const payload: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: options.systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.userText },
            ...options.imageInputs,
          ],
        },
      ],
    };
    if (options.useTool) {
      payload.tools = [bedrockToolSchema];
      payload.tool_choice = { type: "tool", name: BEDROCK_TOOL_NAME };
    }

    const { InvokeModelCommand } = await loadBedrockModule();
    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    try {
      await jitterDelay();
      const client = await getBedrockClient();
      const response = await client.send(command, { abortSignal: controller.signal });
      const rawBody = await readBedrockBody(response.body);
      const parsed = JSON.parse(rawBody);
      const toolInput = options.useTool ? extractBedrockToolInput(parsed, BEDROCK_TOOL_NAME) : null;
      const rawText = extractBedrockText(parsed);
      if (!toolInput && !rawText) throw new Error("Respuesta vacia de Bedrock");
      if (options.usageLabel) {
        console.info(options.usageLabel, parsed?.usage ?? {});
      }
      return { rawText, toolInput };
    } finally {
      clearTimeout(timeout);
    }
  };

  const buildBedrockPayload = (variantsSubset: typeof params.variants) => {
    const imageUrls: Array<{ url: string; variantId?: string | null }> = [];
    const seenBedrock = new Set<string>();
    const tryAddBedrockImage = (url: string | null | undefined, variantId?: string | null) => {
      if (!url || imageUrls.length >= imageLimits.maxImages) return;
      const normalized = normalizeImageUrl(url, sourceUrl);
      if (!normalized || seenBedrock.has(normalized)) return;
      seenBedrock.add(normalized);
      imageUrls.push({ url: normalized, variantId: variantId ?? null });
    };

    variantsSubset.forEach((variant) => {
      (variant.images ?? []).slice(0, imageLimits.perVariantImages).forEach((img) => tryAddBedrockImage(img, variant.id));
    });
    if (imageUrls.length < imageLimits.maxImages && params.product.imageCoverUrl) {
      tryAddBedrockImage(params.product.imageCoverUrl, null);
    }

    return {
      userPayload: buildUserPayload(variantsSubset, [], imageLimits.perVariantImages),
      imageUrls,
    };
  };

  const callBedrockForChunk = async (
    variantsSubset: typeof params.variants,
  ): Promise<RawEnrichedProduct> => {
    const { userPayload, imageUrls } = buildBedrockPayload(variantsSubset);
    let chunkError: unknown = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const imageBlocks: Array<{
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }> = [];
        const bedrockManifest: Array<{ index: number; url: string; variant_id?: string | null }> =
          [];

        if (INCLUDE_IMAGES) {
          for (const entry of imageUrls) {
            if (imageBlocks.length >= BEDROCK_MAX_IMAGES) break;
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
        }

        const userText = JSON.stringify(
          { ...userPayload, image_manifest: bedrockManifest },
          null,
          2,
        );
        const response = await invokeBedrock({
          systemPrompt,
          userText,
          imageInputs: imageBlocks,
          usageLabel: "bedrock.enrich.usage",
          useTool: true,
        });
        if (response.toolInput) {
          return parseRawProductValue(response.toolInput);
        }
        if (!response.rawText) {
          throw new Error("Respuesta vacia de Bedrock");
        }
        return parseRawProduct(response.rawText);
      } catch (error) {
        chunkError = error;
        const backoff = Math.pow(2, attempt) * 200;
        await new Promise((res) => setTimeout(res, backoff));
      }
    }

    throw new Error(`Bedrock chunk failed after ${MAX_RETRIES} attempts: ${String(chunkError)}`);
  };

  const runBedrock = async () => {
    const chunks =
      selectedVariants.length > VARIANT_CHUNK_SIZE
        ? chunkArray(selectedVariants, VARIANT_CHUNK_SIZE)
        : [selectedVariants];
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

    return finalizeNormalized(normalizeParsed(merged));
  };

  const runOpenAI = async () => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const raw = await callOpenAI();
        try {
          return finalizeNormalized(normalizeParsed(parseRawProduct(raw)));
        } catch (error) {
          const note = error instanceof Error ? error.message : String(error);
          const repaired = await callOpenAIRepair(raw, note);
          return finalizeNormalized(normalizeParsed(parseRawProduct(repaired)));
        }
      } catch (error) {
        lastError = error;
        const backoff = Math.pow(2, attempt) * 200;
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
    throw new Error(
      `OpenAI enrichment failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
    );
  };

  if (provider === "bedrock") {
    return runBedrock();
  }

  return runOpenAI();
}

export const productEnrichmentPromptVersion = "v12.5";
export const productEnrichmentSchemaVersion = "v5";

export const toSlugLabel = (value: string) => slugify(value);
