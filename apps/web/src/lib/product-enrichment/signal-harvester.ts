import {
  CATEGORY_VALUES,
  SUBCATEGORY_BY_CATEGORY,
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
  SUBCATEGORY_KEYWORD_RULES,
  hasAnyKeyword,
  scoreKeywordHits,
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
  inferredGenderConfidence: number;
  inferredGenderSupport: number;
  inferredGenderMargin: number;
  inferredGenderReasons: string[];
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
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoTags?: string[];
  currentCategory?: string | null;
  currentGender?: string | null;
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

type CategorySignalMatch = {
  category: string | null;
  subcategory: string | null;
  productType: string | null;
};

type CanonicalGender = "masculino" | "femenino" | "no_binario_unisex" | "infantil";

type GenderInferenceResult = {
  gender: CanonicalGender | null;
  confidence: number;
  support: number;
  margin: number;
  reasons: string[];
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const GENDER_VALUES: CanonicalGender[] = [
  "masculino",
  "femenino",
  "no_binario_unisex",
  "infantil",
];

const GENDER_NEUTRAL_CATEGORIES = new Set([
  "hogar_y_lifestyle",
  "gafas_y_optica",
]);

const CHILD_UNLIKELY_CATEGORIES = new Set([
  "hogar_y_lifestyle",
  "gafas_y_optica",
  "joyeria_y_bisuteria",
  "bolsos_y_marroquineria",
]);

const FEMALE_KEYWORDS = [
  "mujer",
  "women",
  "womens",
  "femenino",
  "femenina",
  "dama",
  "ladies",
];

const MALE_KEYWORDS = [
  "hombre",
  "men",
  "mens",
  "masculino",
  "masculina",
  "caballero",
];

const UNISEX_KEYWORDS = ["unisex", "genderless", "gender neutral", "neutral"];

// Child signals are noisy in fashion catalogs because "baby" is commonly used as a color/style
// (e.g. "baby blue", "baby tee") and "kids" can appear in marketing tags. For remaps we prefer
// conservative moves to `infantil` unless there is strong evidence.
const CHILD_HARD_KEYWORDS = [
  "infantil",
  "bebe",
  "bebé",
  "newborn",
  "toddler",
  "junior",
  "ninos",
  "ninas",
  "boys",
  "girls",
  "for kids",
  "para ninos",
  "para ninas",
  "diaper",
  "pañal",
];

const CHILD_SOFT_KEYWORDS = ["kids", "kid", "baby"];

const BABY_COLOR_PHRASES = [
  "baby blue",
  "baby pink",
  "baby rose",
  "baby rosa",
  "baby celeste",
  "baby lila",
  "baby green",
  "azul bebe",
  "rosa bebe",
  "celeste bebe",
  "lila bebe",
  "verde bebe",
];

const DIAPER_BAG_PHRASES = [
  "diaper bag",
  "diaper backpack",
  "bolso panalera",
  "panalera",
  "pañalera",
];

const inferGenderSignal = (params: {
  nameText: string;
  descriptionText: string;
  vendorTagText: string;
  seoTitleText: string;
  seoDescriptionText: string;
  seoTagText: string;
  currentCategory: string | null;
  inferredCategory: string | null;
  currentGender: string | null;
}): GenderInferenceResult => {
  const combinedText = [
    params.nameText,
    params.descriptionText,
    params.vendorTagText,
    params.seoTitleText,
    params.seoDescriptionText,
    params.seoTagText,
  ]
    .filter(Boolean)
    .join(" ");

  const categoryContext = params.inferredCategory ?? params.currentCategory ?? null;
  if (categoryContext && GENDER_NEUTRAL_CATEGORIES.has(categoryContext)) {
    return {
      gender: "no_binario_unisex",
      confidence: 0.93,
      support: 2,
      margin: 2.4,
      reasons: ["ctx:gender_neutral_category_forced"],
    };
  }

  if (hasAnyKeyword(combinedText, DIAPER_BAG_PHRASES)) {
    return {
      gender: "no_binario_unisex",
      confidence: 0.92,
      support: 2,
      margin: 2.2,
      reasons: ["ctx:diaper_bag_unisex_forced"],
    };
  }

  type Bucket = {
    score: number;
    reasons: Set<string>;
    sources: Set<string>;
  };
  const buckets = new Map<CanonicalGender, Bucket>(
    GENDER_VALUES.map((gender) => [
      gender,
      { score: 0, reasons: new Set<string>(), sources: new Set<string>() },
    ]),
  );

  const addScore = (
    gender: CanonicalGender,
    source: string,
    score: number,
    reason: string,
  ) => {
    if (score <= 0) return;
    const current = buckets.get(gender);
    if (!current) return;
    current.score += score;
    current.reasons.add(reason);
    current.sources.add(source);
  };

  const sources: Array<{ key: string; text: string; weight: number }> = [
    { key: "name", text: params.nameText, weight: 1.8 },
    { key: "description", text: params.descriptionText, weight: 1.15 },
    { key: "vendor_tags", text: params.vendorTagText, weight: 1.15 },
    { key: "seo_tags", text: params.seoTagText, weight: 1.9 },
    { key: "seo_title", text: params.seoTitleText, weight: 1.45 },
    { key: "seo_description", text: params.seoDescriptionText, weight: 1.05 },
  ];

  let hasExplicitUnisex = false;

  for (const source of sources) {
    const text = source.text;
    if (!text) continue;

    const hasFemale = hasAnyKeyword(text, FEMALE_KEYWORDS);
    const hasMale = hasAnyKeyword(text, MALE_KEYWORDS);
    const hasUnisex = hasAnyKeyword(text, UNISEX_KEYWORDS);
    const hasBebeToken = hasAnyKeyword(text, ["bebe", "bebé"]);
    const hasBabyColor = hasAnyKeyword(text, BABY_COLOR_PHRASES);
    const hasOtherHardChild = hasAnyKeyword(text, [
      "infantil",
      "newborn",
      "toddler",
      "junior",
      "ninos",
      "ninas",
      "boys",
      "girls",
      "for kids",
      "para ninos",
      "para ninas",
      "diaper",
      "pañal",
    ]);
    const hasChildHard = hasOtherHardChild || (hasBebeToken && !hasBabyColor);
    const hasChildSoft = hasAnyKeyword(text, CHILD_SOFT_KEYWORDS);
    const hasFemaleProduct = hasAnyKeyword(text, [
      "brasier",
      "bralette",
      "panty",
      "cachetero",
      "tanga",
      "brasilera",
      "bikini",
      "trikini",
      "liguero",
      "corset",
      "babydoll",
    ]);
    const hasMaleProduct = hasAnyKeyword(text, [
      "boxer",
      "brief",
      "briefs",
      "jockstrap",
      "suspensorio",
    ]);

    if (hasFemale) addScore("femenino", source.key, source.weight * 1.08, "kw:gender_female");
    if (hasMale) addScore("masculino", source.key, source.weight * 1.08, "kw:gender_male");
    if (hasFemaleProduct) addScore("femenino", source.key, source.weight * 0.85, "kw:gender_female_product");
    if (hasMaleProduct) addScore("masculino", source.key, source.weight * 0.85, "kw:gender_male_product");
    if (hasUnisex) {
      addScore("no_binario_unisex", source.key, source.weight * 1.35, "kw:gender_unisex");
      hasExplicitUnisex = true;
    }
    if (hasFemale && hasMale) {
      addScore(
        "no_binario_unisex",
        source.key,
        source.weight * 1.28,
        "rule:gender_mixed_binary",
      );
    }

    let childWeight = source.weight * 1.1;
    if (hasBabyColor) childWeight *= 0.12;
    // Never treat baby-color phrasing as an age signal.
    const allowSoftChild = hasChildSoft && !hasBabyColor;
    if (hasChildHard) {
      addScore(
        "infantil",
        source.key,
        childWeight,
        "kw:gender_child_hard",
      );
    } else if (allowSoftChild) {
      addScore("infantil", source.key, childWeight * 0.22, "kw:gender_child_soft");
    }
  }

  if (categoryContext && CHILD_UNLIKELY_CATEGORIES.has(categoryContext)) {
    addScore("no_binario_unisex", "context", 0.5, "ctx:child_unlikely_category");
  }
  if (params.currentGender === "no_binario_unisex") {
    addScore("no_binario_unisex", "context", 0.35, "ctx:current_unisex");
  }

  const ranked = [...buckets.entries()]
    .map(([gender, bucket]) => ({
      gender,
      score: bucket.score,
      reasons: [...bucket.reasons],
      sourceCount: bucket.sources.size,
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score <= 0.95) {
    return {
      gender: null,
      confidence: 0,
      support: 0,
      margin: 0,
      reasons: [],
    };
  }

  const secondScore = second?.score ?? 0;
  const margin = top.score / Math.max(0.2, secondScore);
  let confidence =
    0.4 +
    Math.min(0.25, top.score / 8) +
    Math.min(0.2, (margin - 1) * 0.15) +
    (top.sourceCount >= 2 ? 0.08 : 0);
  if (top.gender === "no_binario_unisex" && hasExplicitUnisex) confidence += 0.1;
  if (top.gender === "infantil" && top.sourceCount < 2) confidence -= 0.15;
  if (secondScore > 0 && secondScore / top.score >= 0.82) confidence -= 0.09;
  confidence = clamp(confidence, 0, 0.97);

  if (top.gender === "infantil" && top.score < 2.1) {
    return {
      gender: null,
      confidence: 0,
      support: 0,
      margin: 0,
      reasons: [],
    };
  }

  if (confidence < 0.57) {
    return {
      gender: null,
      confidence: 0,
      support: 0,
      margin: 0,
      reasons: [],
    };
  }

  return {
    gender: top.gender,
    confidence,
    support: top.sourceCount,
    margin,
    reasons: top.reasons.slice(0, 6),
  };
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchesWordWindow = (text: string, from: string, to: string, maxBetween: number) => {
  const pattern = new RegExp(
    `(^|\\s)${escapeRegExp(from)}(?:\\s+[a-z0-9]+){0,${maxBetween}}\\s+${escapeRegExp(to)}(?=\\s|$)`,
  );
  return pattern.test(text);
};

const hasDenimEvidence = (text: string) =>
  hasAnyKeyword(text, ["denim", "jean", "jeans", "indigo", "jort", "jorts"]);

const countJewelryPieceTypes = (text: string) => {
  const groups: string[][] = [
    ["arete", "aretes", "earring", "earrings", "pendiente", "pendientes"],
    ["collar", "collares", "cadena", "cadenas", "necklace", "choker", "gargantilla"],
    ["pulsera", "pulseras", "brazalete", "brazaletes", "bracelet", "bangle", "bangles"],
    ["anillo", "anillos", "ring", "rings"],
    ["tobillera", "tobilleras", "anklet", "anklets"],
    ["piercing", "piercings", "septum", "barbell", "labret", "helix"],
    ["broche", "broches", "prendedor", "prendedores", "pin"],
    ["reloj", "relojes", "watch", "watches"],
  ];
  let count = 0;
  for (const keywords of groups) {
    if (hasAnyKeyword(text, keywords)) count += 1;
  }
  return count;
};

const isCharmAccessoryForNeckwear = (text: string) => {
  const hasCharmLike = hasAnyKeyword(text, ["charm", "charms", "dije", "dijes", "colgante", "pendant"]);
  if (!hasCharmLike) return false;
  const targets = ["choker", "necklace", "collar", "cadena", "gargantilla"];
  for (const target of targets) {
    if (
      matchesWordWindow(text, "for", target, 3) ||
      matchesWordWindow(text, "para", target, 3) ||
      matchesWordWindow(text, "compatible", target, 3)
    ) {
      return true;
    }
  }
  return false;
};

const shouldIgnoreRule = (rule: CategoryKeywordRule, text: string) => {
  if (
    rule.category === "joyeria_y_bisuteria" &&
    hasAnyKeyword(text, ["collar", "collares", "gargantilla"]) &&
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
    rule.category === "conjuntos_y_sets_2_piezas" &&
    hasAnyKeyword(text, ["set", "sets", "conjunto", "conjuntos", "matching set", "co ord", "dos piezas", "2 piezas"])
  ) {
    const hasJewelrySignal = hasAnyKeyword(text, [
      "joyeria",
      "bisuteria",
      "charm",
      "dije",
      "dijes",
      "colgante",
      "collar",
      "cadena",
      "pulsera",
      "brazalete",
      "bangle",
      "arete",
      "anillo",
      "tobillera",
      "piercing",
      "reloj",
      "watch",
    ]);
    const hasApparelSignal = hasAnyKeyword(text, [
      "camisa",
      "blusa",
      "top",
      "pantalon",
      "pantalones",
      "falda",
      "short",
      "shorts",
      "bermuda",
      "vestido",
      "jogger",
      "legging",
      "hoodie",
      "buzo",
      "sueter",
      "sweater",
      "cardigan",
      "pijama",
    ]);
    if (hasJewelrySignal && !hasApparelSignal) return true;
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

const shouldIgnoreSubcategoryRule = (
  rule: { category: string; subcategory: string; keywords: string[] },
  text: string,
) => {
  if (rule.subcategory.includes("denim") && !hasDenimEvidence(text)) {
    return true;
  }
  if (
    rule.category === "shorts_y_bermudas" &&
    rule.subcategory === "biker_short" &&
    hasAnyKeyword(text, ["chaqueta", "jacket", "biker jacket"])
  ) {
    return true;
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "collares" &&
    hasAnyKeyword(text, ["camisa", "blusa"]) &&
    !hasAnyKeyword(text, ["oro", "plata", "anillo", "arete", "joya"])
  ) {
    return true;
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "collares" &&
    isCharmAccessoryForNeckwear(text)
  ) {
    return true;
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "dijes_charms" &&
    hasAnyKeyword(text, ["collar", "collares", "cadena", "cadenas", "necklace", "choker", "gargantilla"]) &&
    !isCharmAccessoryForNeckwear(text)
  ) {
    return true;
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "sets_de_joyeria" &&
    !hasAnyKeyword(text, ["set de joyas", "jewelry set"]) &&
    countJewelryPieceTypes(text) < 2
  ) {
    return true;
  }
  if (
    rule.category === "calzado" &&
    (rule.subcategory === "botas" || rule.subcategory === "botines") &&
    looksLikePantsBotaFit(text) &&
    !hasAnyKeyword(text, ["tenis", "sneaker", "sandalia", "mocasin", "loafer", "zapato", "botin"])
  ) {
    return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    rule.subcategory === "body_bodysuit" &&
    hasAnyKeyword(text, ["body cream", "body splash", "crema corporal", "locion", "locion corporal"])
  ) {
    return true;
  }
  return false;
};

const pickSubcategorySignal = (
  text: string,
  category: string,
  allowedSubByCategory: Record<string, string[]>,
) => {
  const allowedSubs = allowedSubByCategory[category] ?? [];
  if (!allowedSubs.length) return { subcategory: null, productType: null };

  const scoreBySubcategory = new Map<string, number>();
  const bestProductTypeBySubcategory = new Map<string, string | null>();

  SUBCATEGORY_KEYWORD_RULES.forEach((rule) => {
    if (rule.category !== category) return;
    if (shouldIgnoreSubcategoryRule(rule, text)) return;
    const subcategory = normalizeEnumValue(rule.subcategory, allowedSubs);
    if (!subcategory) return;
    const score = scoreKeywordHits(text, rule.keywords);
    if (score <= 0) return;
    scoreBySubcategory.set(subcategory, (scoreBySubcategory.get(subcategory) ?? 0) + score);
    if (!bestProductTypeBySubcategory.has(subcategory)) {
      bestProductTypeBySubcategory.set(subcategory, rule.productType ?? null);
    }
  });

  const ranked = [...scoreBySubcategory.entries()].sort((a, b) => b[1] - a[1]);
  const bestSubcategory = ranked[0]?.[0] ?? null;
  return {
    subcategory: bestSubcategory,
    productType: bestSubcategory ? (bestProductTypeBySubcategory.get(bestSubcategory) ?? null) : null,
  };
};

const pickCategorySignal = (
  text: string,
  allowedCategories: string[],
  allowedSubByCategory: Record<string, string[]>,
): CategorySignalMatch => {
  const scoreByCategory = new Map<string, number>();
  const bestRuleByCategory = new Map<string, CategoryKeywordRule>();
  const bestRuleScoreByCategory = new Map<string, number>();

  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (shouldIgnoreRule(rule, text)) continue;
    const category = normalizeEnumValue(rule.category, allowedCategories);
    if (!category) continue;
    const score = scoreKeywordHits(text, rule.keywords);
    if (score <= 0) continue;
    scoreByCategory.set(category, (scoreByCategory.get(category) ?? 0) + score);
    const previousBest = bestRuleScoreByCategory.get(category) ?? 0;
    if (score > previousBest) {
      bestRuleScoreByCategory.set(category, score);
      bestRuleByCategory.set(category, rule);
    }
  }

  const rankedCategories = [...scoreByCategory.entries()].sort((a, b) => b[1] - a[1]);
  const category = rankedCategories[0]?.[0] ?? null;
  if (!category) {
    return {
      category: null,
      subcategory: null,
      productType: null,
    };
  }

  const subcategorySignal = pickSubcategorySignal(text, category, allowedSubByCategory);
  if (subcategorySignal.subcategory) {
    return {
      category,
      subcategory: subcategorySignal.subcategory,
      productType: subcategorySignal.productType ?? bestRuleByCategory.get(category)?.productType ?? null,
    };
  }

  const bestRule = bestRuleByCategory.get(category);
  const allowedSubs = allowedSubByCategory[category] ?? [];
  const fallbackSubcategory = bestRule?.subcategory
    ? normalizeEnumValue(bestRule.subcategory, allowedSubs)
    : null;

  return {
    category,
    subcategory: fallbackSubcategory ?? null,
    productType: bestRule?.productType ?? null,
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
  const seoTitleText = normalizeText(params.seoTitle ?? "");
  const seoDescriptionText = normalizeText(params.seoDescription ?? "");
  const seoTagText = normalizeText((params.seoTags ?? []).join(" "));

  const nameMatch = pickCategorySignal(nameText, allowedCategories, allowedSubByCategory);
  const descriptionMatch = pickCategorySignal(descText, allowedCategories, allowedSubByCategory);
  const platform = getPlatformSignals(params.metadata);

  const vendorCategory = normalizeEnumValue(platform.vendorCategory, allowedCategories);
  const vendorTagText = normalizeText(platform.vendorTags.join(" "));
  const vendorTagMatch = pickCategorySignal(vendorTagText, allowedCategories, allowedSubByCategory);

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

  const genderInference = inferGenderSignal({
    nameText,
    descriptionText: descText,
    vendorTagText,
    seoTitleText,
    seoDescriptionText,
    seoTagText,
    currentCategory: normalizeEnumValue(params.currentCategory, allowedCategories),
    inferredCategory,
    currentGender: normalizeEnumValue(params.currentGender, GENDER_VALUES),
  });
  const genderFallbackText = `${nameText} ${descText} ${vendorTagText}`;
  let fallbackGender = normalizeEnumValue(
    collectByRules(genderFallbackText, GENDER_KEYWORD_RULES)[0] ?? null,
    GENDER_VALUES,
  );
  // Avoid interpreting "bebé/bebe" as infant when it's clearly part of a color phrase ("azul bebé", etc.).
  if (fallbackGender === "infantil" && hasAnyKeyword(genderFallbackText, BABY_COLOR_PHRASES)) {
    fallbackGender = null;
  }
  const inferredGender = genderInference.gender ?? fallbackGender;
  const inferredGenderConfidence = genderInference.gender
    ? genderInference.confidence
    : fallbackGender
      ? 0.61
      : 0;
  const inferredGenderSupport = genderInference.gender ? genderInference.support : fallbackGender ? 1 : 0;
  const inferredGenderMargin = genderInference.gender ? genderInference.margin : fallbackGender ? 1.01 : 0;
  const inferredGenderReasons = genderInference.gender
    ? genderInference.reasons
    : fallbackGender
      ? ["fallback:keyword_first_match"]
      : [];

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
    inferredGenderConfidence,
    inferredGenderSupport,
    inferredGenderMargin,
    inferredGenderReasons,
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
  inferred_gender_confidence: signals.inferredGenderConfidence,
  inferred_gender_reasons: signals.inferredGenderReasons,
  signal_strength: signals.signalStrength,
  conflicts: signals.conflictingSignals,
});
