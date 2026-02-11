import {
  normalizeEnumArray,
  normalizeEnumValue,
} from "@/lib/product-enrichment/utils";
import type {
  HarvestedSignals,
  SignalStrength,
} from "@/lib/product-enrichment/signal-harvester";

type Variant = {
  variantId: string;
  sku?: string | null;
  colorHex: string;
  colorPantone: string;
  colorHexes: string[];
  colorPantones: string[];
  fit: string;
};

export type EnrichmentCandidate = {
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
  variants: Variant[];
};

type TaxonomyContext = {
  categoryValues: string[];
  subcategoryByCategory: Record<string, string[]>;
  materialTags: string[];
};

export type ConsistencyIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
};

export type ConsistencyAutoFix = {
  field: string;
  from: string;
  to: string;
};

export type EnrichmentConfidence = {
  category: number;
  subcategory: number;
  overall: number;
};

export type ConsistencyValidationResult = {
  enriched: EnrichmentCandidate;
  issues: ConsistencyIssue[];
  autoFixes: ConsistencyAutoFix[];
  reviewRequired: boolean;
  reviewReasons: string[];
  confidence: EnrichmentConfidence;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const dedupe = (values: string[]) => [...new Set(values.filter(Boolean))];

const isJewelryCategory = (category: string) => category === "joyeria_y_bisuteria";

const TEXTILE_ONLY_MATERIALS = new Set(["algodon", "denim", "lino", "seda", "lana"]);

const metalPriority = ["oro", "plata", "acero", "bronce", "cobre"];

const applyAutoFix = (
  working: EnrichmentCandidate,
  autoFixes: ConsistencyAutoFix[],
  field: string,
  nextValue: string,
) => {
  const current = String((working as Record<string, unknown>)[field] ?? "");
  if (current === nextValue) return;
  autoFixes.push({ field, from: current, to: nextValue });
  (working as Record<string, unknown>)[field] = nextValue;
};

const normalizeCategoryAndSubcategory = (
  working: EnrichmentCandidate,
  taxonomy: TaxonomyContext,
  autoFixes: ConsistencyAutoFix[],
) => {
  const category = normalizeEnumValue(working.category, taxonomy.categoryValues);
  if (category && category !== working.category) {
    applyAutoFix(working, autoFixes, "category", category);
  }
  const allowedSubs = taxonomy.subcategoryByCategory[working.category] ?? [];
  if (!allowedSubs.length) return;
  const normalizedSub = normalizeEnumValue(working.subcategory, allowedSubs);
  if (normalizedSub && normalizedSub !== working.subcategory) {
    applyAutoFix(working, autoFixes, "subcategory", normalizedSub);
  }
  if (!normalizeEnumValue(working.subcategory, allowedSubs)) {
    const fallbackSub = allowedSubs[0] ?? "";
    if (fallbackSub) {
      applyAutoFix(working, autoFixes, "subcategory", fallbackSub);
    }
  }
};

const calculateConfidence = (params: {
  signals: HarvestedSignals;
  issues: ConsistencyIssue[];
  enriched: EnrichmentCandidate;
  beforeFixCategory: string;
  beforeFixSubcategory: string;
}) => {
  const { signals, issues, enriched, beforeFixCategory, beforeFixSubcategory } = params;
  let category = 0.75;
  let subcategory = 0.72;
  let overall = 0.78;

  const matchesCategory = Boolean(signals.inferredCategory && signals.inferredCategory === enriched.category);
  const matchesSubcategory = Boolean(
    signals.inferredSubcategory && signals.inferredSubcategory === enriched.subcategory,
  );
  const hadCategoryChange = beforeFixCategory !== enriched.category;
  const hadSubcategoryChange = beforeFixSubcategory !== enriched.subcategory;
  const issueErrors = issues.filter((issue) => issue.severity === "error").length;
  const issueWarnings = issues.filter((issue) => issue.severity === "warning").length;

  if (signals.signalStrength === "strong") {
    category += 0.1;
    overall += 0.06;
  } else if (signals.signalStrength === "moderate") {
    category += 0.05;
    overall += 0.03;
  }
  if (matchesCategory) category += 0.1;
  if (matchesSubcategory) subcategory += 0.12;
  if (hadCategoryChange) category -= 0.06;
  if (hadSubcategoryChange) subcategory -= 0.04;
  if (signals.inferredMaterials.length && enriched.materialTags.length) {
    const overlap = enriched.materialTags.filter((tag) => signals.inferredMaterials.includes(tag)).length;
    if (overlap > 0) overall += 0.05;
  }
  category -= issueErrors * 0.14;
  subcategory -= issueErrors * 0.12;
  overall -= issueErrors * 0.16;
  category -= issueWarnings * 0.04;
  subcategory -= issueWarnings * 0.04;
  overall -= issueWarnings * 0.05;

  return {
    category: clamp01(Number(category.toFixed(3))),
    subcategory: clamp01(Number(subcategory.toFixed(3))),
    overall: clamp01(Number(overall.toFixed(3))),
  };
};

export const validateAndAutofixEnrichment = (params: {
  signals: HarvestedSignals;
  enriched: EnrichmentCandidate;
  taxonomy: TaxonomyContext;
  routeConfidence: "high" | "medium" | "low";
  routeReason: string;
}) => {
  const { signals, taxonomy } = params;
  const working: EnrichmentCandidate = {
    ...params.enriched,
    styleTags: [...params.enriched.styleTags],
    materialTags: [...params.enriched.materialTags],
    patternTags: [...params.enriched.patternTags],
    occasionTags: [...params.enriched.occasionTags],
    seoTags: [...params.enriched.seoTags],
    variants: params.enriched.variants.map((variant) => ({ ...variant })),
  };
  const autoFixes: ConsistencyAutoFix[] = [];
  const beforeFixCategory = working.category;
  const beforeFixSubcategory = working.subcategory;

  const inferredCategory = signals.inferredCategory;
  if (
    inferredCategory &&
    (signals.signalStrength === "strong" || params.routeConfidence === "high") &&
    inferredCategory !== working.category
  ) {
    applyAutoFix(working, autoFixes, "category", inferredCategory);
  }

  if (signals.inferredSubcategory) {
    const allowedForCurrent = taxonomy.subcategoryByCategory[working.category] ?? [];
    const normalizedSignalSub = normalizeEnumValue(signals.inferredSubcategory, allowedForCurrent);
    if (normalizedSignalSub && normalizedSignalSub !== working.subcategory) {
      applyAutoFix(working, autoFixes, "subcategory", normalizedSignalSub);
    }
  }

  normalizeCategoryAndSubcategory(working, taxonomy, autoFixes);

  const inferredMaterials = normalizeEnumArray(signals.inferredMaterials, taxonomy.materialTags);
  if (inferredMaterials.length) {
    const normalizedCurrent = normalizeEnumArray(working.materialTags, taxonomy.materialTags);
    const overlap = normalizedCurrent.filter((tag) => inferredMaterials.includes(tag));
    if (!overlap.length) {
      const next = dedupe([...inferredMaterials, ...normalizedCurrent]).slice(0, 3);
      const before = normalizedCurrent.join(",");
      const after = next.join(",");
      if (before !== after) {
        autoFixes.push({ field: "materialTags", from: before, to: after });
        working.materialTags = next;
      }
    } else {
      working.materialTags = normalizedCurrent.slice(0, 3);
    }
  }

  if (isJewelryCategory(working.category)) {
    const normalized = normalizeEnumArray(working.materialTags, taxonomy.materialTags);
    const containsTextile = normalized.some((tag) => TEXTILE_ONLY_MATERIALS.has(tag));
    if (containsTextile) {
      const metalFromSignals = metalPriority.find((tag) => inferredMaterials.includes(tag));
      if (metalFromSignals) {
        const next = dedupe([metalFromSignals, ...normalized.filter((tag) => !TEXTILE_ONLY_MATERIALS.has(tag))]).slice(
          0,
          3,
        );
        autoFixes.push({
          field: "materialTags",
          from: normalized.join(","),
          to: next.join(","),
        });
        working.materialTags = next;
      }
    }
  }

  const issues: ConsistencyIssue[] = [];
  const allowedSubs = taxonomy.subcategoryByCategory[working.category] ?? [];
  if (!normalizeEnumValue(working.category, taxonomy.categoryValues)) {
    issues.push({
      field: "category",
      severity: "error",
      message: `Categoria invalida: ${working.category}`,
      suggestion: "Ajustar category a una key permitida.",
    });
  }
  if (!normalizeEnumValue(working.subcategory, allowedSubs)) {
    issues.push({
      field: "subcategory",
      severity: "error",
      message: `Subcategoria invalida para ${working.category}: ${working.subcategory}`,
      suggestion: "Usar subcategoria permitida por category.",
    });
  }
  if (signals.signalStrength === "strong" && inferredCategory && inferredCategory !== working.category) {
    issues.push({
      field: "category",
      severity: "error",
      message: `Categoria final no coincide con senal fuerte (${inferredCategory}).`,
      suggestion: "Revisar clasificacion manualmente.",
    });
  }

  if (inferredMaterials.length) {
    const overlap = working.materialTags.filter((tag) => inferredMaterials.includes(tag));
    if (!overlap.length) {
      issues.push({
        field: "materialTags",
        severity: "warning",
        message: "Materiales finales no alinean con composicion textual detectada.",
        suggestion: "Revisar material_tags contra descripcion original.",
      });
    }
  }

  if (signals.conflictingSignals.length > 0) {
    issues.push({
      field: "signals",
      severity: "warning",
      message: `Hay senales conflictivas: ${signals.conflictingSignals.join(", ")}`,
      suggestion: "Priorizar revision humana si el resultado luce ambiguo.",
    });
  }

  const reviewReasons = issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.field}:${issue.message}`);
  const reviewRequired = reviewReasons.length > 0;

  const confidence = calculateConfidence({
    signals: signals as HarvestedSignals & { signalStrength: SignalStrength },
    issues,
    enriched: working,
    beforeFixCategory,
    beforeFixSubcategory,
  });

  return {
    enriched: working,
    issues,
    autoFixes,
    reviewRequired,
    reviewReasons,
    confidence,
  } as ConsistencyValidationResult;
};
