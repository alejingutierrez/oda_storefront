import {
  CATEGORY_VALUES,
  SUBCATEGORY_BY_CATEGORY,
  SUBCATEGORY_VALUES,
} from "@/lib/product-enrichment/constants";
import {
  normalizeEnumArray,
  normalizeEnumValue,
  slugify,
} from "@/lib/product-enrichment/utils";
import {
  buildDescriptionSignals,
  cleanDescriptionForLLM,
} from "@/lib/product-enrichment/description-parser";
import {
  CATEGORY_KEYWORD_RULES,
  GENDER_KEYWORD_RULES,
  MATERIAL_KEYWORD_RULES,
  PATTERN_KEYWORD_RULES,
  hasAnyKeyword,
  type CategoryKeywordRule,
} from "@/lib/product-enrichment/keyword-dictionaries";

export type SignalStrength = "strong" | "moderate" | "weak";

export type HarvestedSignals = {
  nameKeywords: string[];
  nameCategory: string | null;
  nameSubcategory: string | null;
  nameProductType: string | null;
  descriptionMaterials: string[];
  descriptionCare: string[];
  descriptionMeasurements: string[];
  descriptionFeatures: string[];
  descriptionProductType: string | null;
  descriptionCleanText: string;
  vendorCategory: string | null;
  vendorTags: string[];
  vendorPlatform: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  inferredCategory: string | null;
  inferredSubcategory: string | null;
  inferredGender: string | null;
  inferredMaterials: string[];
  inferredPatterns: string[];
  signalStrength: SignalStrength;
  conflictingSignals: string[];
};

type SignalInput = {
  name: string;
  description: string | null | undefined;
  brandName?: string | null;
  metadata?: Record<string, unknown> | null;
  sourceUrl?: string | null;
  allowedCategoryValues?: string[];
  subcategoryByCategory?: Record<string, string[]>;
  allowedMaterialTags?: string[];
  allowedPatternTags?: string[];
};

type PlatformSignals = {
  vendorCategory: string | null;
  vendorTags: string[];
  vendorPlatform: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeName = (value: string) => {
  const stop = new Set(["de", "del", "la", "el", "los", "las", "con", "para", "y", "en"]);
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stop.has(token))
    .slice(0, 12);
};

const dedupe = (values: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const key = normalizeText(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });
  return output;
};

const looksLikePantsBotaFit = (text: string) => {
  const hasBottomWords = hasAnyKeyword(text, [
    "pantalon",
    "pantalones",
    "jogger",
    "cargo",
    "palazzo",
    "legging",
    "leggings",
    "jean",
    "jeans",
  ]);
  return hasBottomWords && hasAnyKeyword(text, ["bota", "botas"]);
};

const shouldIgnoreRule = (rule: CategoryKeywordRule, text: string) => {
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.productType === "collar" &&
    hasAnyKeyword(text, ["camisa", "blusa"]) &&
    !hasAnyKeyword(text, ["oro", "plata", "anillo", "arete", "joya"])
  ) {
    return true;
  }
  if (
    rule.category === "calzado" &&
    rule.keywords.some((keyword) => keyword === "bota" || keyword === "botas") &&
    looksLikePantsBotaFit(text)
  ) {
    const hasOtherShoeSignal = hasAnyKeyword(text, [
      "tenis",
      "sneaker",
      "sandalia",
      "mocasin",
      "loafer",
      "zapato",
      "botin",
    ]);
    if (!hasOtherShoeSignal) return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    rule.productType === "top" &&
    hasAnyKeyword(text, ["body cream", "body splash", "crema corporal", "locion", "locion corporal"])
  ) {
    return true;
  }
  return false;
};

const pickCategorySignal = (text: string, allowedCategories: string[]) => {
  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (shouldIgnoreRule(rule, text)) continue;
    if (!hasAnyKeyword(text, rule.keywords)) continue;
    const category = normalizeEnumValue(rule.category, allowedCategories);
    if (!category) continue;
    const allowedSubs = SUBCATEGORY_BY_CATEGORY[category] ?? [];
    const subcategory = rule.subcategory
      ? normalizeEnumValue(rule.subcategory, allowedSubs.length ? allowedSubs : SUBCATEGORY_VALUES)
      : null;
    return {
      category,
      subcategory,
      productType: rule.productType ?? rule.keywords[0] ?? null,
    };
  }
  return {
    category: null,
    subcategory: null,
    productType: null,
  };
};

const collectByRules = (text: string, rules: Array<{ key: string; keywords: string[] }>) => {
  const output: string[] = [];
  rules.forEach((rule) => {
    if (hasAnyKeyword(text, rule.keywords)) output.push(rule.key);
  });
  return output;
};

const readNestedObject = (
  root: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null => {
  if (!root) return null;
  const value = root[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toStringArray = (value: unknown) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const getPlatformSignals = (metadata: Record<string, unknown> | null | undefined): PlatformSignals => {
  const enrichment = readNestedObject(metadata ?? null, "enrichment");
  const originalVendorSignals = readNestedObject(enrichment, "original_vendor_signals");
  const base = originalVendorSignals ?? (metadata ?? null);
  const meta = readNestedObject(base, "meta");
  const vendorCategoryRaw =
    typeof base?.product_type === "string"
      ? base.product_type
      : typeof base?.category === "string"
        ? base.category
        : null;
  const vendorTags = dedupe(toStringArray(base?.tags));
  return {
    vendorCategory: vendorCategoryRaw ? String(vendorCategoryRaw).trim() : null,
    vendorTags,
    vendorPlatform: typeof base?.platform === "string" ? String(base.platform).trim().toLowerCase() : null,
    ogTitle: typeof meta?.["og:title"] === "string" ? String(meta["og:title"]).trim() : null,
    ogDescription:
      typeof meta?.["og:description"] === "string" ? String(meta["og:description"]).trim() : null,
  };
};

const resolveSignalStrength = (
  inferredCategory: string | null,
  vendorCategory: string | null,
  nameCategory: string | null,
  descriptionCategory: string | null,
  conflicts: string[],
): SignalStrength => {
  if (!inferredCategory) return "weak";
  const agrees = [vendorCategory, nameCategory, descriptionCategory].filter(
    (value) => value && value === inferredCategory,
  ).length;
  if (agrees >= 2 && conflicts.length === 0) return "strong";
  if (agrees >= 1 && conflicts.length <= 1) return "moderate";
  return "weak";
};

export const harvestProductSignals = (params: SignalInput): HarvestedSignals => {
  const allowedCategories = params.allowedCategoryValues?.length
    ? params.allowedCategoryValues
    : CATEGORY_VALUES;
  const allowedSubByCategory = params.subcategoryByCategory ?? SUBCATEGORY_BY_CATEGORY;
  const allowedMaterialTags = params.allowedMaterialTags ?? [];
  const allowedPatternTags = params.allowedPatternTags ?? [];

  const safeName = params.name ?? "";
  const descriptionSignals = buildDescriptionSignals(params.description);
  const descriptionCleanText = cleanDescriptionForLLM(params.description);
  const nameText = normalizeText(safeName);
  const descText = normalizeText(descriptionCleanText);

  const nameMatch = pickCategorySignal(nameText, allowedCategories);
  const descriptionMatch = pickCategorySignal(descText, allowedCategories);
  const platform = getPlatformSignals(params.metadata);

  const vendorCategory = normalizeEnumValue(platform.vendorCategory, allowedCategories);
  const vendorTagText = normalizeText(platform.vendorTags.join(" "));
  const vendorTagMatch = pickCategorySignal(vendorTagText, allowedCategories);

  const categoryCandidates = [vendorCategory, nameMatch.category, descriptionMatch.category, vendorTagMatch.category]
    .filter((value): value is string => Boolean(value));
  const candidateCounts = new Map<string, number>();
  categoryCandidates.forEach((value) => {
    candidateCounts.set(value, (candidateCounts.get(value) ?? 0) + 1);
  });

  const sortedCandidates = [...candidateCounts.entries()].sort((a, b) => b[1] - a[1]);
  const inferredCategory = sortedCandidates[0]?.[0] ?? null;
  const conflictingSignals = sortedCandidates.length > 1 ? sortedCandidates.slice(1).map((entry) => entry[0]) : [];

  const subCandidates = [nameMatch.subcategory, descriptionMatch.subcategory]
    .filter((value): value is string => Boolean(value));
  const inferredSubcategory = (() => {
    if (!inferredCategory) return null;
    const allowedSubs = allowedSubByCategory[inferredCategory] ?? [];
    if (!allowedSubs.length) return null;
    for (const sub of subCandidates) {
      const normalized = normalizeEnumValue(sub, allowedSubs);
      if (normalized) return normalized;
    }
    return null;
  })();

  const inferredGender = normalizeEnumValue(
    collectByRules(`${nameText} ${descText} ${vendorTagText}`, GENDER_KEYWORD_RULES)[0] ?? null,
    ["masculino", "femenino", "no_binario_unisex", "infantil"],
  );

  const materialSignals = dedupe([
    ...collectByRules(`${nameText} ${descText} ${vendorTagText}`, MATERIAL_KEYWORD_RULES),
    ...descriptionSignals.materials.map((entry) => slugify(entry)),
  ]);
  const inferredMaterials = allowedMaterialTags.length
    ? normalizeEnumArray(materialSignals, allowedMaterialTags)
    : materialSignals.slice(0, 6);

  const patternSignals = dedupe(
    collectByRules(`${nameText} ${descText} ${vendorTagText}`, PATTERN_KEYWORD_RULES),
  );
  const inferredPatterns = allowedPatternTags.length
    ? normalizeEnumArray(patternSignals, allowedPatternTags)
    : patternSignals.slice(0, 4);

  const signalStrength = resolveSignalStrength(
    inferredCategory,
    vendorCategory,
    nameMatch.category,
    descriptionMatch.category,
    conflictingSignals,
  );

  return {
    nameKeywords: tokenizeName(safeName),
    nameCategory: nameMatch.category,
    nameSubcategory: nameMatch.subcategory,
    nameProductType: nameMatch.productType,
    descriptionMaterials: descriptionSignals.materials,
    descriptionCare: descriptionSignals.care,
    descriptionMeasurements: descriptionSignals.measurements,
    descriptionFeatures: descriptionSignals.features,
    descriptionProductType: descriptionMatch.productType,
    descriptionCleanText,
    vendorCategory,
    vendorTags: platform.vendorTags,
    vendorPlatform: platform.vendorPlatform,
    ogTitle: platform.ogTitle,
    ogDescription: platform.ogDescription,
    inferredCategory,
    inferredSubcategory,
    inferredGender,
    inferredMaterials,
    inferredPatterns,
    signalStrength,
    conflictingSignals,
  };
};

export const buildSignalPayloadForPrompt = (signals: HarvestedSignals) => ({
  vendor_category: signals.vendorCategory,
  vendor_tags: signals.vendorTags,
  vendor_platform: signals.vendorPlatform,
  og_title: signals.ogTitle,
  og_description: signals.ogDescription,
  detected_product_type: signals.nameProductType ?? signals.descriptionProductType,
  detected_materials: signals.inferredMaterials,
  detected_patterns: signals.inferredPatterns,
  detected_care: signals.descriptionCare,
  detected_measurements: signals.descriptionMeasurements,
  detected_features: signals.descriptionFeatures,
  description_clean: signals.descriptionCleanText,
  inferred_category: signals.inferredCategory,
  inferred_subcategory: signals.inferredSubcategory,
  inferred_gender: signals.inferredGender,
  signal_strength: signals.signalStrength,
  conflicts: signals.conflictingSignals,
});
