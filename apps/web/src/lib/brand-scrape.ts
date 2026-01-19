import crypto from "node:crypto";
import { Prisma, type Brand } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient } from "@/lib/openai";
import { loadBrandConstraints, type BrandConstraints } from "@/lib/brand-constraints";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const MAX_RETRIES = 3;

const brandPayloadSchema = z.object({
  name: z.string(),
  site_url: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  product_category: z.string().nullable(),
  market: z.string().nullable(),
  scale: z.string().nullable(),
  style: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  instagram: z.string().nullable(),
  tiktok: z.string().nullable(),
  facebook: z.string().nullable(),
  whatsapp: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  opening_hours: z.record(z.unknown()).nullable(),
});

const brandResponseSchema = z.object({
  brand: brandPayloadSchema,
  sources: z
    .object({
      website: z.string().nullable().optional(),
      instagram: z.string().nullable().optional(),
      tiktok: z.string().nullable().optional(),
      facebook: z.string().nullable().optional(),
      other: z.array(z.string()).optional(),
    })
    .optional(),
});

type BrandEnrichmentResponse = z.infer<typeof brandResponseSchema> & {
  raw?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type WebsiteSignals = {
  title?: string;
  description?: string;
  emails?: string[];
  phones?: string[];
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  whatsapp?: string;
  links?: string[];
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

const normalizeUrl = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
};

const normalizeEmail = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const normalizeWhatsApp = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `https://wa.me/${digits}`;
  }
  return normalizeUrl(trimmed);
};

const stripCitations = (value: string) =>
  value
    .replace(/\s*\[\d+\]\s*/g, " ")
    .replace(/\s*\(\d+\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const cleanStrings = <T>(input: T): T => {
  if (Array.isArray(input)) {
    return input.map((item) => cleanStrings(item)) as T;
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    Object.keys(obj).forEach((key) => {
      obj[key] = cleanStrings(obj[key]);
    });
    return input;
  }
  if (typeof input === "string") {
    return stripCitations(input) as T;
  }
  return input;
};

const normalizeEnumValue = (
  value: string | null | undefined,
  allowed: string[],
) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (allowed.includes(trimmed)) return trimmed;
  const normalized = slugify(trimmed);
  const match = allowed.find((entry) => slugify(entry) === normalized);
  return match ?? null;
};

const buildPrompt = (brand: Brand, constraints: BrandConstraints) => {
  const constraintPayload = {
    category: constraints.category,
    product_category: constraints.productCategory,
    market: constraints.market,
    scale: constraints.scale,
    style: constraints.style,
    city: constraints.city,
  };

  const schemaExample = {
    brand: {
      name: brand.name,
      site_url: "https://...",
      description: "...",
      category: null,
      product_category: null,
      market: null,
      scale: null,
      style: null,
      contact_phone: null,
      contact_email: null,
      instagram: null,
      tiktok: null,
      facebook: null,
      whatsapp: null,
      address: null,
      city: null,
      lat: null,
      lng: null,
      opening_hours: null,
    },
    sources: {
      website: null,
      instagram: null,
      tiktok: null,
      facebook: null,
      other: [],
    },
  };

  const systemPrompt = `Eres un sistema de enriquecimiento de marcas de moda colombiana.
Devuelve SOLO JSON válido siguiendo exactamente el esquema. No incluyas texto adicional.
Reglas estrictas:
- Usa EXCLUSIVAMENTE los valores permitidos para category, product_category, market, scale, style y city. Si no hay match exacto, devuelve null.
- No inventes datos. Si no hay evidencia clara, devuelve null.
- URLs siempre con esquema https.
- Si la marca es solo online, usa un valor de city que exista en la lista (Online/On-line/etc.).
- Si no encuentras evidencia nueva pero el valor actual parece consistente, conserva el valor actual.`;

  const userPrompt = `Marca a investigar: ${brand.name}

Datos actuales (puedes corregirlos):
${JSON.stringify(
    {
      site_url: brand.siteUrl ?? null,
      description: brand.description ?? null,
      category: brand.category ?? null,
      product_category: brand.productCategory ?? null,
      market: brand.market ?? null,
      scale: brand.scale ?? null,
      style: brand.style ?? null,
      contact_phone: brand.contactPhone ?? null,
      contact_email: brand.contactEmail ?? null,
      instagram: brand.instagram ?? null,
      tiktok: brand.tiktok ?? null,
      facebook: brand.facebook ?? null,
      whatsapp: brand.whatsapp ?? null,
      address: brand.address ?? null,
      city: brand.city ?? null,
      lat: brand.lat ? Number(brand.lat) : null,
      lng: brand.lng ? Number(brand.lng) : null,
      opening_hours: brand.openingHours ?? null,
    },
    null,
    2,
  )}

Valores permitidos (usar EXACTAMENTE):
${JSON.stringify(constraintPayload, null, 2)}

Devuelve JSON con este esquema de ejemplo:
${JSON.stringify(schemaExample, null, 2)}`;

  return { systemPrompt, userPrompt };
};

const extractOutputText = (response: any) => {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }
  const message = Array.isArray(response?.output)
    ? response.output.find((item: any) => item.type === "message")
    : null;
  const content = message?.content?.find((item: any) => item.type === "output_text" || item.type === "text");
  return content?.text ?? "";
};

const safeJsonParse = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
};

const extractWebsiteSignals = (html: string): WebsiteSignals => {
  const result: WebsiteSignals = {};
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch?.[1]) result.title = titleMatch[1].trim();

  const descriptionMatch = html.match(
    /<meta[^>]+(?:name|property)=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  );
  if (descriptionMatch?.[1]) result.description = descriptionMatch[1].trim();

  const emails = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (emails?.length) result.emails = Array.from(new Set(emails.map((email) => email.toLowerCase())));

  const phoneMatches = html.match(/\+?\d[\d\s().-]{7,}\d/g);
  if (phoneMatches?.length) {
    result.phones = Array.from(new Set(phoneMatches.map((phone) => phone.trim())));
  }

  const links = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((match) => match[1]);
  const absoluteLinks = links
    .map((link) => link.trim())
    .filter((link) => link.startsWith("http"));

  result.links = Array.from(new Set(absoluteLinks));

  const findLink = (domain: string) =>
    result.links?.find((link) => link.toLowerCase().includes(domain));

  result.instagram = findLink("instagram.com");
  result.tiktok = findLink("tiktok.com");
  result.facebook = findLink("facebook.com");
  result.whatsapp = findLink("wa.me") ?? findLink("api.whatsapp.com");

  return result;
};

const fetchWebsiteSignals = async (url: string | null | undefined) => {
  const normalized = normalizeUrl(url ?? "");
  if (!normalized) return null;
  try {
    const response = await fetch(normalized, {
      headers: {
        "User-Agent": process.env.USER_AGENT ?? "ODA-Storefront-Scraper/0.1",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;
    const text = await response.text();
    return extractWebsiteSignals(text.slice(0, 200_000));
  } catch (error) {
    console.warn("brand.scrape.website_failed", normalized, error);
    return null;
  }
};

export async function enrichBrandWithOpenAI(brand: Brand, constraints: BrandConstraints) {
  const { systemPrompt, userPrompt } = buildPrompt(brand, constraints);
  const client = getOpenAIClient() as any;

  let lastError: unknown = null;
  const toolChains = process.env.OPENAI_WEB_SEARCH === "false"
    ? [undefined]
    : [[{ type: "web_search" }], undefined];

  for (const tools of toolChains) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await client.responses.create({
          model: OPENAI_MODEL,
          tools,
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          text: { format: { type: "json_object" } },
        });

        const raw = extractOutputText(response);
        if (!raw) throw new Error("Respuesta vacía de OpenAI");

        const parsed = safeJsonParse(raw);
        const cleaned = cleanStrings(parsed);
        const validation = brandResponseSchema.safeParse(cleaned);
        if (!validation.success) {
          throw new Error(`JSON validation failed: ${validation.error.message}`);
        }

        return {
          ...validation.data,
          raw,
          usage: response?.usage,
        } as BrandEnrichmentResponse;
      } catch (error) {
        lastError = error;
        const backoff = Math.pow(2, attempt) * 200;
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
  }

  throw new Error(
    `OpenAI brand enrichment failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

const mergeBrandSignals = (
  base: BrandEnrichmentResponse["brand"],
  website: WebsiteSignals | null,
): BrandEnrichmentResponse["brand"] => {
  if (!website) return base;

  return {
    ...base,
    description: base.description ?? website.description ?? website.title ?? null,
    contact_email: base.contact_email ?? website.emails?.[0] ?? null,
    contact_phone: base.contact_phone ?? website.phones?.[0] ?? null,
    instagram: base.instagram ?? website.instagram ?? null,
    tiktok: base.tiktok ?? website.tiktok ?? null,
    facebook: base.facebook ?? website.facebook ?? null,
    whatsapp: base.whatsapp ?? website.whatsapp ?? null,
  };
};

const normalizeBrandOutput = (output: BrandEnrichmentResponse["brand"], constraints: BrandConstraints) => {
  return {
    ...output,
    site_url: normalizeUrl(output.site_url),
    contact_email: normalizeEmail(output.contact_email),
    instagram: normalizeUrl(output.instagram),
    tiktok: normalizeUrl(output.tiktok),
    facebook: normalizeUrl(output.facebook),
    whatsapp: normalizeWhatsApp(output.whatsapp),
    category: normalizeEnumValue(output.category, constraints.category),
    product_category: normalizeEnumValue(output.product_category, constraints.productCategory),
    market: normalizeEnumValue(output.market, constraints.market),
    scale: normalizeEnumValue(output.scale, constraints.scale),
    style: normalizeEnumValue(output.style, constraints.style),
    city: normalizeEnumValue(output.city, constraints.city),
  };
};

export async function runBrandScrapeJob(brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new Error("Brand not found");

  const constraints = await loadBrandConstraints();
  const enrichment = await enrichBrandWithOpenAI(brand, constraints);

  const normalized = normalizeBrandOutput(enrichment.brand, constraints);
  const siteUrl = normalized.site_url ?? normalizeUrl(brand.siteUrl);
  const websiteSignals = await fetchWebsiteSignals(siteUrl);
  const merged = mergeBrandSignals(normalized, websiteSignals);

  const metadata = {
    ...(typeof brand.metadata === "object" && brand.metadata ? brand.metadata : {}),
    brand_scrape: {
      run_id: crypto.randomUUID(),
      model: OPENAI_MODEL,
      ran_at: new Date().toISOString(),
      usage: enrichment.usage ?? null,
      sources: enrichment.sources ?? null,
      website_signals: websiteSignals ?? null,
    },
  } as Prisma.InputJsonValue;

  const openingHours =
    merged.opening_hours != null
      ? (merged.opening_hours as Prisma.InputJsonValue)
      : Prisma.DbNull;

  const updated = await prisma.brand.update({
    where: { id: brandId },
    data: {
      siteUrl: merged.site_url,
      description: merged.description,
      category: merged.category,
      productCategory: merged.product_category,
      market: merged.market,
      scale: merged.scale,
      style: merged.style,
      contactPhone: merged.contact_phone,
      contactEmail: merged.contact_email,
      instagram: merged.instagram,
      tiktok: merged.tiktok,
      facebook: merged.facebook,
      whatsapp: merged.whatsapp,
      address: merged.address,
      city: merged.city,
      lat: merged.lat,
      lng: merged.lng,
      openingHours,
      metadata,
    },
  });

  return { updated, enrichment };
}
