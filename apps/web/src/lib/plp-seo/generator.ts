import "server-only";

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildWhere, type CatalogFilters } from "@/lib/catalog-query";
import { getCatalogCounts, getCatalogFacetsLite } from "@/lib/catalog-data";
import { labelize, labelizeSubcategory, normalizeGender, type GenderKey, GENDER_ROUTE } from "@/lib/navigation";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";
import { invokePlpSeoBedrockTool, plpSeoBedrockModelId } from "@/lib/plp-seo/bedrock";
import { normalizePlpPath } from "@/lib/plp-seo/store";

export const plpSeoProvider = "bedrock";
export const plpSeoPromptVersion = "plp-seo:v1";
export const plpSeoSchemaVersion = "1";

const MAX_RETRIES = Math.max(1, Number(process.env.PLP_SEO_MAX_RETRIES ?? 3));
const SAMPLE_LIMIT = Math.max(20, Number(process.env.PLP_SEO_SAMPLE_PRODUCTS ?? 100));

const emojiRe =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

const OutputSchema = z.object({
  metaTitle: z.string(),
  metaDescription: z.string(),
  subtitle: z.string(),
  keywords: z.array(z.string()).optional(),
});

function normalizeLine(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function hashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function truncate(value: string | null | undefined, max: number) {
  const raw = String(value ?? "");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function genderKeyFromSlug(slug: string): GenderKey | null {
  const cleaned = String(slug || "").trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned !== "femenino" && cleaned !== "masculino" && cleaned !== "unisex" && cleaned !== "infantil") return null;
  return normalizeGender(cleaned);
}

function validateCopy(candidate: { metaTitle: string; metaDescription: string; subtitle: string }) {
  const errors: string[] = [];
  const metaTitle = normalizeLine(candidate.metaTitle);
  const metaDescription = normalizeLine(candidate.metaDescription);
  const subtitle = normalizeLine(candidate.subtitle);

  if (!metaTitle) errors.push("metaTitle vacio");
  if (!metaDescription) errors.push("metaDescription vacio");
  if (!subtitle) errors.push("subtitle vacio");

  if (metaTitle.length > 70) errors.push(`metaTitle > 70 chars (${metaTitle.length})`);
  if (metaDescription.length < 120 || metaDescription.length > 160) {
    errors.push(`metaDescription fuera de 120-160 chars (${metaDescription.length})`);
  }
  if (subtitle.length < 90 || subtitle.length > 150) {
    errors.push(`subtitle fuera de 90-150 chars (${subtitle.length})`);
  }

  if (emojiRe.test(metaTitle)) errors.push("metaTitle contiene emojis");
  if (emojiRe.test(metaDescription)) errors.push("metaDescription contiene emojis");
  if (emojiRe.test(subtitle)) errors.push("subtitle contiene emojis");

  return { ok: errors.length === 0, errors, metaTitle, metaDescription, subtitle };
}

async function loadSampleProducts(filters: CatalogFilters, limit: number) {
  const where = buildWhere(filters);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      description: string | null;
      brandName: string;
      materialTags: string[] | null;
      patternTags: string[] | null;
      stylePrimary: string | null;
    }>
  >(Prisma.sql`
    select
      p.id,
      p.name,
      p.description,
      b.name as "brandName",
      p."materialTags" as "materialTags",
      p."patternTags" as "patternTags",
      p."stylePrimary" as "stylePrimary"
    from products p
    join brands b on b.id = p."brandId"
    ${where}
    order by random()
    limit ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    brand: row.brandName,
    name: truncate(row.name, 90),
    description: truncate(row.description, 140),
    material_tags: (row.materialTags ?? []).slice(0, 5),
    pattern_tags: (row.patternTags ?? []).slice(0, 5),
    style_primary: row.stylePrimary ?? null,
  }));
}

export async function generatePlpSeoCopy(params: {
  genderSlug: string;
  categoryKey?: string | null;
  subcategoryKey?: string | null;
}) {
  const genderKey = genderKeyFromSlug(params.genderSlug);
  if (!genderKey) throw new Error("invalid_gender");

  const genderSlug = GENDER_ROUTE[genderKey];
  const categoryKey = params.categoryKey?.trim() ? params.categoryKey.trim() : null;
  const subcategoryKey = params.subcategoryKey?.trim() ? params.subcategoryKey.trim() : null;
  if (subcategoryKey && !categoryKey) throw new Error("subcategory_requires_category");

  const path = normalizePlpPath(
    `/${genderSlug}${categoryKey ? `/${categoryKey}` : ""}${subcategoryKey ? `/${subcategoryKey}` : ""}`,
  );

  const filters: CatalogFilters = {
    genders: [genderKey],
    ...(categoryKey ? { categories: [categoryKey] } : {}),
    ...(subcategoryKey ? { subcategories: [subcategoryKey] } : {}),
    inStock: true,
    enrichedOnly: true,
  };

  const [taxonomy, counts, facets, sampleProducts] = await Promise.all([
    getPublishedTaxonomyOptions(),
    getCatalogCounts({ filters }),
    getCatalogFacetsLite(filters),
    loadSampleProducts(filters, SAMPLE_LIMIT),
  ]);

  const categoryLabel = categoryKey
    ? taxonomy.categoryLabels[categoryKey] ?? labelize(categoryKey)
    : null;
  const categoryDesc = (() => {
    if (!categoryKey) return null;
    const term = taxonomy.data.categories.find((entry) => entry.key === categoryKey);
    return term?.description ?? null;
  })();

  const subcategoryLabel = subcategoryKey
    ? taxonomy.subcategoryLabels[subcategoryKey] ?? labelizeSubcategory(subcategoryKey)
    : null;
  const subcategoryDesc = (() => {
    if (!categoryKey || !subcategoryKey) return null;
    const cat = taxonomy.data.categories.find((entry) => entry.key === categoryKey);
    const term = cat?.subcategories?.find((entry) => entry.key === subcategoryKey);
    return term?.description ?? null;
  })();

  const topBrands = (facets.brands ?? []).slice(0, 8).map((item) => ({ name: item.label, count: item.count }));
  const topMaterials = (facets.materials ?? []).slice(0, 8).map((item) => ({ tag: item.value, count: item.count }));
  const topPatterns = (facets.patterns ?? []).slice(0, 8).map((item) => ({ tag: item.value, count: item.count }));

  const input = {
    path,
    gender: genderKey,
    gender_slug: genderSlug,
    category: categoryKey ? { key: categoryKey, label: categoryLabel, description: categoryDesc } : null,
    subcategory: subcategoryKey ? { key: subcategoryKey, label: subcategoryLabel, description: subcategoryDesc } : null,
    counts,
    top_brands: topBrands,
    top_materials: topMaterials,
    top_patterns: topPatterns,
    sample_products: sampleProducts,
  };

  const inputHash = hashJson(input);

  const baseRules = [
    "Escribe en espanol neutro (Colombia OK), sin emojis.",
    'metaTitle: maximo 70 caracteres, incluye "ODA" una sola vez.',
    "metaDescription: entre 120 y 160 caracteres. Clara, sin relleno. No mencionar scraping/IA/GPT.",
    "subtitle: entre 90 y 150 caracteres. Visible bajo el H1. No debe ser identica a metaDescription.",
    "Evita promesas absolutas (ej: \"la mejor\"). Evita keyword stuffing.",
    "Menciona moda colombiana, inventario disponible y que redirigimos a tiendas oficiales (sin decir \"redirigimos\").",
  ];

  const systemPrompt = [
    "Eres un copywriter SEO senior para un agregador de moda colombiana llamado ODA.",
    "Tu salida debe ser 100% compatible con la herramienta (tool) solicitada.",
  ].join("\n");

  const buildUserText = (extra: { attempt: number; lastErrors?: string[]; prevJson?: unknown } = { attempt: 1 }) => {
    const header = extra.attempt === 1 ? "Genera SEO para esta PLP." : "Repara el SEO para esta PLP.";
    const issues =
      extra.lastErrors && extra.lastErrors.length
        ? `\n\nProblemas a corregir:\n- ${extra.lastErrors.join("\n- ")}\n`
        : "";
    const prev =
      extra.prevJson !== undefined
        ? `\n\nJSON anterior (para corregir):\n${JSON.stringify(extra.prevJson)}\n`
        : "";
    return [
      header,
      "",
      "Reglas:",
      ...baseRules.map((line) => `- ${line}`),
      issues.trimEnd(),
      prev.trimEnd(),
      "",
      "Contexto (JSON):",
      JSON.stringify(input),
    ]
      .filter((line) => line !== "")
      .join("\n");
  };

  let lastErr: string | null = null;
  let prevJson: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const userText = buildUserText(
      attempt === 1
        ? { attempt }
        : {
            attempt,
            lastErrors: lastErr ? [lastErr] : undefined,
            prevJson,
          },
    );

    const { toolInput } = await invokePlpSeoBedrockTool({ systemPrompt, userText });
    prevJson = toolInput;
    const parsed = OutputSchema.safeParse(toolInput);
    if (!parsed.success) {
      lastErr = `schema_invalido: ${parsed.error.message}`;
      continue;
    }

    const normalized = {
      metaTitle: normalizeLine(parsed.data.metaTitle),
      metaDescription: normalizeLine(parsed.data.metaDescription),
      subtitle: normalizeLine(parsed.data.subtitle),
      keywords: (parsed.data.keywords ?? []).map((value) => normalizeLine(value)).filter(Boolean).slice(0, 18),
    };

    const verdict = validateCopy(normalized);
    if (!verdict.ok) {
      lastErr = verdict.errors.join("; ");
      continue;
    }

    return {
      path,
      genderSlug,
      categoryKey,
      subcategoryKey,
      metaTitle: verdict.metaTitle,
      metaDescription: verdict.metaDescription,
      subtitle: verdict.subtitle,
      keywords: normalized.keywords,
      provider: plpSeoProvider,
      model: plpSeoBedrockModelId || "bedrock:unknown",
      promptVersion: plpSeoPromptVersion,
      schemaVersion: plpSeoSchemaVersion,
      inputHash,
      metadata: {
        counts,
        sampleSize: sampleProducts.length,
      } as Prisma.InputJsonValue,
    };
  }

  throw new Error(lastErr ?? "plp_seo_generation_failed");
}

