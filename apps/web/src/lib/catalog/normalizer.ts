import { z } from "zod";
import { getOpenAIClient } from "@/lib/openai";
import { guessCurrency, normalizeSize, pickOption } from "@/lib/catalog/utils";
import { sanitizeCatalogPrice } from "@/lib/catalog-price";
import type { CanonicalProduct, CanonicalVariant, RawProduct, RawVariant } from "@/lib/catalog/types";
import {
  CATEGORY_VALUES,
  SUBCATEGORY_BY_CATEGORY,
} from "@/lib/product-enrichment/constants";
import { normalizeEnumValue } from "@/lib/product-enrichment/utils";

const OPENAI_MODEL = process.env.CATALOG_OPENAI_MODEL ?? "gpt-5-mini";
const MAX_RETRIES = 3;
const LLM_MODE = (process.env.CATALOG_LLM_NORMALIZE_MODE ?? "auto").toLowerCase();
const MAX_LLM_DESC_CHARS = Math.max(200, Number(process.env.CATALOG_LLM_NORMALIZE_MAX_DESC_CHARS ?? 2000));
const MAX_LLM_IMAGES = Math.max(1, Number(process.env.CATALOG_LLM_NORMALIZE_MAX_IMAGES ?? 10));
const MAX_LLM_VARIANTS = Math.max(1, Number(process.env.CATALOG_LLM_NORMALIZE_MAX_VARIANTS ?? 60));
const MAX_LLM_OPTION_VALUES = Math.max(1, Number(process.env.CATALOG_LLM_NORMALIZE_MAX_OPTION_VALUES ?? 20));

const LLM_DISABLE_MINUTES_DEFAULT = 30;
let llmDisabledUntil = 0;
let llmDisabledReason: string | null = null;

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isQuotaOrBillingError = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes("you exceeded your current quota") ||
    lower.includes("insufficient_quota") ||
    (lower.includes("429") && lower.includes("quota"))
  );
};

const isMissingApiKeyError = (message: string) => message.toLowerCase().includes("openai_api_key is missing");

const maybeDisableLlmTemporarily = (message: string) => {
  if (!isQuotaOrBillingError(message)) return;
  const minutes = Math.max(
    1,
    Number(process.env.CATALOG_LLM_NORMALIZE_DISABLE_MINUTES ?? LLM_DISABLE_MINUTES_DEFAULT),
  );
  llmDisabledUntil = Date.now() + minutes * 60 * 1000;
  llmDisabledReason = message.slice(0, 240);
  console.warn("catalog.normalizer.llm_disabled", {
    minutes,
    reason: llmDisabledReason,
  });
};

const isLlmTemporarilyDisabled = () => llmDisabledUntil > Date.now();

const catalogVariantSchema = z.object({
  sku: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  fit: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  stock: z.number().int().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
});

const catalogProductSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  style_tags: z.array(z.string()).default([]),
  material_tags: z.array(z.string()).default([]),
  pattern_tags: z.array(z.string()).default([]),
  occasion_tags: z.array(z.string()).default([]),
  gender: z.string().nullable().optional(),
  season: z.string().nullable().optional(),
  care: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  image_cover_url: z.string().nullable().optional(),
  variants: z.array(catalogVariantSchema).min(1),
  metadata: z.record(z.unknown()).optional(),
});

const openAiResponseSchema = z.object({
  product: catalogProductSchema,
});

const basePrompt = `
Eres un sistema de normalizacion de catalogo de moda colombiana. Devuelve SOLO JSON valido y estrictamente en este formato:
{
  "product": {
    "name": "string",
    "description": "string|null",
    "category": "string|null",
    "subcategory": "string|null",
    "style_tags": ["string"],
    "material_tags": ["string"],
    "pattern_tags": ["string"],
    "occasion_tags": ["string"],
    "gender": "string|null",
    "season": "string|null",
    "care": "string|null",
    "origin": "string|null",
    "status": "string|null",
    "source_url": "string|null",
    "image_cover_url": "string|null",
    "variants": [
      {
        "sku": "string|null",
        "color": "string|null",
        "size": "string|null",
        "fit": "string|null",
        "material": "string|null",
        "price": "number|null",
        "currency": "string|null",
        "stock": "number|null",
        "stock_status": "string|null",
        "images": ["string"]
      }
    ],
    "metadata": {}
  }
}
- No inventes precios, stock ni variantes: usa los valores provistos en raw_product.
- Si un precio viene con separador de miles (ej: 160.000), interpretalo como 160000.
- Si no hay currency, asume USD para precios <= 999 y COP para precios >= 10000.
- Si falta un dato, usa null o listas vacias.
- style_tags, material_tags, pattern_tags, occasion_tags deben ser arrays en minusculas.
- source_url debe ser la URL externa original del producto si existe.
- image_cover_url debe ser una URL de imagen (preferir blob_url si se provee).
`;

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toText = (value: unknown): string => {
  if (!value) return "";
  if (Array.isArray(value)) return value.map((entry) => toText(entry)).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => toText(entry))
      .filter(Boolean)
      .join(" ");
  }
  return String(value);
};

const addTag = (set: Set<string>, tag: string) => {
  if (tag && tag.trim()) set.add(tag.trim());
};

type TagRule = { tag: string; keywords: string[] };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasAnyKeyword = (text: string, keywords: string[]) => {
  for (const keyword of keywords) {
    const cleaned = keyword.trim();
    if (!cleaned) continue;
    if (cleaned.includes(" ")) {
      if (text.includes(cleaned)) return true;
      continue;
    }
    const re = new RegExp(`(^|\\s)${escapeRegExp(cleaned)}(\\s|$)`);
    if (re.test(text)) return true;
  }
  return false;
};

const canonicalizeCategorySubcategory = (rawCategory?: string | null, rawSubcategory?: string | null) => {
  const category = normalizeEnumValue(rawCategory ?? null, CATEGORY_VALUES);
  if (!category) return { category: null, subcategory: null };
  const allowedSubs = SUBCATEGORY_BY_CATEGORY[category] ?? [];
  const subcategory = normalizeEnumValue(rawSubcategory ?? null, allowedSubs);
  return { category, subcategory };
};

const MATERIAL_RULES: TagRule[] = [
  { tag: "algodon", keywords: ["algodon", "cotton", "algodon organico"] },
  { tag: "lino", keywords: ["lino", "linen"] },
  { tag: "denim", keywords: ["denim", "jean", "jeans"] },
  { tag: "cuero", keywords: ["cuero", "leather", "cuero vegano", "polipiel"] },
  { tag: "gamuza", keywords: ["gamuza", "suede"] },
  { tag: "seda", keywords: ["seda", "silk"] },
  { tag: "lana", keywords: ["lana", "wool"] },
  { tag: "poliester", keywords: ["poliester", "polyester", "poly"] },
  { tag: "viscosa", keywords: ["viscosa", "viscose", "rayon"] },
  { tag: "nylon", keywords: ["nylon"] },
  { tag: "elastano", keywords: ["elastano", "elastane", "spandex", "lycra"] },
  { tag: "tencel", keywords: ["tencel", "lyocell"] },
  { tag: "modal", keywords: ["modal"] },
  { tag: "satin", keywords: ["satin"] },
  { tag: "chiffon", keywords: ["chiffon"] },
  { tag: "tweed", keywords: ["tweed"] },
  { tag: "lona", keywords: ["lona", "canvas"] },
  { tag: "malla", keywords: ["malla", "mesh"] },
];

const PATTERN_RULES: TagRule[] = [
  { tag: "rayas", keywords: ["raya", "rayas", "stripe", "stripes"] },
  { tag: "flores", keywords: ["flor", "floral", "flores"] },
  { tag: "cuadros", keywords: ["cuadro", "cuadros", "plaid", "tartan"] },
  { tag: "animal_print", keywords: ["animal print", "leopardo", "cebra", "tigre"] },
  { tag: "puntos", keywords: ["puntos", "polka", "dot"] },
  { tag: "geom", keywords: ["geometrico", "geometric"] },
  { tag: "estampado", keywords: ["estampado", "print"] },
  { tag: "liso", keywords: ["liso", "solid", "plain"] },
];

const STYLE_RULES: TagRule[] = [
  { tag: "casual", keywords: ["casual", "diario", "everyday"] },
  { tag: "formal", keywords: ["formal", "elegante", "smart"] },
  { tag: "boho", keywords: ["boho", "bohemio"] },
  { tag: "minimal", keywords: ["minimal", "minimalista"] },
  { tag: "urbano", keywords: ["urbano", "street", "streetwear"] },
  { tag: "romantico", keywords: ["romantico", "romantica", "romance"] },
  { tag: "sport", keywords: ["sport", "deportivo", "athleisure"] },
  { tag: "retro", keywords: ["retro", "vintage"] },
  { tag: "elegante", keywords: ["gala", "elegante", "fiesta"] },
];

const OCCASION_RULES: TagRule[] = [
  { tag: "fiesta", keywords: ["fiesta", "party", "noche"] },
  { tag: "playa", keywords: ["playa", "beach"] },
  { tag: "oficina", keywords: ["oficina", "office", "work"] },
  { tag: "deporte", keywords: ["deporte", "sport", "gym", "active"] },
  { tag: "boda", keywords: ["boda", "wedding"] },
  { tag: "viaje", keywords: ["viaje", "travel"] },
];

const SEASON_RULES: TagRule[] = [
  { tag: "verano", keywords: ["verano", "summer"] },
  { tag: "invierno", keywords: ["invierno", "winter"] },
  { tag: "primavera", keywords: ["primavera", "spring"] },
  { tag: "otono", keywords: ["otono", "fall", "autumn"] },
];

const CATEGORY_KEYWORDS: Array<{ category: string; subcategory?: string; keywords: string[] }> = [
  {
    category: "tarjeta_regalo",
    subcategory: "gift_card",
    keywords: ["gift card", "giftcard", "tarjeta de regalo", "tarjeta regalo", "bono de regalo", "voucher"],
  },
  {
    category: "bolsos_y_marroquineria",
    keywords: [
      "bolso",
      "bolsos",
      "cartera",
      "carteras",
      "mochila",
      "mochilas",
      "morral",
      "morrales",
      "rinonera",
      "rinoneras",
      "canguro",
      "clutch",
      "tote",
      "bandolera",
      "crossbody",
      "billetera",
      "billeteras",
      "monedero",
      "monederos",
      "cartuchera",
      "cartucheras",
      "neceser",
      "neceseres",
      "cosmetiquera",
      "cosmetiqueras",
      "estuche",
      "estuches",
      "pouch",
      "pouches",
      "lapicera",
      "lapiceras",
      "maleta",
      "maletas",
      "equipaje",
      "trolley",
      "luggage",
      "suitcase",
      "llavero",
      "llaveros",
      "keychain",
      "keychains",
      "porta pasaporte",
      "portapasaporte",
      "porta documentos",
      "portadocumentos",
      "duffel",
      "bolso de viaje",
    ],
  },
  {
    category: "joyeria_y_bisuteria",
    keywords: [
      "arete",
      "aretes",
      "topo",
      "topos",
      "pendiente",
      "pendientes",
      "argolla",
      "argollas",
      "collar",
      "collares",
      "cadena",
      "cadenas",
      "pulsera",
      "pulseras",
      "brazalete",
      "brazaletes",
      "anillo",
      "anillos",
      "tobillera",
      "tobilleras",
      "dije",
      "dijes",
      "charm",
      "charms",
      "broche",
      "broches",
      "prendedor",
      "prendedores",
      "piercing",
      "piercings",
      "reloj",
      "relojes",
      "joya",
      "joyas",
      "bisuteria",
    ],
  },
  {
    category: "gafas_y_optica",
    keywords: ["gafas", "lente", "lentes", "montura", "monturas", "optica", "sunglasses", "goggle", "goggles"],
  },
  {
    category: "calzado",
    keywords: [
      "zapato",
      "zapatos",
      "tenis",
      "sneaker",
      "sneakers",
      "sandalia",
      "sandalias",
      "tacon",
      "tacones",
      "stiletto",
      "bota",
      "botas",
      "botin",
      "botines",
      "mocasin",
      "mocasines",
      "loafer",
      "loafers",
      "balerina",
      "balerinas",
      "alpargata",
      "alpargatas",
      "espadrille",
      "espadrilles",
      "zueco",
      "zuecos",
      "chancla",
      "chanclas",
      "flip flop",
      "flip flops",
      "oxford",
    ],
  },
  {
    category: "accesorios_textiles_y_medias",
    keywords: [
      "media",
      "medias",
      "calcetin",
      "calcetines",
      "pantimedia",
      "pantimedias",
      "cinturon",
      "cinturones",
      "gorra",
      "gorras",
      "sombrero",
      "sombreros",
      "bufanda",
      "bufandas",
      "panuel",
      "panuelos",
      "bandana",
      "bandanas",
      "corbata",
      "corbatas",
      "pajarita",
      "pajaritas",
      "tirante",
      "tirantes",
      "chal",
      "chales",
      "pashmina",
      "pashminas",
      "guante",
      "guantes",
      "tapabocas",
      "mascarilla",
      "mascarillas",
      "beanie",
      "gorro",
      "gorros",
      "scrunchie",
      "diadema",
      "diademas",
      "balaca",
      "balacas",
      "pasador",
      "pasadores",
      "pinza",
      "pinzas",
    ],
  },
  {
    category: "trajes_de_bano_y_playa",
    keywords: [
      "bikini",
      "trikini",
      "tankini",
      "traje de bano",
      "vestido de bano",
      "swim",
      "banador",
      "pareo",
      "rashguard",
      "licra uv",
      "licra",
    ],
  },
  {
    category: "lenceria_y_fajas_shapewear",
    keywords: ["faja", "fajas", "shapewear", "moldeador", "moldeadora", "corset", "corse", "bustier", "liguero"],
  },
  {
    category: "ropa_interior_basica",
    keywords: [
      "brasier",
      "bralette",
      "bra",
      "panty",
      "trusa",
      "tanga",
      "brasilera",
      "boxer",
      "brief",
      "interior",
      "interiores",
      "lingerie",
      "jockstrap",
      "suspensorio",
      "thong",
      "thongs",
      "trunk",
      "trunks",
    ],
  },
  {
    category: "ropa_deportiva_y_performance",
    keywords: [
      "activewear",
      "athleisure",
      "gym",
      "running",
      "ciclismo",
      "training",
      "entrenamiento",
      "compresion",
      "compresivo",
      "deportivo",
      "deportiva",
      "deportivos",
      "deportivas",
    ],
  },
  { category: "vestidos", keywords: ["vestido", "dress"] },
  { category: "enterizos_y_overoles", keywords: ["enterizo", "jumpsuit", "overall", "overol", "romper", "jardinera"] },
  { category: "blazers_y_sastreria", keywords: ["blazer", "tuxedo", "smoking"] },
  { category: "chaquetas_y_abrigos", keywords: ["chaqueta", "jacket", "abrigo", "coat", "trench", "parka", "bomber", "rompevientos", "impermeable"] },
  { category: "buzos_hoodies_y_sueteres", keywords: ["buzo", "hoodie", "sweatshirt", "sueter", "sweater", "cardigan", "knit", "tejido"] },
  { category: "camisas_y_blusas", keywords: ["camisa", "blusa", "guayabera", "shirt"] },
  { category: "camisetas_y_tops", keywords: ["camiseta", "tshirt", "t shirt", "tank", "crop", "polo", "henley", "bodysuit", "body", "camisilla", "esqueleto"] },
  { category: "faldas", keywords: ["falda", "skirt"] },
  // Jeans before pantalón to avoid collisions on "denim".
  { category: "jeans_y_denim", keywords: ["jean", "jeans", "denim"] },
  { category: "shorts_y_bermudas", keywords: ["short", "shorts", "bermuda"] },
  { category: "pantalones_no_denim", keywords: ["pantalon", "pantalones", "trouser"] },
];

const GENDER_RULES: TagRule[] = [
  { tag: "mujer", keywords: ["mujer", "women", "womens", "dama", "ladies"] },
  { tag: "hombre", keywords: ["hombre", "men", "mens", "caballero"] },
  { tag: "nino", keywords: ["nino", "kids", "boy", "girl", "infantil", "juvenil"] },
  { tag: "unisex", keywords: ["unisex"] },
];

const COLOR_RULES: TagRule[] = [
  { tag: "negro", keywords: ["negro", "black"] },
  { tag: "blanco", keywords: ["blanco", "white", "marfil", "ivory"] },
  { tag: "gris", keywords: ["gris", "gray", "grey"] },
  { tag: "azul", keywords: ["azul", "blue", "navy", "marino"] },
  { tag: "rojo", keywords: ["rojo", "red"] },
  { tag: "verde", keywords: ["verde", "green", "oliva"] },
  { tag: "amarillo", keywords: ["amarillo", "yellow"] },
  { tag: "naranja", keywords: ["naranja", "orange"] },
  { tag: "rosado", keywords: ["rosado", "rosa", "pink"] },
  { tag: "morado", keywords: ["morado", "purple", "lila", "lavanda"] },
  { tag: "beige", keywords: ["beige", "nude", "arena"] },
  { tag: "cafe", keywords: ["cafe", "brown", "chocolate"] },
  { tag: "vino", keywords: ["vino", "burgundy", "vinotinto", "bordo"] },
  { tag: "mostaza", keywords: ["mostaza", "mustard"] },
  { tag: "turquesa", keywords: ["turquesa", "turquoise"] },
  { tag: "fucsia", keywords: ["fucsia", "fuchsia", "magenta"] },
  { tag: "dorado", keywords: ["dorado", "gold"] },
  { tag: "plateado", keywords: ["plateado", "silver"] },
  { tag: "multicolor", keywords: ["multicolor", "multi color", "multi-color", "varios colores"] },
];

const FIT_RULES: TagRule[] = [
  { tag: "slim", keywords: ["slim", "entallado", "ajustado"] },
  { tag: "regular", keywords: ["regular", "clasico"] },
  { tag: "oversize", keywords: ["oversize", "over", "holgado"] },
  { tag: "relajado", keywords: ["relajado", "relaxed"] },
  { tag: "cropped", keywords: ["cropped", "corto"] },
];

const collectTags = (text: string, rules: TagRule[]) => {
  const tags = new Set<string>();
  rules.forEach((rule) => {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      addTag(tags, rule.tag);
    }
  });
  return Array.from(tags);
};

// Spanish fashion catalogs commonly use "bota" to describe pant leg shape (bota recta/ancha/skinny...),
// which should NOT be inferred as footwear.
const looksLikePantsBotaFit = (text: string) => {
  const botaFitPhrases = [
    "bota recta",
    "bota recto",
    "bota ancha",
    "bota amplia",
    "bota muy ancha",
    "bota campana",
    "bota flare",
    "bota resortada",
    "bota tubo",
    "bota skinny",
    "bota medio",
    "bota media",
    "bota palazzo",
    "bota ajustable",
    "botas ajustables",
    "efecto en bota",
  ];
  if (botaFitPhrases.some((phrase) => text.includes(phrase))) return true;
  const hasBottoms =
    hasAnyKeyword(text, [
      "pantalon",
      "pantalones",
      "jogger",
      "cargo",
      "palazzo",
      "culotte",
      "legging",
      "leggings",
    ]) && hasAnyKeyword(text, ["bota", "botas"]);
  return hasBottoms;
};

const inferCategory = (text: string) => {
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.category === "calzado" && looksLikePantsBotaFit(text)) {
      // Only ignore footwear when the only hit would be bota/botas.
      const filtered = rule.keywords.filter((kw) => kw !== "bota" && kw !== "botas");
      if (!hasAnyKeyword(text, filtered)) continue;
    }

    if (hasAnyKeyword(text, rule.keywords)) {
      const coerced = canonicalizeCategorySubcategory(rule.category, rule.subcategory ?? null);
      return coerced;
    }
  }
  return { category: null, subcategory: null };
};

const inferGender = (text: string) => {
  for (const rule of GENDER_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.tag;
    }
  }
  return null;
};

const inferFit = (text: string) => {
  for (const rule of FIT_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.tag;
    }
  }
  return null;
};

const normalizeColorName = (value: string | null | undefined) => {
  if (!value) return null;
  const text = normalizeText(value);
  for (const rule of COLOR_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.tag;
    }
  }
  return value.trim() || null;
};

const resolveVariantColor = (variant: RawVariant) => {
  const color = pickOption(variant.options, ["color", "colour", "tono"]);
  return normalizeColorName(color ?? null);
};

const resolveVariantSize = (variant: RawVariant) => {
  const sizeRaw = pickOption(variant.options, ["talla", "size", "tamano"]);
  return normalizeSize(sizeRaw);
};

const resolveVariantFit = (variant: RawVariant) => {
  const fit = pickOption(variant.options, ["fit", "calce"]);
  return fit ?? null;
};

const resolveStockStatus = (variant: RawVariant) => {
  if (variant.available === true) return "in_stock";
  if (variant.available === false) return "out_of_stock";
  if (typeof variant.stock === "number") return variant.stock > 0 ? "in_stock" : "out_of_stock";
  return null;
};

const buildCanonicalVariants = (
  rawVariants: RawVariant[],
  fallbackCurrency?: string | null,
  defaults?: { material?: string | null; fit?: string | null },
) => {
  const variants: CanonicalVariant[] = [];
  rawVariants.forEach((variant) => {
    const price = sanitizeCatalogPrice(typeof variant.price === "number" ? variant.price : null);
    const currency = guessCurrency(price, variant.currency ?? fallbackCurrency ?? null);
    variants.push({
      sku: variant.sku ?? null,
      color: resolveVariantColor(variant),
      size: resolveVariantSize(variant),
      fit: resolveVariantFit(variant) ?? defaults?.fit ?? null,
      material: defaults?.material ?? null,
      price,
      currency: currency ?? variant.currency ?? fallbackCurrency ?? null,
      stock: typeof variant.stock === "number" ? variant.stock : null,
      stock_status: resolveStockStatus(variant),
      images: variant.images ?? (variant.image ? [variant.image] : null),
    });
  });
  return variants.length
    ? variants
    : [
        {
          sku: null,
          color: null,
          size: null,
          fit: null,
          material: null,
          price: null,
          currency: fallbackCurrency ?? null,
          stock: null,
          stock_status: null,
          images: null,
        },
      ];
};

const normalizeCatalogProductDeterministic = (rawProduct: RawProduct, platform?: string | null): CanonicalProduct => {
  const rawTags = toText(rawProduct.metadata?.tags);
  const rawCategories = toText(rawProduct.metadata?.categories);
  const rawAttributes = toText(rawProduct.metadata?.attributes);
  const rawProductType = toText(rawProduct.metadata?.product_type);
  const optionText = Array.isArray(rawProduct.options)
    ? rawProduct.options
        .flatMap((option) => [option.name, ...(option.values ?? [])])
        .filter(Boolean)
        .join(" ")
    : "";
  const variantOptionText = Array.isArray(rawProduct.variants)
    ? rawProduct.variants
        .flatMap((variant) => Object.values(variant.options ?? {}))
        .filter(Boolean)
        .join(" ")
    : "";
  const text = normalizeText(
    [
      rawProduct.title,
      rawProduct.description,
      rawProduct.vendor,
      rawTags,
      rawCategories,
      rawAttributes,
      rawProductType,
      optionText,
      variantOptionText,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const categoryResult = inferCategory(text);
  const materialTags = collectTags(text, MATERIAL_RULES);
  const patternTags = collectTags(text, PATTERN_RULES);
  const styleTags = collectTags(text, STYLE_RULES);
  const occasionTags = collectTags(text, OCCASION_RULES);
  const season = collectTags(text, SEASON_RULES)[0] ?? null;
  const gender = inferGender(text);
  const fit = inferFit(text);

  return {
    name: rawProduct.title ?? "Sin nombre",
    description: rawProduct.description ?? null,
    category: categoryResult.category,
    subcategory: categoryResult.subcategory ?? null,
    style_tags: styleTags,
    material_tags: materialTags,
    pattern_tags: patternTags,
    occasion_tags: occasionTags,
    gender,
    season,
    care: null,
    origin: null,
    status: null,
    source_url: rawProduct.sourceUrl ?? null,
    image_cover_url: rawProduct.images?.[0] ?? null,
    variants: buildCanonicalVariants(rawProduct.variants ?? [], rawProduct.currency ?? null, {
      material: materialTags[0] ?? null,
      fit,
    }),
    metadata: {
      platform: platform ?? rawProduct.metadata?.platform ?? null,
      normalized_by: "rules_v3_taxonomy_canon",
    },
  };
};

const isDeterministicRichEnough = (product: CanonicalProduct) => {
  return Boolean(
    product.category ||
      (product.style_tags && product.style_tags.length) ||
      (product.material_tags && product.material_tags.length) ||
      (product.pattern_tags && product.pattern_tags.length) ||
      (product.occasion_tags && product.occasion_tags.length),
  );
};

const shouldUseLlmNormalizer = (
  product: CanonicalProduct,
  platform?: string | null,
) => {
  if (LLM_MODE === "never") return false;
  if (LLM_MODE === "always") return true;
  const normalizedPlatform = (platform ?? "").toLowerCase();
  if (normalizedPlatform === "shopify" || normalizedPlatform === "woocommerce") {
    return false;
  }
  return !isDeterministicRichEnough(product);
};

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
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = raw.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error("JSON parse failed");
  }
};

const coerceProductWrapper = (parsed: any) => {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (parsed.product && typeof parsed.product === "object") return parsed;
  const hasProductShape = parsed.name && parsed.variants;
  if (hasProductShape) {
    return { product: parsed };
  }
  return parsed;
};

const buildLlmInput = (rawProduct: RawProduct) => {
  const trimText = (value: string | null | undefined, limit: number) =>
    value && value.length > limit ? value.slice(0, limit) : value ?? null;

  const trimArray = <T,>(arr: T[] | undefined, limit: number) => (Array.isArray(arr) ? arr.slice(0, limit) : []);

  const metadata = rawProduct.metadata && typeof rawProduct.metadata === "object" && !Array.isArray(rawProduct.metadata)
    ? {
        platform: (rawProduct.metadata as Record<string, unknown>).platform ?? null,
        tags: (rawProduct.metadata as Record<string, unknown>).tags ?? null,
        categories: (rawProduct.metadata as Record<string, unknown>).categories ?? null,
        attributes: (rawProduct.metadata as Record<string, unknown>).attributes ?? null,
        product_type: (rawProduct.metadata as Record<string, unknown>).product_type ?? null,
      }
    : undefined;

  const options = Array.isArray(rawProduct.options)
    ? rawProduct.options.slice(0, 6).map((option) => ({
        name: trimText(option.name, 60) ?? "",
        values: trimArray(option.values, MAX_LLM_OPTION_VALUES),
      }))
    : undefined;

  const variants: RawVariant[] = trimArray(rawProduct.variants, MAX_LLM_VARIANTS).map((variant) => ({
    id: variant.id ?? null,
    sku: variant.sku ?? null,
    options: variant.options ?? undefined,
    price: variant.price ?? null,
    compareAtPrice: variant.compareAtPrice ?? null,
    currency: variant.currency ?? null,
    available: typeof variant.available === "boolean" ? variant.available : null,
    stock: typeof variant.stock === "number" ? variant.stock : null,
    image: variant.image ?? null,
    images: trimArray(variant.images ?? (variant.image ? [variant.image] : []), MAX_LLM_IMAGES),
  }));

  return {
    sourceUrl: rawProduct.sourceUrl,
    externalId: rawProduct.externalId ?? null,
    title: trimText(rawProduct.title ?? null, 200),
    description: trimText(rawProduct.description ?? null, MAX_LLM_DESC_CHARS),
    vendor: trimText(rawProduct.vendor ?? null, 120),
    currency: rawProduct.currency ?? null,
    images: trimArray(rawProduct.images ?? [], MAX_LLM_IMAGES),
    options,
    variants: variants.length ? variants : rawProduct.variants,
    metadata,
  } satisfies RawProduct;
};

export const normalizeCatalogProductWithOpenAI = async (rawProduct: RawProduct) => {
  const client = getOpenAIClient() as any;
  let lastError: unknown = null;
  const payload = buildLlmInput(rawProduct);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: basePrompt },
          {
            role: "user",
            content: JSON.stringify(
              {
                raw_product: payload,
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
      const parsed = coerceProductWrapper(safeJsonParse(raw));
      const validation = openAiResponseSchema.safeParse(parsed);
      if (!validation.success) {
        throw new Error(`JSON validation failed: ${validation.error.message}`);
      }
      const product = validation.data.product as CanonicalProduct;
      // Ensure categories/subcategories are canonical so we never re-introduce legacy taxonomy keys.
      {
        const canon = canonicalizeCategorySubcategory(product.category ?? null, product.subcategory ?? null);
        product.category = canon.category;
        product.subcategory = canon.subcategory;
      }
      if (Array.isArray(product.variants)) {
        product.variants = product.variants.map((variant) => {
          const price = sanitizeCatalogPrice(typeof variant.price === "number" ? variant.price : null);
          const currency = guessCurrency(price, variant.currency ?? null);
          return { ...variant, price, currency: currency ?? variant.currency ?? null };
        });
      }
      return product;
    } catch (error) {
      lastError = error;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw new Error(`OpenAI catalog normalization failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
};

export const normalizeCatalogProduct = async (rawProduct: RawProduct, platform?: string | null) => {
  const deterministic = normalizeCatalogProductDeterministic(rawProduct, platform);
  if (!shouldUseLlmNormalizer(deterministic, platform)) {
    return deterministic;
  }

  if (isLlmTemporarilyDisabled()) {
    return {
      ...deterministic,
      metadata: {
        ...(deterministic.metadata ?? {}),
        llm_normalize: {
          status: "skipped",
          reason: llmDisabledReason ?? "temporarily_disabled",
          disabled_until: new Date(llmDisabledUntil).toISOString(),
          model: OPENAI_MODEL,
        },
      },
    };
  }

  try {
    return await normalizeCatalogProductWithOpenAI(rawProduct);
  } catch (error) {
    const message = toErrorMessage(error);
    if (isQuotaOrBillingError(message) || isMissingApiKeyError(message)) {
      maybeDisableLlmTemporarily(message);
    }
    console.warn("catalog.normalizer.llm_failed_fallback", {
      platform: platform ?? null,
      error: message,
    });
    return {
      ...deterministic,
      metadata: {
        ...(deterministic.metadata ?? {}),
        llm_normalize: {
          status: "failed",
          error: message.slice(0, 280),
          model: OPENAI_MODEL,
          at: new Date().toISOString(),
        },
      },
    };
  }
};
