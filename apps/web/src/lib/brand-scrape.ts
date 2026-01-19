import crypto from "node:crypto";
import { Prisma, type Brand } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient } from "@/lib/openai";
import { loadBrandConstraints, type BrandConstraints } from "@/lib/brand-constraints";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const MAX_RETRIES = 3;
const MAX_WEBSITE_PAGES = 4;
const SOCIAL_HOSTS = [
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "youtube.com",
  "linkedin.com",
  "pinterest.com",
  "twitter.com",
  "x.com",
];
const CONTACT_KEYWORDS = [
  "contacto",
  "contact",
  "tienda",
  "store",
  "ubicacion",
  "location",
  "direccion",
  "about",
  "nosotros",
  "acerca",
  "servicio",
  "soporte",
  "ayuda",
  "faq",
];

const brandPayloadSchema = z.object({
  name: z.string(),
  site_url: z.string().nullable(),
  logo_url: z.string().nullable(),
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
  searchSources?: Array<{ url: string; title?: string; source?: string }>;
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
  logoUrl?: string;
  lat?: number;
  lng?: number;
  address?: string;
};

type BrandSnapshot = {
  siteUrl: string | null;
  logoUrl: string | null;
  description: string | null;
  category: string | null;
  productCategory: string | null;
  market: string | null;
  scale: string | null;
  style: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  instagram: string | null;
  tiktok: string | null;
  facebook: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  openingHours: Record<string, unknown> | null;
};

type BrandChange = {
  field: keyof BrandSnapshot;
  before: BrandSnapshot[keyof BrandSnapshot];
  after: BrandSnapshot[keyof BrandSnapshot];
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

const cleanHost = (value: string) => value.replace(/^www\./i, "").toLowerCase();

const isSameSite = (baseHost: string, candidateHost: string) => {
  const base = cleanHost(baseHost);
  const candidate = cleanHost(candidateHost);
  return candidate === base || candidate.endsWith(`.${base}`) || base.endsWith(`.${candidate}`);
};

const pickOfficialSiteUrl = (
  sources: Array<{ url: string }>,
  brand: Brand,
) => {
  const nameSlug = slugify(brand.name).replace(/\s+/g, "");
  let best: { url: string; score: number } | null = null;
  for (const entry of sources) {
    if (!entry.url) continue;
    let parsed: URL | null = null;
    try {
      parsed = new URL(entry.url);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (SOCIAL_HOSTS.some((domain) => host.includes(domain))) continue;
    const score =
      (nameSlug && host.includes(nameSlug) ? 3 : 0) +
      (nameSlug && parsed.pathname.toLowerCase().includes(nameSlug) ? 1 : 0) +
      (parsed.pathname === "/" ? 1 : 0);
    if (!best || score > best.score) best = { url: entry.url, score };
  }
  return best?.url ?? null;
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

const resolveUrl = (value: string | null | undefined, baseUrl?: string | null) => {
  if (!value) return null;
  try {
    return baseUrl ? new URL(value, baseUrl).toString() : new URL(value).toString();
  } catch {
    return normalizeUrl(value);
  }
};

const toComparable = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number(value);
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
};

const diffSnapshots = (before: BrandSnapshot, after: BrandSnapshot): BrandChange[] => {
  const changes: BrandChange[] = [];
  (Object.keys(before) as Array<keyof BrandSnapshot>).forEach((field) => {
    const beforeValue = before[field];
    const afterValue = after[field];
    if (toComparable(beforeValue) !== toComparable(afterValue)) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
  });
  return changes;
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

const buildPrompt = (
  brand: Brand,
  constraints: BrandConstraints,
  context?: {
    websiteSignals?: WebsiteSignals | null;
    preSources?: Array<{ url: string; title?: string; source?: string }>;
  },
) => {
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
      logo_url: "https://...",
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
- Si no encuentras evidencia nueva pero el valor actual parece consistente, conserva el valor actual.
- Busca y devuelve al menos 10 resultados web (fuentes) para sustentar los datos.
- Identifica logo_url y coordenadas (lat/lng) de la tienda principal si están disponibles en fuentes confiables.`;

  const contextPayload = {
    website_signals: context?.websiteSignals
      ? {
          title: context.websiteSignals.title ?? null,
          description: context.websiteSignals.description ?? null,
          emails: context.websiteSignals.emails ?? null,
          phones: context.websiteSignals.phones ?? null,
          instagram: context.websiteSignals.instagram ?? null,
          tiktok: context.websiteSignals.tiktok ?? null,
          facebook: context.websiteSignals.facebook ?? null,
          whatsapp: context.websiteSignals.whatsapp ?? null,
          address: context.websiteSignals.address ?? null,
          lat: context.websiteSignals.lat ?? null,
          lng: context.websiteSignals.lng ?? null,
          logo_url: context.websiteSignals.logoUrl ?? null,
        }
      : null,
    pre_sources: context?.preSources?.slice(0, 12).map((entry) => entry.url) ?? [],
  };

  const userPrompt = `Marca a investigar: ${brand.name}

Datos actuales (puedes corregirlos):
${JSON.stringify(
    {
      site_url: brand.siteUrl ?? null,
      logo_url: brand.logoUrl ?? null,
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

Evidencia adicional detectada (no inventar, usar como guía):
${JSON.stringify(contextPayload, null, 2)}

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

const extractWebSources = (response: any) => {
  const outputs = Array.isArray(response?.output) ? response.output : [];
  const sources: Array<{ url: string; title?: string; source?: string }> = [];
  for (const item of outputs) {
    if (item?.type !== "web_search_call") continue;
    const found = item?.action?.sources ?? [];
    if (!Array.isArray(found)) continue;
    found.forEach((entry: any) => {
      if (typeof entry === "string") {
        sources.push({ url: entry });
        return;
      }
      if (entry?.url) {
        sources.push({ url: entry.url, title: entry.title, source: entry.source });
      }
    });
  }
  const unique = new Map<string, { url: string; title?: string; source?: string }>();
  sources.forEach((entry) => {
    if (!entry.url) return;
    if (!unique.has(entry.url)) unique.set(entry.url, entry);
  });
  return Array.from(unique.values());
};

const collectWebSources = async (brand: Brand) => {
  if (process.env.OPENAI_WEB_SEARCH === "false") return [];
  const client = getOpenAIClient() as any;
  const queries = [
    `${brand.name} marca moda Colombia`,
    `${brand.name} tienda oficial`,
    `${brand.name} instagram oficial`,
    `${brand.name} direccion tienda`,
    `${brand.name} logo marca`,
    `${brand.name} facebook oficial`,
    `${brand.name} sitio web`,
    `${brand.name} ubicacion tienda`,
    `${brand.name} contacto`,
    `${brand.name} direccion Colombia`,
    `${brand.name} tienda Bogota`,
  ];
  const collected = new Map<string, { url: string; title?: string; source?: string }>();

  for (const query of queries) {
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      tools: [{ type: "web_search" }],
      input: query,
      include: ["web_search_call.action.sources"],
    });
    const sources = extractWebSources(response);
    sources.forEach((source) => {
      if (source.url && !collected.has(source.url)) collected.set(source.url, source);
    });
    if (collected.size >= 10) break;
  }

  return Array.from(collected.values());
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

const parseJsonLd = (html: string) => {
  const scripts = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  );
  const objects: Array<Record<string, unknown>> = [];
  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object") objects.push(item as Record<string, unknown>);
        });
      } else if (parsed && typeof parsed === "object") {
        objects.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }
  return objects;
};

const flattenJsonLd = (value: unknown, acc: Array<Record<string, unknown>>) => {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJsonLd(item, acc));
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  acc.push(obj);
  if (Array.isArray(obj["@graph"])) {
    obj["@graph"].forEach((item) => flattenJsonLd(item, acc));
  }
  if (obj.mainEntity) flattenJsonLd(obj.mainEntity, acc);
  if (obj.itemListElement) flattenJsonLd(obj.itemListElement, acc);
};

const extractCoordsFromUrl = (url: string) => {
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const centerMatch = url.match(/[?&](?:center|q|ll|query)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  const pbMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const coords =
    (atMatch && [atMatch[1], atMatch[2]]) ||
    (centerMatch && [centerMatch[1], centerMatch[2]]) ||
    (pbMatch && [pbMatch[1], pbMatch[2]]);
  if (!coords) return null;
  const lat = Number(coords[0]);
  const lng = Number(coords[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
};

const extractWebsiteSignals = (html: string, baseUrl?: string | null): WebsiteSignals => {
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
    .map((link) => resolveUrl(link.trim(), baseUrl))
    .filter((link): link is string => !!link && link.startsWith("http"));

  result.links = Array.from(new Set(absoluteLinks));

  const findLink = (domain: string) =>
    result.links?.find((link) => link.toLowerCase().includes(domain));

  result.instagram = findLink("instagram.com");
  result.tiktok = findLink("tiktok.com");
  result.facebook = findLink("facebook.com");
  result.whatsapp = findLink("wa.me") ?? findLink("api.whatsapp.com");

  const jsonLdObjects = parseJsonLd(html);
  const flattened: Array<Record<string, unknown>> = [];
  flattenJsonLd(jsonLdObjects, flattened);
  const items = flattened.length ? flattened : jsonLdObjects;
  for (const obj of items) {
    const logo = obj.logo as string | undefined;
    const image = obj.image as string | undefined;
    const address = obj.address as Record<string, unknown> | string | undefined;
    const geo =
      (obj.geo as Record<string, unknown> | undefined) ??
      (obj.location as Record<string, unknown> | undefined)?.geo ??
      (obj.location as Record<string, unknown> | undefined);
    const sameAs = obj.sameAs as string[] | string | undefined;

    if (!result.logoUrl && logo) {
      result.logoUrl = resolveUrl(String(logo), baseUrl) ?? undefined;
    }
    if (!result.logoUrl && image) {
      result.logoUrl = resolveUrl(String(image), baseUrl) ?? undefined;
    }
    if (address && typeof address === "object") {
      const street = address.streetAddress ?? address.addressLocality ?? address.addressRegion;
      const country = address.addressCountry;
      if (!result.address && street) {
        result.address = [street, country].filter(Boolean).join(", ");
      }
    } else if (typeof address === "string" && !result.address) {
      result.address = address;
    }
    if (geo) {
      const geoRecord = geo as Record<string, unknown>;
      const latValue = geoRecord.latitude ?? geoRecord.lat;
      const lngValue = geoRecord.longitude ?? geoRecord.lng;
      const lat = latValue != null ? Number(latValue) : null;
      const lng = lngValue != null ? Number(lngValue) : null;
      if (lat && !Number.isNaN(lat)) result.lat = lat;
      if (lng && !Number.isNaN(lng)) result.lng = lng;
    }
    if (sameAs) {
      const links = Array.isArray(sameAs) ? sameAs : [sameAs];
      const resolved = links
        .map((link) => resolveUrl(link, baseUrl))
        .filter((link): link is string => !!link);
      if (resolved.length) {
        result.links = Array.from(new Set([...(result.links ?? []), ...resolved]));
      }
    }
  }

  const metaLogo =
    html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (!result.logoUrl && metaLogo) {
    result.logoUrl = resolveUrl(metaLogo, baseUrl) ?? undefined;
  }

  const iconMatch = html.match(/<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
  if (!result.logoUrl && iconMatch?.[1]) {
    result.logoUrl = resolveUrl(iconMatch[1], baseUrl) ?? undefined;
  }

  if (!result.logoUrl) {
    const imgMatches = Array.from(html.matchAll(/<img[^>]+>/gi));
    for (const match of imgMatches) {
      const tag = match[0];
      const isLogo = /logo/i.test(tag);
      if (!isLogo) continue;
      const srcMatch = tag.match(/src=["']([^"']+)["']/i);
      if (srcMatch?.[1]) {
        result.logoUrl = resolveUrl(srcMatch[1], baseUrl) ?? undefined;
        break;
      }
    }
  }

  const mapUrls = Array.from(
    html.matchAll(/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com)[^\"'\\s>]+/gi),
  ).map((match) => match[0]);
  const iframeUrls = Array.from(html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)).map(
    (match) => match[1],
  );
  const allMapUrls = Array.from(new Set([...mapUrls, ...iframeUrls]));
  for (const url of allMapUrls) {
    const coords = extractCoordsFromUrl(url);
    if (coords) {
      result.lat = result.lat ?? coords.lat;
      result.lng = result.lng ?? coords.lng;
      break;
    }
  }

  const metaLat =
    html.match(/<meta[^>]+property=["']place:location:latitude["'][^>]*content=["']([^"']+)["']/i)
      ?.[1] ??
    html.match(/<meta[^>]+name=["']geo.position["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+name=["']ICBM["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const metaLng =
    html.match(/<meta[^>]+property=["']place:location:longitude["'][^>]*content=["']([^"']+)["']/i)
      ?.[1];
  if (metaLat) {
    const parts = metaLat.split(/[;,]/).map((val) => val.trim());
    if (parts.length >= 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (!Number.isNaN(lat)) result.lat = result.lat ?? lat;
      if (!Number.isNaN(lng)) result.lng = result.lng ?? lng;
    } else if (metaLng) {
      const lat = Number(metaLat);
      const lng = Number(metaLng);
      if (!Number.isNaN(lat)) result.lat = result.lat ?? lat;
      if (!Number.isNaN(lng)) result.lng = result.lng ?? lng;
    }
  }

  if (!result.lat || !result.lng) {
    const dataLat = html.match(/data-(?:lat|latitude)=["'](-?\d+\.\d+)["']/i)?.[1];
    const dataLng = html.match(/data-(?:lng|longitude)=["'](-?\d+\.\d+)["']/i)?.[1];
    if (dataLat && dataLng) {
      const lat = Number(dataLat);
      const lng = Number(dataLng);
      if (!Number.isNaN(lat)) result.lat = result.lat ?? lat;
      if (!Number.isNaN(lng)) result.lng = result.lng ?? lng;
    }
  }

  return result;
};

const mergeWebsiteSignals = (
  base: WebsiteSignals | null,
  incoming: WebsiteSignals | null,
): WebsiteSignals | null => {
  if (!base) return incoming;
  if (!incoming) return base;
  return {
    title: base.title ?? incoming.title,
    description: base.description ?? incoming.description,
    emails: base.emails?.length ? base.emails : incoming.emails,
    phones: base.phones?.length ? base.phones : incoming.phones,
    instagram: base.instagram ?? incoming.instagram,
    tiktok: base.tiktok ?? incoming.tiktok,
    facebook: base.facebook ?? incoming.facebook,
    whatsapp: base.whatsapp ?? incoming.whatsapp,
    links: Array.from(new Set([...(base.links ?? []), ...(incoming.links ?? [])])),
    logoUrl: base.logoUrl ?? incoming.logoUrl,
    lat: base.lat ?? incoming.lat,
    lng: base.lng ?? incoming.lng,
    address: base.address ?? incoming.address,
  };
};

const fetchWebsiteSignals = async (url: string | null | undefined) => {
  const normalized = normalizeUrl(url ?? "");
  if (!normalized) return null;
  const baseHost = new URL(normalized).hostname;
  const visited = new Set<string>();
  const queue = [normalized];
  let aggregated: WebsiteSignals | null = null;
  let fetched = 0;

  while (queue.length && fetched < MAX_WEBSITE_PAGES) {
    const nextUrl = queue.shift();
    if (!nextUrl || visited.has(nextUrl)) continue;
    visited.add(nextUrl);
    try {
      const response = await fetch(nextUrl, {
        headers: {
          "User-Agent": process.env.USER_AGENT ?? "ODA-Storefront-Scraper/0.1",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) continue;
      const text = await response.text();
      const signals = extractWebsiteSignals(text.slice(0, 200_000), response.url);
      aggregated = mergeWebsiteSignals(aggregated, signals);
      fetched += 1;

      if (!signals.links || fetched >= MAX_WEBSITE_PAGES) continue;
      const candidates = signals.links
        .filter((link) => {
          try {
            const parsed = new URL(link);
            if (!isSameSite(baseHost, parsed.hostname)) return false;
            if (SOCIAL_HOSTS.some((domain) => parsed.hostname.includes(domain))) return false;
            return CONTACT_KEYWORDS.some((keyword) => parsed.pathname.toLowerCase().includes(keyword));
          } catch {
            return false;
          }
        })
        .slice(0, MAX_WEBSITE_PAGES);

      candidates.forEach((candidate) => {
        if (!visited.has(candidate) && !queue.includes(candidate)) {
          queue.push(candidate);
        }
      });
    } catch (error) {
      console.warn("brand.scrape.website_failed", nextUrl, error);
    }
  }

  return aggregated;
};

export async function enrichBrandWithOpenAI(
  brand: Brand,
  constraints: BrandConstraints,
  context?: {
    websiteSignals?: WebsiteSignals | null;
    preSources?: Array<{ url: string; title?: string; source?: string }>;
  },
) {
  const preSources = context?.preSources ?? (await collectWebSources(brand));
  const { systemPrompt, userPrompt } = buildPrompt(brand, constraints, {
    websiteSignals: context?.websiteSignals,
    preSources,
  });
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
          include: ["web_search_call.action.sources"],
        });

        const raw = extractOutputText(response);
        if (!raw) throw new Error("Respuesta vacía de OpenAI");

        const parsed = safeJsonParse(raw);
        const cleaned = cleanStrings(parsed);
        const validation = brandResponseSchema.safeParse(cleaned);
        if (!validation.success) {
          throw new Error(`JSON validation failed: ${validation.error.message}`);
        }
        const searchSources = [...preSources, ...extractWebSources(response)];

        return {
          ...validation.data,
          raw,
          searchSources,
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
    logo_url: base.logo_url ?? website.logoUrl ?? null,
    description: base.description ?? website.description ?? website.title ?? null,
    contact_email: base.contact_email ?? website.emails?.[0] ?? null,
    contact_phone: base.contact_phone ?? website.phones?.[0] ?? null,
    instagram: base.instagram ?? website.instagram ?? null,
    tiktok: base.tiktok ?? website.tiktok ?? null,
    facebook: base.facebook ?? website.facebook ?? null,
    whatsapp: base.whatsapp ?? website.whatsapp ?? null,
    address: base.address ?? website.address ?? null,
    lat: base.lat ?? website.lat ?? null,
    lng: base.lng ?? website.lng ?? null,
  };
};

const fallbackToExisting = (
  merged: BrandEnrichmentResponse["brand"],
  brand: Brand,
  constraints: BrandConstraints,
) => {
  return {
    ...merged,
    site_url: merged.site_url ?? normalizeUrl(brand.siteUrl),
    logo_url: merged.logo_url ?? normalizeUrl(brand.logoUrl),
    description: merged.description ?? brand.description ?? null,
    category:
      merged.category ?? normalizeEnumValue(brand.category ?? null, constraints.category),
    product_category:
      merged.product_category ??
      normalizeEnumValue(brand.productCategory ?? null, constraints.productCategory),
    market: merged.market ?? normalizeEnumValue(brand.market ?? null, constraints.market),
    scale: merged.scale ?? normalizeEnumValue(brand.scale ?? null, constraints.scale),
    style: merged.style ?? normalizeEnumValue(brand.style ?? null, constraints.style),
    contact_phone: merged.contact_phone ?? brand.contactPhone ?? null,
    contact_email: merged.contact_email ?? brand.contactEmail ?? null,
    instagram: merged.instagram ?? normalizeUrl(brand.instagram),
    tiktok: merged.tiktok ?? normalizeUrl(brand.tiktok),
    facebook: merged.facebook ?? normalizeUrl(brand.facebook),
    whatsapp: merged.whatsapp ?? normalizeWhatsApp(brand.whatsapp),
    address: merged.address ?? brand.address ?? null,
    city: merged.city ?? normalizeEnumValue(brand.city ?? null, constraints.city),
    lat: merged.lat ?? (brand.lat != null ? Number(brand.lat) : null),
    lng: merged.lng ?? (brand.lng != null ? Number(brand.lng) : null),
    opening_hours:
      merged.opening_hours ??
      (typeof brand.openingHours === "object" && brand.openingHours
        ? (brand.openingHours as Record<string, unknown>)
        : null),
  };
};

const normalizeBrandOutput = (output: BrandEnrichmentResponse["brand"], constraints: BrandConstraints) => {
  return {
    ...output,
    site_url: normalizeUrl(output.site_url),
    logo_url: normalizeUrl(output.logo_url),
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
  const preSources = await collectWebSources(brand);
  const candidateSiteUrl = normalizeUrl(brand.siteUrl) ?? pickOfficialSiteUrl(preSources, brand);
  const initialSignals = await fetchWebsiteSignals(candidateSiteUrl);
  const enrichment = await enrichBrandWithOpenAI(brand, constraints, {
    websiteSignals: initialSignals,
    preSources,
  });

  const normalized = normalizeBrandOutput(enrichment.brand, constraints);
  const siteUrl = normalized.site_url ?? candidateSiteUrl ?? normalizeUrl(brand.siteUrl);
  let websiteSignals = initialSignals;
  if (siteUrl && siteUrl !== candidateSiteUrl) {
    const secondarySignals = await fetchWebsiteSignals(siteUrl);
    websiteSignals = mergeWebsiteSignals(initialSignals, secondarySignals);
  }
  const merged = mergeBrandSignals(normalized, websiteSignals);
  const finalOutput = fallbackToExisting(merged, brand, constraints);

  const before: BrandSnapshot = {
    siteUrl: brand.siteUrl ?? null,
    logoUrl: brand.logoUrl ?? null,
    description: brand.description ?? null,
    category: brand.category ?? null,
    productCategory: brand.productCategory ?? null,
    market: brand.market ?? null,
    scale: brand.scale ?? null,
    style: brand.style ?? null,
    contactPhone: brand.contactPhone ?? null,
    contactEmail: brand.contactEmail ?? null,
    instagram: brand.instagram ?? null,
    tiktok: brand.tiktok ?? null,
    facebook: brand.facebook ?? null,
    whatsapp: brand.whatsapp ?? null,
    address: brand.address ?? null,
    city: brand.city ?? null,
    lat: brand.lat !== null && brand.lat !== undefined ? Number(brand.lat) : null,
    lng: brand.lng !== null && brand.lng !== undefined ? Number(brand.lng) : null,
    openingHours:
      typeof brand.openingHours === "object" && brand.openingHours
        ? (brand.openingHours as Record<string, unknown>)
        : null,
  };

  const after: BrandSnapshot = {
    siteUrl: finalOutput.site_url ?? null,
    logoUrl: finalOutput.logo_url ?? null,
    description: finalOutput.description ?? null,
    category: finalOutput.category ?? null,
    productCategory: finalOutput.product_category ?? null,
    market: finalOutput.market ?? null,
    scale: finalOutput.scale ?? null,
    style: finalOutput.style ?? null,
    contactPhone: finalOutput.contact_phone ?? null,
    contactEmail: finalOutput.contact_email ?? null,
    instagram: finalOutput.instagram ?? null,
    tiktok: finalOutput.tiktok ?? null,
    facebook: finalOutput.facebook ?? null,
    whatsapp: finalOutput.whatsapp ?? null,
    address: finalOutput.address ?? null,
    city: finalOutput.city ?? null,
    lat: finalOutput.lat ?? null,
    lng: finalOutput.lng ?? null,
    openingHours:
      finalOutput.opening_hours && typeof finalOutput.opening_hours === "object"
        ? (finalOutput.opening_hours as Record<string, unknown>)
        : null,
  };

  const changes = diffSnapshots(before, after);

  const metadata = {
    ...(typeof brand.metadata === "object" && brand.metadata ? brand.metadata : {}),
    brand_scrape: {
      run_id: crypto.randomUUID(),
      model: OPENAI_MODEL,
      ran_at: new Date().toISOString(),
      usage: enrichment.usage ?? null,
      sources: enrichment.sources ?? null,
      search_sources: enrichment.searchSources ?? null,
      website_signals: websiteSignals ?? null,
    },
  } as Prisma.InputJsonValue;

  const openingHours =
    finalOutput.opening_hours != null
      ? (finalOutput.opening_hours as Prisma.InputJsonValue)
      : Prisma.DbNull;

  const updated = await prisma.brand.update({
    where: { id: brandId },
    data: {
      siteUrl: finalOutput.site_url,
      logoUrl: finalOutput.logo_url,
      description: finalOutput.description,
      category: finalOutput.category,
      productCategory: finalOutput.product_category,
      market: finalOutput.market,
      scale: finalOutput.scale,
      style: finalOutput.style,
      contactPhone: finalOutput.contact_phone,
      contactEmail: finalOutput.contact_email,
      instagram: finalOutput.instagram,
      tiktok: finalOutput.tiktok,
      facebook: finalOutput.facebook,
      whatsapp: finalOutput.whatsapp,
      address: finalOutput.address,
      city: finalOutput.city,
      lat: finalOutput.lat,
      lng: finalOutput.lng,
      openingHours,
      metadata,
    },
  });

  return { updated, enrichment, changes, before, after };
}
