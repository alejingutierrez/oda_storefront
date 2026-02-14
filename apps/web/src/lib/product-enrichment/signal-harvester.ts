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
    const hasOtherHardChild = hasAnyKeyword(text, CHILD_HARD_KEYWORDS);
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

const UNDERWEAR_EVIDENCE = [
  "ropa interior",
  "underwear",
  "intimate",
  "brasier",
  "bralette",
  "panty",
  "pantys",
  "panties",
  "trusa",
  "tanga",
  "cachetero",
  "cacheteros",
  "cachetera",
  "cacheteras",
  "brasilera",
  "calzon",
  "calzón",
  "calzones",
  "calzoncillo",
  "calzoncillos",
  "boxer",
  "boxers",
  "brief",
  "briefs",
  "camisilla interior",
];

const HOSIERY_EVIDENCE = [
  "pantimedia",
  "pantimedias",
  "media velada",
  "medias veladas",
  "pantyhose",
  "hosiery",
  "stocking",
  "stockings",
  "tights",
];

const SWIM_EVIDENCE = [
  "bikini",
  "trikini",
  "tankini",
  "traje de bano",
  "traje de baño",
  "vestido de bano",
  "vestido de baño",
  "swimwear",
  "beachwear",
  "rashguard",
  "banador",
  "bañador",
  "pantaloneta",
  "pantaloneta de bano",
  "pantaloneta de baño",
  "short de bano",
  "short de baño",
  "boardshort",
  "boardshorts",
  "swim trunk",
  "swim trunks",
];

const BAG_EVIDENCE = [
  "rinonera",
  "riñonera",
  "waist bag",
  "belt bag",
  "bolso",
  "bolsos",
  "bag",
  "bags",
  "cartera",
  "mochila",
  "morral",
  "bandolera",
  "crossbody",
  "clutch",
  "billetera",
  "wallet",
  "cartuchera",
  "neceser",
  "estuche",
  "lonchera",
  "maleta",
  "equipaje",
  "correa",
  "cintura",
  "compartimento",
];

// Brand-level SEO often uses "lenceria" generically for any underwear. Only treat it as
// a category signal when we see explicit lingerie/shapewear/hosiery evidence.
const LINGERIE_STRONG_EVIDENCE = [
  "corset",
  "corse",
  "corsé",
  "babydoll",
  "liguero",
  "shapewear",
  "faja",
  "moldeador",
  "torso moldeador",
  "controlwear",
  "body lencero",
  "conjunto lenceria",
  "conjunto de lenceria",
  "set lenceria",
  "set de lenceria",
  "lingerie set",
  ...HOSIERY_EVIDENCE,
];

const HOODIE_EVIDENCE = [
  "buzo",
  "hoodie",
  "sudadera",
  "sweatshirt",
  "sueter",
  "suéter",
  "sweater",
  "jersey",
  "cardigan",
  "capucha",
];

const hasUnderwearEvidence = (text: string) => hasAnyKeyword(text, UNDERWEAR_EVIDENCE);
const hasHosieryEvidence = (text: string) => hasAnyKeyword(text, HOSIERY_EVIDENCE);
const hasSwimEvidence = (text: string) => hasAnyKeyword(text, SWIM_EVIDENCE);
const hasBagEvidence = (text: string) => hasAnyKeyword(text, BAG_EVIDENCE);
const hasStrongLingerieEvidence = (text: string) => hasAnyKeyword(text, LINGERIE_STRONG_EVIDENCE);
const hasHoodieEvidence = (text: string) => hasAnyKeyword(text, HOODIE_EVIDENCE);
const hasCottonEvidence = (text: string) => hasAnyKeyword(text, ["algodon", "algodón", "cotton"]);
const hasPiercingEvidence = (text: string) =>
  hasAnyKeyword(text, ["piercing", "piercings", "septum", "barbell", "labret", "helix"]);

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
    rule.category === "calzado" &&
    hasAnyKeyword(text, ["arete", "aretes", "earring", "earrings", "topos", "pendiente", "pendientes"])
  ) {
    // Avoid misclassifying jewelry shaped like shoes ("aretes de botas/tenis") as footwear.
    return true;
  }
  if (
    rule.category === "pantalones_no_denim" &&
    hasAnyKeyword(text, ["culotte"]) &&
    hasUnderwearEvidence(text)
  ) {
    // "Culotte" is also an underwear style in CO (cacheteros tipo culotte). Prefer underwear when present.
    return true;
  }
  if (
    rule.category === "camisas_y_blusas" &&
    hasAnyKeyword(text, ["chaleco"]) &&
    !hasAnyKeyword(text, ["manga", "boton", "botones", "button", "button down", "cuello", "collar", "blusa", "blouse"])
  ) {
    // "chaleco/camisa" product names are common; default to "chaleco" unless there's explicit shirt structure evidence.
    return true;
  }
  if (
    rule.category === "chaquetas_y_abrigos" &&
    hasAnyKeyword(text, [
      "bag",
      "bags",
      "bolso",
      "bolsos",
      "cartera",
      "mochila",
      "morral",
      "bandolera",
      "crossbody",
      "clutch",
      "billetera",
      "wallet",
      "duffel",
      "maleta",
      "maletas",
      "equipaje",
      "lonchera",
      "cartuchera",
      "neceser",
      "estuche",
    ])
  ) {
    // Avoid classifying bags as outerwear just because they include "puffer"/"acolchado", etc.
    return true;
  }
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
    // "Set" is extremely ambiguous. If the text clearly indicates a more specific domain
    // (swimwear, lingerie, pijamas), do not classify as clothing sets.
    const hasSwimSignal = hasAnyKeyword(text, [
      "bikini",
      "trikini",
      "tankini",
      "traje de bano",
      "traje de baño",
      "vestido de bano",
      "vestido de baño",
      "swimwear",
      "beachwear",
      "banador",
      "bañador",
      "rashguard",
      "pantaloneta",
      "pantaloneta de bano",
      "pantaloneta de baño",
      "short de bano",
      "short de baño",
      "boardshort",
      "boardshorts",
      "swim trunk",
      "swim trunks",
    ]);
    const hasLingerieSignal = hasAnyKeyword(text, [
      "lenceria",
      "lencería",
      "lingerie",
      "corset",
      "corse",
      "babydoll",
      "liguero",
      "faja",
      "shapewear",
      "moldeador",
      "brasier",
      "bralette",
      "panty",
      "trusa",
      "tanga",
      "cachetero",
      "brasilera",
      "boxer",
      "brief",
    ]);
    const hasSleepSignal = hasAnyKeyword(text, [
      "pijama",
      "sleepwear",
      "loungewear",
      "camison",
      "camisón",
      "homewear",
      "ropa de descanso",
    ]);
    if (hasSwimSignal || hasLingerieSignal || hasSleepSignal) return true;

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
    rule.category === "ropa_deportiva_y_performance" &&
    hasAnyKeyword(text, [
      "bag",
      "bags",
      "gym bag",
      "bolso",
      "bolsos",
      "cartera",
      "mochila",
      "morral",
      "bandolera",
      "crossbody",
      "clutch",
      "billetera",
      "wallet",
      "duffel",
      "maleta",
      "maletas",
      "equipaje",
      "lonchera",
      "cartuchera",
      "neceser",
      "estuche",
    ])
  ) {
    // Avoid classifying bags as sportswear just because the text mentions "gym"/"active".
    return true;
  }
  if (
    rule.category === "ropa_deportiva_y_performance" &&
    hasAnyKeyword(text, [
      "calzado",
      "footwear",
      "zapato",
      "zapatos",
      "shoe",
      "shoes",
      "sneaker",
      "sneakers",
      "sandalia",
      "sandalias",
      "tacon",
      "tacones",
      "bota",
      "botas",
      "botin",
      "botines",
      "mocasin",
      "mocasines",
      "loafer",
      "loafers",
    ])
  ) {
    // Footwear is handled by "calzado" even when it says "deportivo".
    return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    hasAnyKeyword(text, [
      "ropa deportiva",
      "activewear",
      "athleisure",
      "sportswear",
      "gym",
      "running",
      "training",
      "entrenamiento",
      "compresion",
      "compresión",
      "compression",
      "dry fit",
      "quick dry",
    ])
  ) {
    // Prefer "ropa_deportiva_y_performance" when sports evidence exists.
    return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    hasAnyKeyword(text, [
      "bikini",
      "trikini",
      "tankini",
      "traje de bano",
      "traje de baño",
      "vestido de bano",
      "vestido de baño",
      "swimwear",
      "beachwear",
      "rashguard",
      "salida de bano",
      "salida de baño",
      "pareo",
      "pantaloneta de bano",
      "pantaloneta de baño",
      "short de bano",
      "short de baño",
    ])
  ) {
    // Prevent "bikini top" / swimwear descriptions from being pulled into generic tops.
    return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    hasAnyKeyword(text, [
      "buzo",
      "hoodie",
      "sudadera",
      "sweatshirt",
      "sueter",
      "suéter",
      "sweater",
      "jersey",
      "cardigan",
    ]) &&
    !hasAnyKeyword(text, [
      "camiseta",
      "tshirt",
      "t shirt",
      "tee",
      "top",
      "crop top",
      "croptop",
      "camisilla",
      "esqueleto",
      "tank top",
      "bodysuit",
      "body",
    ])
  ) {
    // "Buzo con cuello polo" and similar should stay as sweaters/hoodies, not tops.
    return true;
  }
  if (
    rule.category === "ropa_interior_basica" &&
    hasStrongLingerieEvidence(text)
  ) {
    // Prefer lingerie/shapewear only when evidence is explicit; the word "lenceria/lingerie"
    // alone is too noisy in vendor SEO.
    return true;
  }
  if (
    rule.category === "ropa_interior_basica" &&
    hasAnyKeyword(text, [
      // "interior" alone is too ambiguous ("guía interior", etc.). Require underwear-ish evidence.
      "interior",
    ]) &&
    !hasUnderwearEvidence(text)
  ) {
    return true;
  }
  if (
    rule.category === "ropa_interior_basica" &&
    hasAnyKeyword(text, [
      ...SWIM_EVIDENCE,
    ])
  ) {
    // Swimwear can contain underwear-ish words ("panty", "tanga"). Prefer swimwear if it's present.
    return true;
  }
  if (
    rule.category === "lenceria_y_fajas_shapewear" &&
    hasUnderwearEvidence(text) &&
    !hasStrongLingerieEvidence(text)
  ) {
    // Many lingerie brands use "lenceria" as a generic brand label. If the product looks like
    // basic underwear and we don't have explicit shapewear/hosiery/lingerie evidence, ignore.
    return true;
  }
  if (rule.category === "shorts_y_bermudas" && hasSwimEvidence(text)) {
    // Avoid pulling swim shorts ("short de baño", "pantaloneta", etc.) into generic shorts.
    return true;
  }
  if (
    rule.category === "buzos_hoodies_y_sueteres" &&
    hasAnyKeyword(text, ["canguro"]) &&
    hasBagEvidence(text) &&
    !hasHoodieEvidence(text)
  ) {
    // "Canguro" is ambiguous in CO: hoodie vs fanny pack. If bag evidence exists, treat as bag.
    return true;
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
    rule.category === "camisetas_y_tops" &&
    (rule.subcategory === "camiseta_manga_corta" || rule.subcategory === "camiseta_manga_larga") &&
    hasAnyKeyword(text, [
      "crop top",
      "croptop",
      "tank top",
      "camisilla",
      "esqueleto",
      "sin mangas",
      "bodysuit",
      "body",
      "henley",
    ])
  ) {
    // Avoid downgrading specific tops into generic sleeve-length tees due to shared "manga corta/larga".
    return true;
  }
  if (
    rule.category === "lenceria_y_fajas_shapewear" &&
    rule.subcategory === "medias_lenceria_panty_lenceria" &&
    !hasHosieryEvidence(text)
  ) {
    // In CO "panty" is commonly underwear; require explicit hosiery evidence to classify as lingerie hosiery.
    return true;
  }
  if (
    rule.category === "lenceria_y_fajas_shapewear" &&
    rule.subcategory === "conjunto_lenceria"
  ) {
    const hasTopPiece = hasAnyKeyword(text, ["brasier", "bralette", "bra"]);
    const hasBottomPiece = hasAnyKeyword(text, ["panty", "trusa", "tanga", "cachetero", "brasilera", "calzon", "calzón"]);
    if (!hasTopPiece || !hasBottomPiece) return true;
  }
  if (
    rule.category === "shorts_y_bermudas" &&
    rule.subcategory === "short_casual_algodon" &&
    (!hasCottonEvidence(text) || hasSwimEvidence(text))
  ) {
    // Require cotton evidence and reject if swimwear signals exist.
    return true;
  }
  if (
    rule.category === "buzos_hoodies_y_sueteres" &&
    rule.subcategory === "hoodie_canguro" &&
    hasBagEvidence(text) &&
    !hasHoodieEvidence(text)
  ) {
    return true;
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "piercings" &&
    hasAnyKeyword(text, ["ear cuff", "ear cuffs", "earcuff"]) &&
    !hasPiercingEvidence(text)
  ) {
    // "Ear cuff" is usually an earring-type accessory, not a piercing.
    return true;
  }
  if (
    rule.category === "chaquetas_y_abrigos" &&
    rule.subcategory === "puffer_acolchada" &&
    hasAnyKeyword(text, [
      "bag",
      "bags",
      "bolso",
      "bolsos",
      "cartera",
      "mochila",
      "morral",
      "bandolera",
      "crossbody",
      "clutch",
      "billetera",
      "wallet",
      "duffel",
      "maleta",
      "maletas",
      "equipaje",
      "lonchera",
      "cartuchera",
      "neceser",
      "estuche",
    ])
  ) {
    // "Bolso puffer" is still a bag.
    return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    rule.subcategory === "camiseta_cuello_alto_tortuga" &&
    !hasAnyKeyword(text, ["cuello alto", "tortuga", "turtleneck", "high neck", "mock neck"])
  ) {
    // Avoid classifying as turtleneck just because the text contains the generic word "cuello".
    return true;
  }
  if (
    rule.category === "camisetas_y_tops" &&
    (rule.subcategory === "camiseta_manga_corta" || rule.subcategory === "camiseta_manga_larga") &&
    hasAnyKeyword(text, ["polo"])
  ) {
    // "Camiseta tipo polo" is still a polo; do not downgrade to generic sleeve-length tees.
    return true;
  }
  if (
    rule.category === "camisas_y_blusas" &&
    rule.subcategory.startsWith("blusa_") &&
    hasAnyKeyword(text, ["camisa", "shirt", "button down", "guayabera"]) &&
    !hasAnyKeyword(text, ["blusa", "blouse"])
  ) {
    // If the product is explicitly called a "camisa/shirt", don't pull it into "blusa_*" just
    // because it mentions sleeve length or other shared attributes.
    return true;
  }
  if (
    rule.category === "camisas_y_blusas" &&
    (rule.subcategory === "blusa_manga_corta" || rule.subcategory === "blusa_manga_larga")
  ) {
    const hasShortSleeve = hasAnyKeyword(text, ["manga corta", "short sleeve", "short-sleeve"]);
    const hasLongSleeve = hasAnyKeyword(text, ["manga larga", "long sleeve", "long-sleeve"]);
    if (rule.subcategory === "blusa_manga_corta" && !hasShortSleeve) return true;
    if (rule.subcategory === "blusa_manga_larga" && !hasLongSleeve) return true;
  }
  if (
    rule.category === "camisas_y_blusas" &&
    rule.subcategory === "camisa_casual" &&
    hasAnyKeyword(text, ["lino", "linen"])
  ) {
    // If it's explicitly linen, keep it as "camisa_de_lino" instead of "camisa_casual".
    return true;
  }
  if (
    rule.category === "chaquetas_y_abrigos" &&
    rule.subcategory === "chaqueta_tipo_cuero_cuero_o_sintetico" &&
    !hasAnyKeyword(text, [
      "cuero",
      "piel",
      "leather",
      "faux leather",
      "pu leather",
      "polipiel",
      "sintetico",
      "sintético",
      "vegano",
    ])
  ) {
    // Avoid "leather jacket" just because the text says "chaqueta/jacket".
    return true;
  }
  if (
    rule.category === "camisas_y_blusas" &&
    rule.subcategory === "camisa_formal" &&
    !hasAnyKeyword(text, [
      "formal",
      "de vestir",
      "camisa de vestir",
      "office",
      "business",
      "dress shirt",
      "oxford",
      "tuxedo",
      "smoking",
      "sastreria",
      "tailoring",
    ])
  ) {
    // Avoid classifying as "formal" just because the text contains generic "camisa/shirt".
    return true;
  }
  if (
    rule.category === "buzos_hoodies_y_sueteres" &&
    rule.subcategory === "buzo_cuello_redondo" &&
    hasAnyKeyword(text, ["cierre", "cremallera", "zip", "zipper", "half zip", "quarter zip"])
  ) {
    // If the product clearly has a closure/zip, don't classify it as crewneck.
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
    rule.category === "bolsos_y_marroquineria" &&
    rule.subcategory === "cartera_bolso_de_mano" &&
    !hasAnyKeyword(text, ["cartera", "bolso de mano", "purse", "handbag"]) 
  ) {
    // Avoid matching just "mano" from phrases like "hecho a mano".
    return true;
  }
  if (
    rule.category === "bolsos_y_marroquineria" &&
    rule.subcategory === "cartera_bolso_de_mano" &&
    hasAnyKeyword(text, [
      "bandolera",
      "crossbody",
      "cross body",
      "bolso cruzado",
      "correa larga",
      "strap",
      "strap bag",
    ])
  ) {
    // If it's explicitly crossbody/bandolera, don't pull it into handbag.
    return true;
  }
  if (
    rule.category === "trajes_de_bano_y_playa" &&
    rule.subcategory === "traje_de_bano_infantil" &&
    !hasAnyKeyword(text, [
      "infantil",
      "nino",
      "niño",
      "nina",
      "niña",
      "kid",
      "kids",
      "baby",
      "bebe",
      "bebé",
      "junior",
    ])
  ) {
    return true;
  }
  if (
    rule.category === "trajes_de_bano_y_playa" &&
    rule.subcategory === "vestido_de_bano_entero"
  ) {
    // Prefer the dedicated kids bucket when the product is clearly infant/kids.
    if (
      hasAnyKeyword(text, [
        "infantil",
        "nino",
        "niño",
        "nina",
        "niña",
        "kid",
        "kids",
        "baby",
        "bebe",
        "bebé",
        "junior",
      ])
    ) {
      return true;
    }
    // "Vestido de baño" is generic in CO. Require one-piece evidence to classify as "entero".
    if (
      !hasAnyKeyword(text, [
        "entero",
        "una pieza",
        "one piece",
        "one-piece",
        "one piece swimsuit",
        "traje de baño entero",
        "traje de bano entero",
        "enterizo",
      ])
    ) {
      return true;
    }
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "aretes_pendientes" &&
    hasAnyKeyword(text, ["cadena", "collar", "collares", "necklace", "choker", "gargantilla"]) &&
    !hasAnyKeyword(text, ["arete", "aretes", "earring", "earrings", "topos", "argolla", "argollas"])
  ) {
    // Avoid routing chains/necklaces into earrings due to "pendientes" ambiguity/ties.
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
    rule.subcategory === "collares" &&
    hasAnyKeyword(text, ["charm", "charms", "dije", "dijes", "llavero", "llaveros", "keychain", "keychains"]) &&
    !hasAnyKeyword(text, ["collar", "collares", "necklace", "choker", "gargantilla"])
  ) {
    // Bag charms/keychains often include a "cadena" but are not necklaces.
    return true;
  }
  if (
    rule.category === "joyeria_y_bisuteria" &&
    rule.subcategory === "dijes_charms" &&
    hasAnyKeyword(text, ["collar", "collares", "necklace", "choker", "gargantilla"]) &&
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

// Subcategory scoring must not rely on category-generic anchors like "bolso" or "camisa";
// those create order-based ties and cause noisy remap proposals.
const GENERIC_SUBCATEGORY_KEYWORDS_BY_CATEGORY: Record<string, string[]> = {
  camisetas_y_tops: ["camiseta", "tshirt", "t shirt", "tee", "top"],
  camisas_y_blusas: ["camisa", "shirt", "blusa", "blouse"],
  buzos_hoodies_y_sueteres: [
    "buzo",
    "hoodie",
    "sudadera",
    "sweatshirt",
    "sueter",
    "suéter",
    "sweater",
    "jersey",
    "cardigan",
  ],
  chaquetas_y_abrigos: ["chaqueta", "jacket", "abrigo", "coat"],
  pantalones_no_denim: ["pantalon", "pantalón", "pants", "trouser", "trousers"],
  shorts_y_bermudas: ["short", "shorts", "bermuda", "bermudas"],
  faldas: ["falda", "skirt"],
  vestidos: ["vestido", "dress"],
  jeans_y_denim: ["jean", "jeans", "denim"],
  calzado: ["calzado", "footwear", "zapato", "zapatos", "shoe", "shoes"],
  gafas_y_optica: ["gafas", "lentes", "eyewear"],
  bolsos_y_marroquineria: ["bolso", "bolsos", "bag", "bags"],
};

const GENERIC_SUBCATEGORY_SET_BY_CATEGORY = new Map<string, Set<string>>(
  Object.entries(GENERIC_SUBCATEGORY_KEYWORDS_BY_CATEGORY).map(([category, keywords]) => [
    category,
    new Set(keywords.map((kw) => normalizeText(kw))),
  ]),
);

const pickSubcategorySignal = (
  text: string,
  category: string,
  allowedSubByCategory: Record<string, string[]>,
) => {
  const allowedSubs = allowedSubByCategory[category] ?? [];
  if (!allowedSubs.length) return { subcategory: null, productType: null };

  const genericKeywordSet = GENERIC_SUBCATEGORY_SET_BY_CATEGORY.get(category) ?? new Set<string>();
  const scoreBySubcategory = new Map<string, number>();
  const bestProductTypeBySubcategory = new Map<string, string | null>();

  SUBCATEGORY_KEYWORD_RULES.forEach((rule) => {
    if (rule.category !== category) return;
    if (shouldIgnoreSubcategoryRule(rule, text)) return;
    const subcategory = normalizeEnumValue(rule.subcategory, allowedSubs);
    if (!subcategory) return;
    const effectiveKeywords =
      genericKeywordSet.size > 0
        ? rule.keywords.filter((keyword) => !genericKeywordSet.has(normalizeText(keyword)))
        : rule.keywords;
    const score = scoreKeywordHits(text, effectiveKeywords);
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
  seoCategory: string | null,
  vendorTagCategory: string | null,
  conflicts: string[],
): SignalStrength => {
  if (!inferredCategory) return "weak";
  const agrees = [vendorCategory, nameCategory, descriptionCategory, seoCategory, vendorTagCategory].filter(
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
  const seoCategoryText = normalizeText(
    [seoTitleText, seoDescriptionText, seoTagText].filter(Boolean).join(" "),
  );

  const nameMatch = pickCategorySignal(nameText, allowedCategories, allowedSubByCategory);
  const descriptionMatch = pickCategorySignal(descText, allowedCategories, allowedSubByCategory);
  const platform = getPlatformSignals(params.metadata);

  const vendorCategory = normalizeEnumValue(platform.vendorCategory, allowedCategories);
  const vendorTagText = normalizeText(platform.vendorTags.join(" "));
  const vendorTagMatch = pickCategorySignal(vendorTagText, allowedCategories, allowedSubByCategory);
  const seoMatch = pickCategorySignal(seoCategoryText, allowedCategories, allowedSubByCategory);

  const currentCategory = normalizeEnumValue(params.currentCategory, allowedCategories);

  type CategorySource = "vendor_category" | "vendor_tags" | "name" | "description" | "seo";
  const CATEGORY_SOURCE_WEIGHTS: Record<CategorySource, number> = {
    vendor_category: 7,
    description: 6,
    seo: 5,
    vendor_tags: 4,
    name: 3,
  };

  const categoryScores = new Map<string, { score: number; sources: Set<CategorySource> }>();
  const bumpCategoryScore = (category: string | null, source: CategorySource) => {
    if (!category) return;
    const weight = CATEGORY_SOURCE_WEIGHTS[source];
    const entry = categoryScores.get(category) ?? { score: 0, sources: new Set<CategorySource>() };
    entry.score += weight;
    entry.sources.add(source);
    categoryScores.set(category, entry);
  };

  bumpCategoryScore(vendorCategory, "vendor_category");
  bumpCategoryScore(vendorTagMatch.category, "vendor_tags");
  bumpCategoryScore(nameMatch.category, "name");
  bumpCategoryScore(descriptionMatch.category, "description");
  bumpCategoryScore(seoMatch.category, "seo");

  const rankedCategories = [...categoryScores.entries()].sort((a, b) => {
    const scoreDelta = b[1].score - a[1].score;
    if (scoreDelta !== 0) return scoreDelta;
    const sourcesDelta = b[1].sources.size - a[1].sources.size;
    if (sourcesDelta !== 0) return sourcesDelta;
    // Deterministic: when still tied, keep current category if it's among the tied set.
    if (currentCategory) {
      if (a[0] === currentCategory && b[0] !== currentCategory) return -1;
      if (b[0] === currentCategory && a[0] !== currentCategory) return 1;
    }
    return a[0].localeCompare(b[0]);
  });

  const inferredCategory = rankedCategories[0]?.[0] ?? null;
  const topScore = rankedCategories[0]?.[1].score ?? 0;
  const conflictingSignals = rankedCategories
    .slice(1)
    .filter(([, meta]) => meta.score >= topScore - 1 && meta.score > 0)
    .map(([category]) => category);

  const inferredSubcategory = (() => {
    if (!inferredCategory) return null;
    const allowedSubs = allowedSubByCategory[inferredCategory] ?? [];
    if (!allowedSubs.length) return null;
    type SubcategorySource = "description" | "seo" | "vendor_tags" | "name";
    const SUBCATEGORY_SOURCE_WEIGHTS: Record<SubcategorySource, number> = {
      description: 6,
      seo: 5,
      vendor_tags: 4,
      name: 3,
    };

    const scores = new Map<string, { score: number; sources: Set<SubcategorySource> }>();
    const bump = (value: string | null | undefined, source: SubcategorySource) => {
      if (!value) return;
      const normalized = normalizeEnumValue(value, allowedSubs);
      if (!normalized) return;
      const entry = scores.get(normalized) ?? { score: 0, sources: new Set<SubcategorySource>() };
      entry.score += SUBCATEGORY_SOURCE_WEIGHTS[source];
      entry.sources.add(source);
      scores.set(normalized, entry);
    };

    bump(descriptionMatch.subcategory, "description");
    bump(seoMatch.subcategory, "seo");
    bump(vendorTagMatch.subcategory, "vendor_tags");
    bump(nameMatch.subcategory, "name");

    const ranked = [...scores.entries()].sort((a, b) => {
      const scoreDelta = b[1].score - a[1].score;
      if (scoreDelta !== 0) return scoreDelta;
      const sourcesDelta = b[1].sources.size - a[1].sources.size;
      if (sourcesDelta !== 0) return sourcesDelta;
      return a[0].localeCompare(b[0]);
    });

    return ranked[0]?.[0] ?? null;
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
    seoMatch.category,
    vendorTagMatch.category,
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
