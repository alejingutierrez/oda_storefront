import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

import {
  CATEGORY_VALUES,
  SUBCATEGORY_BY_CATEGORY,
} from "../src/lib/product-enrichment/constants";

const { Client } = pg;

type Scope = "enriched" | "all";

type Row = {
  product_id: string;
  brand_name: string;
  product_name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  source_url: string | null;
  updated_at: string | null;
  is_enriched: boolean;
};

type Suggestion = {
  category: string;
  subcategory: string | null;
  confidence: number;
  reasons: string[];
  kind: "primary" | "fallback" | "subcategory";
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const args = new Set(process.argv.slice(2));
const getArgValue = (flag: string) => {
  const prefix = `${flag}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return null;
};

const apply = args.has("--apply") || String(process.env.TAXON_APPLY || "").toLowerCase() === "true";
const scope = ((getArgValue("--scope") || process.env.TAXON_SCOPE || "enriched").toLowerCase() as Scope);
const includeNullCategory = args.has("--include-null-category") || String(process.env.TAXON_INCLUDE_NULL_CATEGORY || "").toLowerCase() === "true";
const includeMissingSubcategory =
  args.has("--include-missing-subcategory") ||
  String(process.env.TAXON_INCLUDE_MISSING_SUBCATEGORY || "").toLowerCase() === "true";
const minCategoryConfidence = Number(
  getArgValue("--min-cat-confidence") || process.env.TAXON_MIN_CAT_CONFIDENCE || 0.9,
);
const minMoveCategoryConfidence = Number(
  getArgValue("--min-move-cat-confidence") || process.env.TAXON_MIN_MOVE_CAT_CONFIDENCE || 0.92,
);
const minSubcategoryConfidence = Number(getArgValue("--min-sub-confidence") || process.env.TAXON_MIN_SUB_CONFIDENCE || 0.9);
const limit = Number(getArgValue("--limit") || process.env.TAXON_LIMIT || 0) || null;
const chunkSize = Math.max(50, Number(getArgValue("--chunk-size") || process.env.TAXON_CHUNK_SIZE || 300));

if (scope !== "enriched" && scope !== "all") {
  throw new Error(`Invalid --scope=${scope}. Expected enriched|all.`);
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in environment (.env/.env.local).");
}

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const now = new Date();
const dateKey = now.toISOString().slice(0, 10).replaceAll("-", "");
const timeKey = now.toISOString().slice(11, 19).replaceAll(":", "");
const runKey = `${dateKey}_${timeKey}`;
const outRoot = ensureDir(path.join(repoRoot, "reports"));
const outDir = ensureDir(path.join(outRoot, `taxonomy_remap_noncanonical_${runKey}`));

const canonicalCategorySet = new Set(CATEGORY_VALUES);
const isCanonicalCategory = (value: string) => canonicalCategorySet.has(value);

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripHtml = (value: unknown) => {
  const raw = String(value || "");
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
};

const escapeRe = (value: string) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (word: string) => new RegExp(`(^|\\s)${escapeRe(word)}(\\s|$)`, "i");
const phraseRe = (phrase: string) => new RegExp(`\\b${escapeRe(phrase).replace(/\\s+/g, "\\\\s+")}\\b`, "i");
const includesAny = (text: string, patterns: RegExp[]) => patterns.some((re) => re.test(text));

const toCsv = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
};

const writeCsv = (filePath: string, rows: Record<string, unknown>[], headers: string[]) => {
  const out: string[] = [];
  out.push(headers.join(","));
  for (const row of rows) {
    out.push(headers.map((key) => toCsv(row[key])).join(","));
  }
  fs.writeFileSync(filePath, out.join("\n") + "\n", "utf8");
};

// --- Category detectors (copied from audit-taxonomy.ts, but scoped to remap needs) ---

const BEAUTY_STRONG_PATTERNS = [
  wordRe("perfume"),
  wordRe("perfumes"),
  wordRe("colonia"),
  wordRe("colonias"),
  phraseRe("body splash"),
  phraseRe("splash corporal"),
  phraseRe("eau de parfum"),
  phraseRe("eau de toilette"),
  wordRe("edp"),
  wordRe("edt"),
  wordRe("parfum"),
];

const BEAUTY_FRAGANCIA_PATTERNS = [
  wordRe("fragancia"),
  wordRe("fragancias"),
  wordRe("fragrance"),
  wordRe("fragrances"),
];

// Skin / body care signals. Keep these high precision to avoid color "crema" false-positives.
const BEAUTY_CARE_PATTERNS = [
  phraseRe("crema corporal"),
  phraseRe("body cream"),
  phraseRe("body lotion"),
  phraseRe("hand cream"),
  phraseRe("crema manos"),
  phraseRe("crema de manos"),
  phraseRe("locion corporal"),
  phraseRe("locion"),
  phraseRe("lotion"),
  wordRe("shampoo"),
  wordRe("champu"),
  wordRe("acondicionador"),
  wordRe("conditioner"),
  wordRe("jabon"),
  wordRe("jabones"),
  phraseRe("gel ducha"),
  phraseRe("body wash"),
];

const HOME_AROMA_PATTERNS = [
  wordRe("hogar"),
  wordRe("home"),
  wordRe("ambiente"),
  wordRe("ambientador"),
  wordRe("difusor"),
  wordRe("difusores"),
  wordRe("incienso"),
  wordRe("vela"),
  wordRe("velas"),
  wordRe("candle"),
  wordRe("candles"),
  phraseRe("fragancia de hogar"),
  phraseRe("fragancia ambiente"),
  phraseRe("room spray"),
  phraseRe("home spray"),
  phraseRe("en sticks"),
];

const mlAmountRe = /\b\d{2,4}\s?ml\b/i;

const detectBeauty = (text: string): Suggestion | null => {
  if (includesAny(text, HOME_AROMA_PATTERNS)) return null;

  const hasStrong = includesAny(text, BEAUTY_STRONG_PATTERNS);
  const hasFragancia = includesAny(text, BEAUTY_FRAGANCIA_PATTERNS);
  const hasCare = includesAny(text, BEAUTY_CARE_PATTERNS);
  const hasSplash =
    wordRe("splash").test(text) &&
    (mlAmountRe.test(text) || wordRe("corporal").test(text) || wordRe("body").test(text));

  if (!hasStrong && !hasFragancia && !hasCare && !hasSplash) return null;
  return {
    category: "hogar_y_lifestyle",
    subcategory: "cuidado_personal_y_belleza",
    confidence: hasStrong || hasSplash || hasCare ? 0.99 : 0.96,
    reasons: [
      hasStrong || hasSplash ? "kw:beauty_strong" : hasCare ? "kw:beauty_care" : "kw:beauty_fragancia",
    ],
    kind: "primary",
  };
};

const detectGiftCard = (text: string): Suggestion | null => {
  const patterns = [
    phraseRe("gift card"),
    wordRe("giftcard"),
    phraseRe("tarjeta regalo"),
    phraseRe("tarjeta de regalo"),
    phraseRe("bono de regalo"),
    wordRe("voucher"),
  ];
  if (!includesAny(text, patterns)) return null;
  return {
    category: "tarjeta_regalo",
    subcategory: "gift_card",
    confidence: 0.99,
    reasons: ["kw:gift_card"],
    kind: "primary",
  };
};

const hasSockContext = (text: string) =>
  includesAny(text, [
    // Avoid matching singular "media" (very ambiguous: "media bota", "media pierna", etc).
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("sock"),
    wordRe("socks"),
    wordRe("soquete"),
    wordRe("soquetes"),
  ]);

const hasHairContext = (text: string) =>
  includesAny(text, [
    wordRe("cabello"),
    wordRe("pelo"),
    wordRe("hair"),
    phraseRe("hair pin"),
    phraseRe("bobby pin"),
    wordRe("pasador"),
    wordRe("pasadores"),
    wordRe("gancho"),
    wordRe("ganchos"),
    wordRe("pinza"),
    wordRe("pinzas"),
    wordRe("diadema"),
    wordRe("diademas"),
    wordRe("balaca"),
    wordRe("balacas"),
    wordRe("scrunchie"),
    wordRe("scrunchies"),
  ]);

const detectJewelry = (text: string): Suggestion | null => {
  // NOTE: some jewelry words are ambiguous in product copy for apparel/accessories:
  // - "anillo/ring" can describe hardware on swimwear ("ring bottom") or clothing.
  // - "charm" can describe a bag add-on ("bolso con charm").
  // - "broche" can be a closure on garments.
  //
  // We only classify as jewelry when we see strong jewelry intent, or when ambiguous cues
  // appear without strong bag/swim/apparel context.
  const strong = [
    wordRe("joyeria"),
    wordRe("bisuteria"),
    wordRe("arete"),
    wordRe("aretes"),
    wordRe("pendiente"),
    wordRe("pendientes"),
    wordRe("candonga"),
    wordRe("candongas"),
    wordRe("topo"),
    wordRe("topos"),
    wordRe("collar"),
    wordRe("collares"),
    wordRe("gargantilla"),
    wordRe("choker"),
    wordRe("pulsera"),
    wordRe("pulseras"),
    wordRe("brazalete"),
    wordRe("brazaletes"),
    wordRe("tobillera"),
    wordRe("tobilleras"),
    wordRe("piercing"),
    wordRe("piercings"),
    wordRe("earcuff"),
    wordRe("dije"),
    wordRe("dijes"),
    wordRe("reloj"),
    wordRe("relojes"),
  ];
  const ambiguous = [
    wordRe("anillo"),
    wordRe("anillos"),
    wordRe("charm"),
    wordRe("charms"),
    wordRe("broche"),
    wordRe("broches"),
    wordRe("pin"),
    wordRe("pins"),
  ];

  const hasStrong = includesAny(text, strong);
  const hasAmbiguous = includesAny(text, ambiguous);
  if (!hasStrong && !hasAmbiguous) return null;

  // "tobillera" is ambiguous: can mean jewelry anklet or ankle socks.
  const hasTobillera = wordRe("tobillera").test(text) || wordRe("tobilleras").test(text);
  if (hasTobillera && hasSockContext(text)) return null;

  const hasPin = wordRe("pin").test(text) || wordRe("pins").test(text);
  if (hasPin && hasHairContext(text)) return null;

  if (!hasStrong) {
    const bagContext = [
      wordRe("bolso"),
      wordRe("bolsos"),
      wordRe("cartera"),
      wordRe("canasto"),
      wordRe("mochila"),
      wordRe("morral"),
      wordRe("rinonera"),
      wordRe("canguro"),
      wordRe("billetera"),
      wordRe("maleta"),
      wordRe("equipaje"),
      wordRe("estuche"),
      wordRe("cartuchera"),
      wordRe("neceser"),
      wordRe("lonchera"),
      wordRe("llavero"),
      wordRe("llaveros"),
    ];
    const swimApparelContext = [
      phraseRe("traje de bano"),
      phraseRe("vestido de bano"),
      wordRe("bikini"),
      wordRe("trikini"),
      wordRe("tankini"),
      wordRe("swim"),
      wordRe("swimwear"),
      phraseRe("one piece"),
      phraseRe("one-piece"),
      phraseRe("ring bottom"),
      phraseRe("ring top"),
      wordRe("bottom"),
    ];

    if (includesAny(text, bagContext) || includesAny(text, swimApparelContext)) return null;
  }

  return {
    category: "joyeria_y_bisuteria",
    subcategory: null,
    confidence: hasStrong ? 0.98 : 0.94,
    reasons: [hasStrong ? "kw:jewelry" : "kw:jewelry_ambiguous"],
    kind: "primary",
  };
};

const detectGlasses = (text: string): Suggestion | null => {
  const patterns = [
    wordRe("gafas"),
    wordRe("lentes"),
    wordRe("montura"),
    wordRe("monturas"),
    wordRe("optica"),
    wordRe("sunglasses"),
    wordRe("goggles"),
  ];
  if (!includesAny(text, patterns)) return null;
  return { category: "gafas_y_optica", subcategory: null, confidence: 0.98, reasons: ["kw:glasses"], kind: "primary" };
};

const looksLikePantsBotaFit = (text: string) => {
  const botaFitPantsPatterns = [
    phraseRe("bota recta"),
    phraseRe("bota ancha"),
    phraseRe("bota amplia"),
    phraseRe("bota muy ancha"),
    phraseRe("bota campana"),
    phraseRe("bota flare"),
    phraseRe("bota resortada"),
    phraseRe("bota tubo"),
    phraseRe("bota recto"),
    phraseRe("bota skinny"),
    phraseRe("bota medio"),
    phraseRe("bota media"),
    phraseRe("bota palazzo"),
    phraseRe("bota ajustable"),
    phraseRe("botas ajustables"),
    phraseRe("efecto en bota"),
  ];
  if (includesAny(text, botaFitPantsPatterns)) return true;
  const bottomsContext = [
    wordRe("pantalon"),
    wordRe("pantalones"),
    wordRe("jogger"),
    wordRe("cargo"),
    wordRe("palazzo"),
    wordRe("culotte"),
    wordRe("legging"),
    wordRe("leggings"),
  ];
  return includesAny(text, bottomsContext) && includesAny(text, [wordRe("bota"), wordRe("botas")]);
};

const detectFootwear = (text: string): Suggestion | null => {
  // Brand/domain heuristic: some catalogs omit "zapato/tenis" in titles, but the domain is an explicit shoe store.
  if (text.includes("kannibalshoes")) {
    return { category: "calzado", subcategory: null, confidence: 0.96, reasons: ["kw:footwear_domain"], kind: "primary" };
  }

  const strongPatterns = [
    wordRe("zapato"),
    wordRe("zapatos"),
    wordRe("tenis"),
    wordRe("sneaker"),
    wordRe("sneakers"),
    wordRe("sandalia"),
    wordRe("sandalias"),
    wordRe("tacon"),
    wordRe("tacones"),
    wordRe("botin"),
    wordRe("botines"),
    wordRe("mocasin"),
    wordRe("mocasines"),
    wordRe("loafers"),
    wordRe("balerina"),
    wordRe("balerinas"),
    wordRe("flats"),
    wordRe("alpargata"),
    wordRe("alpargatas"),
    wordRe("espadrille"),
    wordRe("espadrilles"),
    wordRe("zueco"),
    wordRe("zuecos"),
    wordRe("chancla"),
    wordRe("chanclas"),
    phraseRe("flip flops"),
    phraseRe("flip flop"),
    phraseRe("low top"),
    phraseRe("high top"),
  ];
  const bootPatterns = [wordRe("bota"), wordRe("botas"), wordRe("boot"), wordRe("boots")];

  if (includesAny(text, strongPatterns)) {
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"], kind: "primary" };
  }

  if (includesAny(text, bootPatterns)) {
    if (looksLikePantsBotaFit(text)) return null;
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"], kind: "primary" };
  }

  return null;
};

const detectMalaiSwimPiece = (text: string): Suggestion | null => {
  // Brand/domain heuristic: Malai catalogs name pieces as "Top"/"Bottom"/"Thong" without the word "bikini".
  // We rely on the domain being present in the URL and a swim-piece keyword in the title/slug.
  if (!text.includes("malaiswimwear")) return null;

  const hasCoverup = includesAny(text, [
    wordRe("kimono"),
    wordRe("kaftan"),
    wordRe("caftan"),
    wordRe("coverup"),
    phraseRe("cover up"),
    phraseRe("cover-up"),
  ]);
  if (hasCoverup) {
    return {
      category: "trajes_de_bano_y_playa",
      subcategory: "salida_de_bano_kaftan",
      confidence: 0.94,
      reasons: ["kw:swim", "dom:malai", "kw:coverup"],
      kind: "primary",
    };
  }

  const hasOnePiece = includesAny(text, [phraseRe("one piece"), phraseRe("one-piece")]);
  const hasTop = includesAny(text, [
    wordRe("top"),
    wordRe("bandeau"),
    wordRe("triangle"),
    wordRe("underwire"),
    wordRe("bralette"),
    wordRe("basal"),
  ]);
  const hasBottom = includesAny(text, [wordRe("bottom"), wordRe("bottoms"), wordRe("thong"), wordRe("thongs")]);
  if (!hasOnePiece && !hasTop && !hasBottom) return null;

  if (hasOnePiece) {
    return {
      category: "trajes_de_bano_y_playa",
      subcategory: "vestido_de_bano_entero",
      confidence: 0.96,
      reasons: ["kw:swim", "dom:malai", "kw:one_piece"],
      kind: "primary",
    };
  }

  return {
    category: "trajes_de_bano_y_playa",
    subcategory: "bikini",
    confidence: 0.94,
    reasons: ["kw:swim", "dom:malai", hasBottom ? "kw:bottom" : "kw:top"],
    kind: "primary",
  };
};

const detectBags = (text: string): Suggestion | null => {
  // Brand-specific: Mercedes Salazar "Lupita" are small bags/pouches, and titles don't include "bolso".
  if (text.includes("mercedessalazar") && includesAny(text, [wordRe("lupita"), wordRe("lupitas")])) {
    return {
      category: "bolsos_y_marroquineria",
      subcategory: "cartera_bolso_de_mano",
      confidence: 0.96,
      reasons: ["kw:bags", "dom:mercedes", "kw:lupita"],
      kind: "primary",
    };
  }

  const patterns = [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("bolsa"),
    wordRe("bolsas"),
    wordRe("bag"),
    wordRe("bags"),
    wordRe("cartera"),
    wordRe("carteras"),
    phraseRe("bolsa de golf"),
    phraseRe("bolsa golf"),
    phraseRe("golf bag"),
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("tarjetero"),
    wordRe("tarjeteros"),
    phraseRe("money clip"),
    wordRe("moneyclip"),
    wordRe("monedero"),
    wordRe("monederos"),
    wordRe("mochila"),
    wordRe("mochilas"),
    wordRe("morral"),
    wordRe("morrales"),
    wordRe("rinonera"),
    wordRe("rinoneras"),
    wordRe("canguro"),
    wordRe("clutch"),
    wordRe("sobre"),
    wordRe("bandolera"),
    wordRe("crossbody"),
    phraseRe("manos libres"),
    wordRe("cartuchera"),
    wordRe("cartucheras"),
    wordRe("estuche"),
    wordRe("estuches"),
    wordRe("neceser"),
    wordRe("neceseres"),
    wordRe("cosmetiquera"),
    wordRe("cosmetiqueras"),
    wordRe("pouch"),
    wordRe("pouches"),
    wordRe("lapicera"),
    wordRe("lapiceras"),
    wordRe("lonchera"),
    wordRe("loncheras"),
    wordRe("lunchbox"),
    wordRe("tula"),
    wordRe("tulas"),
    wordRe("canasto"),
    wordRe("canastos"),
    wordRe("maleta"),
    wordRe("maletas"),
    wordRe("equipaje"),
    wordRe("trolley"),
    wordRe("luggage"),
    wordRe("suitcase"),
    wordRe("llavero"),
    wordRe("llaveros"),
    wordRe("keychain"),
    wordRe("keychains"),
    phraseRe("porta pasaporte"),
    phraseRe("porta documentos"),
    phraseRe("portadocumentos"),
  ];
  if (!includesAny(text, patterns)) return null;
  return { category: "bolsos_y_marroquineria", subcategory: null, confidence: 0.98, reasons: ["kw:bags"], kind: "primary" };
};

const detectHomeLifestyle = (text: string): Suggestion | null => {
  const kitchen = [
    wordRe("plato"),
    wordRe("platos"),
    wordRe("plate"),
    wordRe("plates"),
    wordRe("vajilla"),
    wordRe("taza"),
    wordRe("tazas"),
    wordRe("mug"),
    wordRe("mugs"),
    wordRe("bowl"),
    wordRe("bowls"),
    wordRe("copa"),
    wordRe("copas"),
  ];
  if (includesAny(text, kitchen)) {
    return { category: "hogar_y_lifestyle", subcategory: "cocina_y_vajilla", confidence: 0.95, reasons: ["kw:home_kitchen"], kind: "primary" };
  }

  const tableTextiles = [
    wordRe("mantel"),
    wordRe("manteles"),
    wordRe("individual"),
    wordRe("individuales"),
    wordRe("posavasos"),
    wordRe("servilleta"),
    wordRe("servilletas"),
    wordRe("servilletero"),
    wordRe("servilleteros"),
    phraseRe("camino de mesa"),
    wordRe("placemat"),
    wordRe("placemats"),
    wordRe("napkin"),
    wordRe("napkins"),
    phraseRe("napkin ring"),
    phraseRe("napkin rings"),
    wordRe("coaster"),
    wordRe("coasters"),
  ];
  if (includesAny(text, tableTextiles)) {
    return { category: "hogar_y_lifestyle", subcategory: "textiles_de_mesa", confidence: 0.95, reasons: ["kw:home_table"], kind: "primary" };
  }

  const pillows = [
    wordRe("cojin"),
    wordRe("cojines"),
    wordRe("funda"),
    wordRe("fundas"),
    wordRe("pillow"),
    wordRe("pillows"),
    phraseRe("pillowcase"),
  ];
  if (includesAny(text, pillows)) {
    return { category: "hogar_y_lifestyle", subcategory: "cojines_y_fundas", confidence: 0.94, reasons: ["kw:home_pillow"], kind: "primary" };
  }

  const candles = [
    wordRe("vela"),
    wordRe("velas"),
    wordRe("candle"),
    wordRe("candles"),
    wordRe("difusor"),
    wordRe("difusores"),
    wordRe("incienso"),
    phraseRe("room spray"),
    phraseRe("home spray"),
  ];
  if (includesAny(text, candles)) {
    return { category: "hogar_y_lifestyle", subcategory: "velas_y_aromas", confidence: 0.94, reasons: ["kw:home_aroma"], kind: "primary" };
  }

  const towels = [
    wordRe("toalla"),
    wordRe("toallas"),
    phraseRe("toalla de bano"),
    phraseRe("toalla de baño"),
    phraseRe("bath towel"),
  ];
  if (includesAny(text, towels) && !includesAny(text, [phraseRe("traje de bano"), phraseRe("traje de baño")])) {
    return { category: "hogar_y_lifestyle", subcategory: "toallas_y_bano", confidence: 0.9, reasons: ["kw:home_towel"], kind: "primary" };
  }

  const blankets = [wordRe("manta"), wordRe("mantas"), wordRe("cobija"), wordRe("cobijas"), wordRe("blanket"), wordRe("blankets")];
  if (includesAny(text, blankets)) {
    return { category: "hogar_y_lifestyle", subcategory: "mantas_y_cobijas", confidence: 0.9, reasons: ["kw:home_blanket"], kind: "primary" };
  }

  const art = [
    wordRe("poster"),
    wordRe("posters"),
    wordRe("lamina"),
    wordRe("laminas"),
    phraseRe("wall art"),
    wordRe("ilustracion"),
    wordRe("illustration"),
    wordRe("arte"),
  ];
  if (includesAny(text, art)) {
    return { category: "hogar_y_lifestyle", subcategory: "arte_y_posters", confidence: 0.9, reasons: ["kw:home_art"], kind: "primary" };
  }

  const paper = [
    wordRe("papeleria"),
    wordRe("libro"),
    wordRe("libros"),
    wordRe("cuaderno"),
    wordRe("cuadernos"),
    wordRe("agenda"),
    wordRe("agendas"),
    wordRe("stationery"),
    wordRe("notebook"),
    wordRe("notebooks"),
  ];
  if (includesAny(text, paper)) {
    return { category: "hogar_y_lifestyle", subcategory: "papeleria_y_libros", confidence: 0.9, reasons: ["kw:home_paper"], kind: "primary" };
  }

  const other = [
    wordRe("termo"),
    wordRe("termos"),
    wordRe("botella"),
    wordRe("botellas"),
    phraseRe("water bottle"),
    phraseRe("bottle"),
    wordRe("stanley"),
    wordRe("portacomidas"),
    phraseRe("porta comidas"),
    wordRe("lunch"),
    wordRe("tupper"),
    wordRe("abanico"),
    wordRe("abanicos"),
    // Desk/work accessories are treated as lifestyle.
    wordRe("escritorio"),
    phraseRe("desk mat"),
    phraseRe("mat escritorio"),
    wordRe("mousepad"),
    phraseRe("mouse pad"),
  ];
  if (includesAny(text, other)) {
    return { category: "hogar_y_lifestyle", subcategory: "hogar_otros", confidence: 0.9, reasons: ["kw:home_other"], kind: "primary" };
  }

  return null;
};

const detectTextileAccessory = (text: string): Suggestion | null => {
  const patterns = [
    // socks
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("pantimedia"),
    wordRe("pantimedias"),
    // textile accessories
    wordRe("cinturon"),
    wordRe("cinturones"),
    wordRe("correa"),
    wordRe("belt"),
    wordRe("gorro"),
    wordRe("gorros"),
    wordRe("beanie"),
    wordRe("gorra"),
    wordRe("gorras"),
    wordRe("sombrero"),
    wordRe("sombreros"),
    wordRe("bufanda"),
    wordRe("bufandas"),
    wordRe("guante"),
    wordRe("guantes"),
    wordRe("panuelo"),
    wordRe("panuelos"),
    wordRe("bandana"),
    wordRe("bandanas"),
    wordRe("corbata"),
    wordRe("corbatas"),
    wordRe("pajarita"),
    wordRe("pajaritas"),
    wordRe("corbatin"),
    wordRe("corbatines"),
    wordRe("tirante"),
    wordRe("tirantes"),
    wordRe("chal"),
    wordRe("chales"),
    wordRe("pashmina"),
    wordRe("pashminas"),
    wordRe("tapabocas"),
    wordRe("mascarilla"),
    wordRe("mascarillas"),
    // hair
    wordRe("diadema"),
    wordRe("balaca"),
    wordRe("tiara"),
    wordRe("pinza"),
    wordRe("gancho"),
    wordRe("scrunchie"),
    phraseRe("para el cabello"),
    phraseRe("para cabello"),
    wordRe("hair"),
  ];
  if (!includesAny(text, patterns)) return null;
  return {
    category: "accesorios_textiles_y_medias",
    subcategory: null,
    confidence: 0.9,
    reasons: ["kw:textile_accessory"],
    kind: "primary",
  };
};

const detectApparelCategory = (text: string): Suggestion | null => {
  // High-precision only; when ambiguous, return null.
  const rules: Array<{ category: string; confidence: number; reasons: string[]; patterns: RegExp[] }> = [
    { category: "uniformes_y_ropa_de_trabajo_escolar", confidence: 0.95, reasons: ["kw:uniform"], patterns: [wordRe("uniforme"), wordRe("scrubs"), wordRe("dotacion"), wordRe("industrial"), phraseRe("alta visibilidad")] },
    { category: "ropa_de_bebe_0_24_meses", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("recien"), wordRe("mameluco"), wordRe("pelele"), phraseRe("0 24"), phraseRe("0-24")] },
    {
      category: "trajes_de_bano_y_playa",
      confidence: 0.95,
      reasons: ["kw:swim"],
      patterns: [
        wordRe("bikini"),
        wordRe("trikini"),
        phraseRe("traje de bano"),
        phraseRe("vestido de bano"),
        wordRe("tankini"),
        wordRe("rashguard"),
        phraseRe("licra uv"),
        phraseRe("salida de bano"),
        wordRe("pareo"),
        // Often used in catalogs for swim shorts/pieces.
        wordRe("pantaloneta"),
        wordRe("pantalonetas"),
        wordRe("boardshort"),
        wordRe("boardshorts"),
        wordRe("swimwear"),
        wordRe("swimsuit"),
      ],
    },
    { category: "pijamas_y_ropa_de_descanso_loungewear", confidence: 0.93, reasons: ["kw:pijama"], patterns: [wordRe("pijama"), wordRe("camison"), wordRe("batola"), wordRe("bata"), wordRe("robe"), wordRe("loungewear")] },
    { category: "lenceria_y_fajas_shapewear", confidence: 0.93, reasons: ["kw:shapewear"], patterns: [wordRe("faja"), wordRe("shapewear"), wordRe("corse"), wordRe("corset"), wordRe("liguero"), wordRe("babydoll")] },
    {
      category: "ropa_interior_basica",
      confidence: 0.92,
      reasons: ["kw:underwear"],
      patterns: [
        wordRe("brasier"),
        wordRe("bralette"),
        wordRe("panty"),
        wordRe("trusa"),
        wordRe("tanga"),
        wordRe("tangas"),
        wordRe("brasilera"),
        wordRe("cachetero"),
        wordRe("cachetera"),
        wordRe("boxer"),
        wordRe("brief"),
        wordRe("briefs"),
        wordRe("interior"),
      ],
    },
    { category: "ropa_deportiva_y_performance", confidence: 0.9, reasons: ["kw:sport"], patterns: [wordRe("deportivo"), wordRe("running"), wordRe("ciclismo"), wordRe("gym"), wordRe("entrenamiento"), wordRe("compresion"), wordRe("compression")] },
    // English/shortcodes used by some brands (Tinta Latina, etc).
    { category: "camisas_y_blusas", confidence: 0.95, reasons: ["kw:blouse"], patterns: [wordRe("blouse"), wordRe("blouses"), wordRe("bluson")] },
    { category: "pantalones_no_denim", confidence: 0.95, reasons: ["kw:pants"], patterns: [wordRe("pants"), wordRe("trousers")] },
    { category: "faldas", confidence: 0.95, reasons: ["kw:skirt"], patterns: [wordRe("skirt"), wordRe("skirts")] },
    { category: "blazers_y_sastreria", confidence: 0.94, reasons: ["kw:vest"], patterns: [wordRe("vest"), wordRe("waistcoat")] },
    { category: "vestidos", confidence: 0.92, reasons: ["kw:vestido"], patterns: [wordRe("vestido"), wordRe("dress")] },
    { category: "enterizos_y_overoles", confidence: 0.92, reasons: ["kw:enterizo"], patterns: [wordRe("enterizo"), wordRe("jumpsuit"), wordRe("jumpsit"), wordRe("romper"), wordRe("overol"), wordRe("jardinera")] },
    { category: "conjuntos_y_sets_2_piezas", confidence: 0.9, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("sets"), wordRe("conjunto"), wordRe("conjuntos"), phraseRe("2 piezas"), phraseRe("2pzs"), phraseRe("matching set")] },
    { category: "faldas", confidence: 0.92, reasons: ["kw:falda"], patterns: [wordRe("falda"), wordRe("skort")] },
    { category: "shorts_y_bermudas", confidence: 0.92, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts"), wordRe("bermuda"), wordRe("bermudas")] },
    { category: "jeans_y_denim", confidence: 0.92, reasons: ["kw:jean"], patterns: [wordRe("jean"), wordRe("jeans"), wordRe("denim")] },
    { category: "pantalones_no_denim", confidence: 0.92, reasons: ["kw:jogger"], patterns: [wordRe("jogger")] },
    { category: "pantalones_no_denim", confidence: 0.92, reasons: ["kw:leggings"], patterns: [wordRe("leggins"), wordRe("legging"), wordRe("leggings")] },
    { category: "pantalones_no_denim", confidence: 0.92, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("pantalones"), wordRe("cargo"), wordRe("palazzo"), wordRe("culotte")] },
    { category: "blazers_y_sastreria", confidence: 0.92, reasons: ["kw:blazer"], patterns: [wordRe("blazer"), wordRe("sastr"), wordRe("smoking"), wordRe("tuxedo")] },
    { category: "chaquetas_y_abrigos", confidence: 0.92, reasons: ["kw:chaleco"], patterns: [wordRe("chaleco"), wordRe("chalecos")] },
    { category: "chaquetas_y_abrigos", confidence: 0.92, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta"), wordRe("abrigo"), wordRe("trench"), wordRe("parka"), wordRe("bomber"), wordRe("impermeable"), wordRe("rompevientos")] },
    { category: "buzos_hoodies_y_sueteres", confidence: 0.92, reasons: ["kw:buzo"], patterns: [wordRe("hoodie"), wordRe("buzo"), wordRe("sueter"), wordRe("sweater"), wordRe("cardigan"), wordRe("ruana"), wordRe("saco"), phraseRe("half zip"), phraseRe("full zip"), phraseRe("hal zip"), wordRe("halfzip"), wordRe("fullzip"), wordRe("halzip"), wordRe("half-zip"), wordRe("full-zip")] },
    { category: "camisas_y_blusas", confidence: 0.92, reasons: ["kw:camisa"], patterns: [wordRe("camisa"), wordRe("blusa"), wordRe("guayabera"), wordRe("bluson")] },
    { category: "camisetas_y_tops", confidence: 0.94, reasons: ["kw:polo"], patterns: [wordRe("polo"), phraseRe("camiseta polo")] },
    { category: "camisetas_y_tops", confidence: 0.92, reasons: ["kw:body"], patterns: [wordRe("body"), wordRe("bodysuit")] },
    { category: "camisetas_y_tops", confidence: 0.9, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), wordRe("camisilla"), wordRe("esqueleto"), phraseRe("t shirt"), wordRe("tshirt"), wordRe("tee"), wordRe("top")] },
  ];

  for (const rule of rules) {
    if (includesAny(text, rule.patterns)) {
      return { category: rule.category, subcategory: null, confidence: rule.confidence, reasons: rule.reasons, kind: "primary" };
    }
  }
  return null;
};

const inferCanonicalCategory = (text: string): Suggestion | null => {
  // Order matters: strong non-fashion buckets first, then fashion categories.
  return (
    detectGiftCard(text) ||
    detectBeauty(text) ||
    detectHomeLifestyle(text) ||
    detectJewelry(text) ||
    detectGlasses(text) ||
    detectBags(text) ||
    detectFootwear(text) ||
    detectMalaiSwimPiece(text) ||
    detectTextileAccessory(text) ||
    detectApparelCategory(text)
  );
};

const SAFE_MOVE_REASONS = new Set([
  "kw:gift_card",
  "kw:beauty_strong",
  "kw:beauty_fragancia",
  "kw:beauty_care",
  "kw:home_kitchen",
  "kw:home_table",
  "kw:home_pillow",
  "kw:home_aroma",
  "kw:home_towel",
  "kw:home_blanket",
  "kw:home_art",
  "kw:home_paper",
  "kw:home_other",
  "kw:jewelry",
  "kw:glasses",
  "kw:bags",
  "kw:footwear",
  "kw:footwear_domain",
  "kw:textile_accessory",
  "kw:uniform",
  "kw:bebe",
  "kw:swim",
  "kw:pijama",
  "kw:shapewear",
  "kw:underwear",
  "kw:sport",
  // Apparel moves (only when confidence is high and we are fixing missing/non-canonical rows).
  "kw:blouse",
  "kw:pants",
  "kw:skirt",
  "kw:vest",
  "kw:vestido",
  "kw:enterizo",
  "kw:falda",
  "kw:short",
  "kw:jean",
  "kw:jogger",
  "kw:leggings",
  "kw:pantalon",
  "kw:blazer",
  "kw:chaleco",
  "kw:chaqueta",
  "kw:buzo",
  "kw:camisa",
  "kw:polo",
  "kw:body",
]);

function isSafeCategoryMoveSuggestion(suggestion: Suggestion) {
  // Explicitly block ambiguous jewelry signals (anillo/broche/charm without strong jewelry intent).
  if (suggestion.reasons.includes("kw:jewelry_ambiguous")) return false;
  return suggestion.reasons.some((reason) => SAFE_MOVE_REASONS.has(reason));
}

// --- Subcategory inference rules (within canonical categories) ---

type SubRule = { key: string; confidence: number; patterns: RegExp[]; reasons: string[] };

// High value + stable subset (kept in sync with audit-taxonomy.ts).
const SUBRULES: Record<string, SubRule[]> = {
  camisetas_y_tops: [
    { key: "body_bodysuit", confidence: 0.96, reasons: ["kw:body"], patterns: [wordRe("body"), wordRe("bodysuit"), wordRe("bodi"), wordRe("bodie")] },
    { key: "polo", confidence: 0.95, reasons: ["kw:polo"], patterns: [wordRe("polo"), wordRe("pique"), phraseRe("camiseta polo")] },
    { key: "henley_camiseta_con_botones", confidence: 0.94, reasons: ["kw:henley"], patterns: [wordRe("henley")] },
    { key: "top_basico_strap_top_tiras", confidence: 0.93, reasons: ["kw:strap_top"], patterns: [wordRe("strap"), wordRe("spaghetti"), phraseRe("top tiras"), phraseRe("top de tiras"), phraseRe("strap top")] },
    { key: "tank_top", confidence: 0.93, reasons: ["kw:tank_top"], patterns: [phraseRe("tank top"), wordRe("tanktop")] },
    { key: "camisilla_esqueleto_sin_mangas", confidence: 0.92, reasons: ["kw:sin_mangas"], patterns: [wordRe("camisilla"), wordRe("esqueleto"), phraseRe("sin mangas"), wordRe("sisa"), wordRe("sleeveless")] },
    { key: "crop_top", confidence: 0.9, reasons: ["kw:crop"], patterns: [wordRe("crop"), phraseRe("crop top")] },
    { key: "camiseta_cuello_alto_tortuga", confidence: 0.9, reasons: ["kw:cuello_alto"], patterns: [wordRe("tortuga"), wordRe("turtleneck"), phraseRe("cuello alto")] },
    { key: "camiseta_manga_larga", confidence: 0.9, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve"), wordRe("m l")] },
    // Fallback for generic "top" (no sleeve/fit signal). Useful for catalogs that label everything as "top".
    { key: "top_basico_strap_top_tiras", confidence: 0.9, reasons: ["kw:top"], patterns: [wordRe("top")] },
    { key: "camiseta_manga_corta", confidence: 0.92, reasons: ["kw:camiseta"], patterns: [phraseRe("manga corta"), phraseRe("short sleeve"), wordRe("camiseta"), wordRe("camisetas"), phraseRe("t shirt"), wordRe("tshirt"), phraseRe("t-shirt"), wordRe("tee")] },
  ],
  camisas_y_blusas: [
    { key: "guayabera", confidence: 0.96, reasons: ["kw:guayabera"], patterns: [wordRe("guayabera")] },
    { key: "camisa_denim", confidence: 0.94, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean"), phraseRe("camisa jean")] },
    { key: "camisa_de_lino", confidence: 0.94, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "camisa_estampada", confidence: 0.9, reasons: ["kw:estampada"], patterns: [wordRe("estampada"), wordRe("print"), wordRe("printed")] },
    { key: "camisa_formal", confidence: 0.94, reasons: ["kw:formal"], patterns: [wordRe("formal"), wordRe("office"), wordRe("vestir"), wordRe("antiarrugas"), phraseRe("wrinkle free"), phraseRe("non iron")] },
    { key: "blusa_off_shoulder_hombros_descubiertos", confidence: 0.92, reasons: ["kw:off_shoulder"], patterns: [phraseRe("off shoulder"), phraseRe("hombros descubiertos"), phraseRe("escote bandeja")] },
    { key: "blusa_tipo_tunica", confidence: 0.92, reasons: ["kw:tunica"], patterns: [wordRe("tunica"), wordRe("tunika"), wordRe("bluson"), wordRe("blusones")] },
    { key: "blusa_cuello_alto", confidence: 0.9, reasons: ["kw:cuello_alto"], patterns: [phraseRe("cuello alto"), wordRe("turtleneck")] },
    { key: "blusa_manga_larga", confidence: 0.9, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve")] },
    { key: "blusa_manga_corta", confidence: 0.9, reasons: ["kw:manga_corta"], patterns: [phraseRe("manga corta"), phraseRe("short sleeve")] },
    // English catalogs that only use "blouse" without sleeve hints.
    { key: "blusa_manga_larga", confidence: 0.9, reasons: ["kw:blouse"], patterns: [wordRe("blouse"), wordRe("blouses")] },
    // Fallback for Spanish "blusa" when sleeve isn't specified.
    { key: "blusa_manga_larga", confidence: 0.9, reasons: ["kw:blusa"], patterns: [wordRe("blusa"), wordRe("blusas")] },
    { key: "camisa_casual", confidence: 0.92, reasons: ["kw:camisa"], patterns: [wordRe("camisa"), wordRe("camisas"), wordRe("shirt")] },
  ],
  vestidos: [
    { key: "vestido_infantil", confidence: 0.96, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nino"), wordRe("nina"), wordRe("bebe"), wordRe("baby"), wordRe("kids")] },
    { key: "vestido_camisero", confidence: 0.95, reasons: ["kw:camisero"], patterns: [wordRe("camisero"), phraseRe("vestido camisero")] },
    { key: "vestido_sueter", confidence: 0.94, reasons: ["kw:sweater"], patterns: [wordRe("sueter"), wordRe("sweater")] },
    { key: "vestido_coctel", confidence: 0.94, reasons: ["kw:coctel"], patterns: [wordRe("coctel"), wordRe("cocktail")] },
    { key: "vestido_formal_noche", confidence: 0.93, reasons: ["kw:noche"], patterns: [wordRe("formal"), wordRe("noche"), wordRe("gala")] },
    { key: "vestido_de_fiesta", confidence: 0.92, reasons: ["kw:fiesta"], patterns: [wordRe("fiesta"), phraseRe("party dress")] },
    { key: "vestido_de_verano", confidence: 0.92, reasons: ["kw:verano"], patterns: [wordRe("verano"), phraseRe("summer dress")] },
    { key: "vestido_midi", confidence: 0.9, reasons: ["kw:midi"], patterns: [wordRe("midi")] },
    { key: "vestido_maxi", confidence: 0.9, reasons: ["kw:maxi"], patterns: [wordRe("maxi"), wordRe("largo"), wordRe("larga")] },
    { key: "vestido_mini", confidence: 0.9, reasons: ["kw:mini"], patterns: [wordRe("mini"), wordRe("corto"), wordRe("corta")] },
    { key: "vestido_casual", confidence: 0.9, reasons: ["kw:casual"], patterns: [wordRe("casual"), wordRe("dress"), wordRe("dresses"), wordRe("vestido"), wordRe("vestidos")] },
  ],
  pantalones_no_denim: [
    { key: "pantalon_chino", confidence: 0.92, reasons: ["kw:chino"], patterns: [wordRe("chino"), wordRe("chinos")] },
    { key: "pantalon_cargo", confidence: 0.92, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
    { key: "jogger_casual", confidence: 0.92, reasons: ["kw:jogger"], patterns: [wordRe("jogger")] },
    { key: "palazzo", confidence: 0.92, reasons: ["kw:palazzo"], patterns: [wordRe("palazzo"), phraseRe("wide leg"), phraseRe("wide-leg"), phraseRe("pantalon ancho"), phraseRe("pantalones anchos")] },
    { key: "culotte", confidence: 0.92, reasons: ["kw:culotte"], patterns: [wordRe("culotte")] },
    { key: "leggings_casual", confidence: 0.9, reasons: ["kw:leggings"], patterns: [wordRe("leggins"), wordRe("legging"), wordRe("leggings")] },
    { key: "pantalon_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "pantalon_de_dril", confidence: 0.9, reasons: ["kw:dril"], patterns: [wordRe("dril"), wordRe("sarga"), wordRe("twill")] },
    { key: "pantalon_skinny_no_denim", confidence: 0.9, reasons: ["kw:skinny"], patterns: [wordRe("skinny")] },
    { key: "pantalon_flare_no_denim", confidence: 0.9, reasons: ["kw:flare"], patterns: [wordRe("flare")] },
    // Catch-all for generic "pantalón/pants" listings without more detail.
    { key: "pantalon_de_dril", confidence: 0.9, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("pantalones"), wordRe("pants"), wordRe("pant")] },
  ],
  jeans_y_denim: [
    { key: "jean_skinny", confidence: 0.92, reasons: ["kw:skinny"], patterns: [wordRe("skinny")] },
    { key: "jean_slim", confidence: 0.92, reasons: ["kw:slim"], patterns: [wordRe("slim")] },
    { key: "jean_straight", confidence: 0.92, reasons: ["kw:straight"], patterns: [wordRe("straight")] },
    { key: "jean_wide_leg", confidence: 0.92, reasons: ["kw:wide_leg"], patterns: [phraseRe("wide leg"), phraseRe("wide-leg")] },
    { key: "jean_mom", confidence: 0.9, reasons: ["kw:mom"], patterns: [wordRe("mom")] },
    { key: "jean_boyfriend", confidence: 0.9, reasons: ["kw:boyfriend"], patterns: [wordRe("boyfriend")] },
    { key: "jean_bootcut", confidence: 0.9, reasons: ["kw:bootcut"], patterns: [wordRe("bootcut")] },
    { key: "jean_flare", confidence: 0.9, reasons: ["kw:flare"], patterns: [wordRe("flare")] },
    { key: "jean_distressed_rotos", confidence: 0.9, reasons: ["kw:distressed"], patterns: [wordRe("distressed"), wordRe("rotos"), wordRe("destroyed")] },
    { key: "jean_infantil", confidence: 0.92, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids"), wordRe("kid"), wordRe("nino"), wordRe("nina"), wordRe("bebe"), wordRe("baby")] },
    // Fallback when the fit isn't stated (many catalogs only say "Jean ...").
    { key: "jean_regular", confidence: 0.9, reasons: ["kw:jean"], patterns: [wordRe("jean"), wordRe("jeans")] },
  ],
  shorts_y_bermudas: [
    { key: "bermuda", confidence: 0.92, reasons: ["kw:bermuda"], patterns: [wordRe("bermuda")] },
    { key: "biker_short", confidence: 0.92, reasons: ["kw:biker"], patterns: [wordRe("biker")] },
    { key: "short_deportivo", confidence: 0.9, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport")] },
    { key: "short_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "short_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "short_cargo", confidence: 0.9, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
    { key: "short_de_vestir", confidence: 0.92, reasons: ["kw:vestir"], patterns: [wordRe("vestir"), wordRe("tailored"), wordRe("sastre")] },
    { key: "short_infantil", confidence: 0.92, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids"), wordRe("kid"), wordRe("nino"), wordRe("nina")] },
    // Catch-all (when nothing else matches).
    { key: "short_casual_algodon", confidence: 0.9, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts")] },
  ],
  faldas: [
    { key: "falda_short_skort", confidence: 0.92, reasons: ["kw:skort"], patterns: [wordRe("skort"), phraseRe("falda short"), phraseRe("falda-short")] },
    { key: "falda_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "falda_plisada", confidence: 0.92, reasons: ["kw:plisada"], patterns: [wordRe("plisada"), wordRe("pleated")] },
    { key: "falda_lapiz", confidence: 0.9, reasons: ["kw:lapiz"], patterns: [wordRe("lapiz"), phraseRe("pencil")] },
    { key: "falda_cruzada_wrap", confidence: 0.9, reasons: ["kw:wrap"], patterns: [wordRe("wrap"), wordRe("cruzada")] },
    { key: "falda_skater", confidence: 0.9, reasons: ["kw:skater"], patterns: [wordRe("skater")] },
    { key: "falda_tutu_nina", confidence: 0.92, reasons: ["kw:tutu"], patterns: [wordRe("tutu"), wordRe("tutú")] },
    { key: "mini_falda", confidence: 0.92, reasons: ["kw:mini"], patterns: [wordRe("mini")] },
    { key: "falda_midi", confidence: 0.92, reasons: ["kw:midi"], patterns: [wordRe("midi")] },
    { key: "falda_maxi", confidence: 0.92, reasons: ["kw:maxi"], patterns: [wordRe("maxi")] },
    // Fallback when no length/shape is stated.
    { key: "falda_midi", confidence: 0.9, reasons: ["kw:falda"], patterns: [wordRe("falda"), wordRe("skirt")] },
  ],
  accesorios_textiles_y_medias: [
    { key: "pantimedias_medias_veladas", confidence: 0.95, reasons: ["kw:pantimedias"], patterns: [wordRe("pantimedia"), wordRe("pantimedias"), phraseRe("media velada"), wordRe("tights"), wordRe("denier")] },
    { key: "medias_calcetines", confidence: 0.92, reasons: ["kw:medias"], patterns: [wordRe("calcetin"), wordRe("calcetines"), wordRe("media"), wordRe("medias"), wordRe("sock"), wordRe("socks"), wordRe("soquete"), wordRe("soquetes")] },
    { key: "cinturones", confidence: 0.92, reasons: ["kw:cinturon"], patterns: [wordRe("cinturon"), wordRe("cinturones"), wordRe("correa"), wordRe("belt"), wordRe("hebilla")] },
    { key: "corbatas", confidence: 0.92, reasons: ["kw:corbata"], patterns: [wordRe("corbata"), phraseRe("neck tie"), wordRe("necktie")] },
    { key: "pajaritas_monos", confidence: 0.92, reasons: ["kw:pajarita"], patterns: [wordRe("pajarita"), wordRe("corbatin"), phraseRe("bow tie"), phraseRe("bowtie")] },
    { key: "bufandas", confidence: 0.92, reasons: ["kw:bufanda"], patterns: [wordRe("bufanda"), wordRe("chalina"), wordRe("scarf")] },
    { key: "panuelos_bandanas", confidence: 0.92, reasons: ["kw:bandana"], patterns: [wordRe("panuelo"), wordRe("panuelos"), wordRe("panoleta"), wordRe("bandana"), phraseRe("head scarf"), wordRe("turbante")] },
    { key: "gorras", confidence: 0.9, reasons: ["kw:gorra"], patterns: [wordRe("gorra"), wordRe("cap"), wordRe("snapback"), wordRe("trucker"), wordRe("visera")] },
    { key: "sombreros", confidence: 0.9, reasons: ["kw:sombrero"], patterns: [wordRe("sombrero"), phraseRe("bucket hat"), wordRe("fedora"), wordRe("panama")] },
    { key: "gorros_beanies", confidence: 0.9, reasons: ["kw:gorro"], patterns: [wordRe("beanie"), wordRe("balaclava"), wordRe("pasamontanas"), wordRe("gorro"), wordRe("gorros")] },
  ],
  calzado: [
    { key: "botas", confidence: 0.92, reasons: ["kw:botas"], patterns: [wordRe("botas"), wordRe("bota")] },
    { key: "botines", confidence: 0.92, reasons: ["kw:botines"], patterns: [wordRe("botin"), wordRe("botines")] },
    { key: "tenis_sneakers", confidence: 0.92, reasons: ["kw:tenis"], patterns: [wordRe("tenis"), wordRe("sneaker"), wordRe("sneakers")] },
    { key: "tenis_sneakers", confidence: 0.9, reasons: ["dom:shoes"], patterns: [wordRe("kannibalshoes")] },
    { key: "zapatos_deportivos", confidence: 0.92, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport"), wordRe("training")] },
    { key: "zapatos_formales", confidence: 0.9, reasons: ["kw:formal"], patterns: [wordRe("oxford"), wordRe("derby"), phraseRe("zapato formal"), phraseRe("zapatos formales")] },
    { key: "sandalias", confidence: 0.9, reasons: ["kw:sandalia"], patterns: [wordRe("sandalia"), wordRe("sandalias"), wordRe("sandal"), wordRe("sandals")] },
    { key: "tacones", confidence: 0.9, reasons: ["kw:tacon"], patterns: [wordRe("tacon"), wordRe("tacones"), wordRe("heel"), wordRe("heels")] },
    { key: "mocasines_loafers", confidence: 0.9, reasons: ["kw:loafers"], patterns: [wordRe("mocasin"), wordRe("mocasines"), wordRe("loafers")] },
    { key: "balerinas_flats", confidence: 0.9, reasons: ["kw:balerinas"], patterns: [wordRe("balerina"), wordRe("balerinas"), wordRe("flats")] },
    { key: "alpargatas_espadrilles", confidence: 0.9, reasons: ["kw:alpargatas"], patterns: [wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles")] },
    { key: "zuecos", confidence: 0.9, reasons: ["kw:zuecos"], patterns: [wordRe("zueco"), wordRe("zuecos")] },
    { key: "chanclas_flip_flops", confidence: 0.9, reasons: ["kw:chanclas"], patterns: [wordRe("chancla"), wordRe("chanclas"), phraseRe("flip flop"), phraseRe("flip flops")] },
    // Generic shoes (when the catalog only says "Zapato ...").
    { key: "zapatos_formales", confidence: 0.9, reasons: ["kw:zapato"], patterns: [wordRe("zapato"), wordRe("zapatos"), wordRe("shoe"), wordRe("shoes")] },
  ],
  bolsos_y_marroquineria: [
    { key: "maletas_y_equipaje", confidence: 0.95, reasons: ["kw:maleta"], patterns: [wordRe("maleta"), wordRe("maletas"), wordRe("equipaje"), wordRe("trolley"), wordRe("luggage"), wordRe("suitcase"), wordRe("golf"), phraseRe("bolsa de golf")] },
    { key: "estuches_cartucheras_neceseres", confidence: 0.95, reasons: ["kw:cartuchera"], patterns: [wordRe("cartuchera"), wordRe("cartucheras"), wordRe("estuche"), wordRe("estuches"), wordRe("neceser"), wordRe("neceseres"), wordRe("cosmetiquera"), wordRe("pouch"), wordRe("lapicera")] },
    { key: "llaveros", confidence: 0.94, reasons: ["kw:llavero"], patterns: [wordRe("llavero"), wordRe("llaveros"), wordRe("keychain"), wordRe("keychains")] },
    { key: "portadocumentos_porta_pasaporte", confidence: 0.94, reasons: ["kw:documentos"], patterns: [phraseRe("porta pasaporte"), phraseRe("porta documentos"), phraseRe("portadocumentos"), phraseRe("passport")] },
    { key: "billetera", confidence: 0.92, reasons: ["kw:billetera"], patterns: [wordRe("billetera"), wordRe("monedero"), wordRe("tarjetero"), wordRe("wallet"), phraseRe("money clip"), wordRe("moneyclip")] },
    { key: "bolso_tote", confidence: 0.92, reasons: ["kw:canasto"], patterns: [wordRe("canasto"), wordRe("canastos"), wordRe("basket")] },
    { key: "cartera_bolso_de_mano", confidence: 0.92, reasons: ["kw:bolsa_regalo"], patterns: [phraseRe("bolsa regalo"), phraseRe("gift bag")] },
    { key: "cartera_bolso_de_mano", confidence: 0.9, reasons: ["kw:cartera"], patterns: [wordRe("cartera"), phraseRe("bolso de mano"), wordRe("handbag"), wordRe("handbags"), wordRe("baguette"), phraseRe("market bag")] },
    { key: "mochila", confidence: 0.92, reasons: ["kw:mochila"], patterns: [wordRe("mochila")] },
    { key: "morral", confidence: 0.92, reasons: ["kw:morral"], patterns: [wordRe("morral")] },
    { key: "rinonera_canguro", confidence: 0.92, reasons: ["kw:rinonera"], patterns: [wordRe("rinonera"), wordRe("canguro")] },
    { key: "clutch_sobre", confidence: 0.92, reasons: ["kw:clutch"], patterns: [wordRe("clutch"), wordRe("sobre")] },
    { key: "bolso_tote", confidence: 0.9, reasons: ["kw:tote"], patterns: [wordRe("tote")] },
    { key: "bolso_bandolera_crossbody", confidence: 0.9, reasons: ["kw:crossbody"], patterns: [wordRe("bandolera"), wordRe("crossbody"), phraseRe("manos libres")] },
    { key: "bolso_de_viaje_duffel", confidence: 0.9, reasons: ["kw:duffel"], patterns: [wordRe("duffel"), phraseRe("bolso de viaje")] },
    // Fallback for generic "bag" when no other shape is stated.
    { key: "cartera_bolso_de_mano", confidence: 0.9, reasons: ["kw:bag"], patterns: [wordRe("bag"), wordRe("bags")] },
  ],
  ropa_interior_basica: [
    { key: "brasier", confidence: 0.94, reasons: ["kw:brasier"], patterns: [wordRe("brasier"), wordRe("bra")] },
    { key: "bralette", confidence: 0.94, reasons: ["kw:bralette"], patterns: [wordRe("bralette")] },
    { key: "panty_trusa", confidence: 0.92, reasons: ["kw:panty"], patterns: [wordRe("panty"), wordRe("trusa"), wordRe("cachetero"), wordRe("cachetera"), wordRe("culotte"), wordRe("hipster")] },
    { key: "tanga", confidence: 0.92, reasons: ["kw:tanga"], patterns: [wordRe("tanga")] },
    { key: "brasilera", confidence: 0.92, reasons: ["kw:brasilera"], patterns: [wordRe("brasilera")] },
    { key: "boxer", confidence: 0.9, reasons: ["kw:boxer"], patterns: [wordRe("boxer")] },
    { key: "brief", confidence: 0.9, reasons: ["kw:brief"], patterns: [wordRe("brief"), wordRe("briefs")] },
  ],
  lenceria_y_fajas_shapewear: [
    { key: "faja_cintura", confidence: 0.92, reasons: ["kw:faja_cintura"], patterns: [phraseRe("faja cintura"), wordRe("cinturilla")] },
    { key: "corse", confidence: 0.92, reasons: ["kw:corse"], patterns: [wordRe("corse"), wordRe("corset")] },
    { key: "liguero", confidence: 0.92, reasons: ["kw:liguero"], patterns: [wordRe("liguero")] },
  ],
  pijamas_y_ropa_de_descanso_loungewear: [
    { key: "pijama_bebe", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("baby")] },
    { key: "pijama_infantil", confidence: 0.94, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids"), wordRe("kid"), wordRe("nino"), wordRe("nina")] },
    { key: "pijama_enteriza_onesie", confidence: 0.94, reasons: ["kw:onesie"], patterns: [wordRe("onesie"), wordRe("enteriza"), wordRe("enterizo")] },
    { key: "bata_robe", confidence: 0.93, reasons: ["kw:bata"], patterns: [wordRe("bata"), wordRe("robe")] },
    { key: "camison", confidence: 0.93, reasons: ["kw:camison"], patterns: [wordRe("camison"), wordRe("batola")] },
    { key: "pijama_termica", confidence: 0.93, reasons: ["kw:termica"], patterns: [wordRe("termica"), wordRe("thermal")] },
    { key: "short_pijama", confidence: 0.92, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts")] },
    { key: "pantalon_pijama", confidence: 0.92, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("capri")] },
    { key: "set_loungewear_jogger_buzo", confidence: 0.9, reasons: ["kw:loungewear"], patterns: [wordRe("loungewear"), phraseRe("jogger"), wordRe("buzo")] },
    { key: "pijama_2_piezas", confidence: 0.9, reasons: ["kw:pijama"], patterns: [phraseRe("2 piezas"), phraseRe("dos piezas"), phraseRe("two piece"), phraseRe("two-piece")] },
  ],
  trajes_de_bano_y_playa: [
    { key: "pareo", confidence: 0.92, reasons: ["kw:pareo"], patterns: [wordRe("pareo"), wordRe("sarong")] },
    { key: "tankini", confidence: 0.9, reasons: ["kw:tankini"], patterns: [wordRe("tankini")] },
    { key: "trikini", confidence: 0.9, reasons: ["kw:trikini"], patterns: [wordRe("trikini")] },
    {
      key: "bikini",
      confidence: 0.9,
      reasons: ["kw:bikini"],
      patterns: [
        wordRe("bikini"),
        phraseRe("dos piezas"),
        phraseRe("2 piezas"),
        phraseRe("two piece"),
        phraseRe("two pieces"),
        // Malai-style bikini pieces
        wordRe("bottom"),
        wordRe("bottoms"),
        wordRe("thong"),
        wordRe("thongs"),
        phraseRe("ring bottom"),
      ],
    },
    { key: "vestido_de_bano_entero", confidence: 0.9, reasons: ["kw:one_piece"], patterns: [phraseRe("vestido de bano entero"), phraseRe("traje de bano entero"), phraseRe("one piece"), phraseRe("one-piece"), phraseRe("una pieza"), wordRe("entero"), wordRe("entera")] },
    { key: "bermuda_boxer_de_bano", confidence: 0.9, reasons: ["kw:boxer_bano"], patterns: [phraseRe("boxer de bano"), phraseRe("boxer bano"), phraseRe("bermuda de bano"), phraseRe("bermuda bano"), wordRe("boardshort"), wordRe("boardshorts")] },
    { key: "short_de_bano", confidence: 0.9, reasons: ["kw:short_bano"], patterns: [phraseRe("short de bano"), phraseRe("short bano"), phraseRe("swim short"), phraseRe("swim shorts"), wordRe("pantaloneta"), wordRe("pantalonetas"), phraseRe("short swimwear")] },
    { key: "rashguard_licra_uv", confidence: 0.9, reasons: ["kw:rashguard"], patterns: [wordRe("rashguard"), phraseRe("licra uv"), phraseRe("licra u v"), phraseRe("proteccion uv"), phraseRe("proteccion solar"), phraseRe("uv shirt")] },
    { key: "salida_de_bano_kaftan", confidence: 0.9, reasons: ["kw:coverup"], patterns: [phraseRe("salida de bano"), phraseRe("salida bano"), wordRe("kaftan"), wordRe("caftan"), wordRe("coverup"), phraseRe("beach cover")] },
    { key: "traje_de_bano_infantil", confidence: 0.9, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nino"), wordRe("nina"), wordRe("kids"), wordRe("kid")] },
    { key: "panal_de_agua_bebe", confidence: 0.9, reasons: ["kw:panal"], patterns: [wordRe("panal"), phraseRe("panal de agua"), wordRe("bebe"), wordRe("baby")] },
  ],
  joyeria_y_bisuteria: [
    { key: "relojes", confidence: 0.96, reasons: ["kw:reloj"], patterns: [wordRe("reloj"), wordRe("relojes"), wordRe("watch"), wordRe("watches")] },
    { key: "piercings", confidence: 0.95, reasons: ["kw:piercing"], patterns: [wordRe("piercing"), wordRe("piercings"), wordRe("earcuff"), phraseRe("ear cuff")] },
    { key: "aretes_pendientes", confidence: 0.95, reasons: ["kw:aretes"], patterns: [wordRe("arete"), wordRe("aretes"), wordRe("pendiente"), wordRe("pendientes"), wordRe("candonga"), wordRe("candongas"), wordRe("topo"), wordRe("topos"), wordRe("earring"), wordRe("earrings")] },
    { key: "collares", confidence: 0.94, reasons: ["kw:collar"], patterns: [wordRe("collar"), wordRe("collares"), wordRe("gargantilla"), wordRe("cadena"), wordRe("cadenas"), wordRe("necklace"), wordRe("necklaces"), wordRe("choker"), wordRe("chokers")] },
    { key: "pulseras_brazaletes", confidence: 0.94, reasons: ["kw:pulsera"], patterns: [wordRe("pulsera"), wordRe("pulseras"), wordRe("brazalete"), wordRe("brazaletes"), wordRe("bracelet"), wordRe("bracelets"), wordRe("bangle"), wordRe("bangles")] },
    { key: "anillos", confidence: 0.94, reasons: ["kw:anillo"], patterns: [wordRe("anillo"), wordRe("anillos")] },
    { key: "tobilleras", confidence: 0.93, reasons: ["kw:tobillera"], patterns: [wordRe("tobillera"), wordRe("tobilleras"), wordRe("anklet"), wordRe("anklets")] },
    { key: "dijes_charms", confidence: 0.93, reasons: ["kw:charm"], patterns: [wordRe("dije"), wordRe("dijes"), wordRe("charm"), wordRe("charms"), wordRe("pendant"), wordRe("pendants")] },
    { key: "broches_prendedores", confidence: 0.93, reasons: ["kw:broche"], patterns: [wordRe("broche"), wordRe("broches"), wordRe("prendedor"), wordRe("prendedores"), wordRe("pin"), wordRe("pins"), wordRe("badge"), wordRe("badges")] },
    { key: "sets_de_joyeria", confidence: 0.9, reasons: ["kw:set"], patterns: [phraseRe("set de joyeria"), phraseRe("sets de joyeria"), phraseRe("conjunto de joyeria")] },
  ],
  gafas_y_optica: [
    { key: "gafas_opticas_formuladas", confidence: 0.94, reasons: ["kw:optica"], patterns: [wordRe("optica"), wordRe("formuladas"), wordRe("formulada"), wordRe("prescripcion"), wordRe("prescription")] },
    { key: "monturas", confidence: 0.93, reasons: ["kw:montura"], patterns: [wordRe("montura"), wordRe("monturas"), wordRe("frame"), wordRe("frames")] },
    { key: "lentes_de_proteccion", confidence: 0.92, reasons: ["kw:proteccion"], patterns: [wordRe("proteccion"), wordRe("proteccion"), phraseRe("lente de proteccion"), phraseRe("safety glasses")] },
    // Default to sunglasses when it only says "gafas".
    { key: "gafas_de_sol", confidence: 0.9, reasons: ["kw:gafas"], patterns: [wordRe("gafa"), wordRe("gafas"), wordRe("sunglass"), wordRe("sunglasses")] },
  ],
  buzos_hoodies_y_sueteres: [
    { key: "hoodie_con_cremallera", confidence: 0.94, reasons: ["kw:zip"], patterns: [phraseRe("hoodie con cremallera"), phraseRe("zip hoodie"), phraseRe("hoodie zip"), phraseRe("full zip"), wordRe("fullzip")] },
    { key: "hoodie_canguro", confidence: 0.93, reasons: ["kw:hoodie"], patterns: [wordRe("hoodie"), wordRe("canguro")] },
    { key: "buzo_cuello_alto_half_zip", confidence: 0.93, reasons: ["kw:halfzip"], patterns: [phraseRe("half zip"), phraseRe("hal zip"), wordRe("halfzip"), wordRe("halzip"), wordRe("half-zip")] },
    { key: "cardigan", confidence: 0.93, reasons: ["kw:cardigan"], patterns: [wordRe("cardigan")] },
    { key: "chaleco_tejido", confidence: 0.92, reasons: ["kw:chaleco"], patterns: [wordRe("chaleco")] },
    { key: "sueter_tejido", confidence: 0.92, reasons: ["kw:sweater"], patterns: [wordRe("sueter"), wordRe("sweater"), phraseRe("tejido")] },
    { key: "buzo_polar", confidence: 0.92, reasons: ["kw:polar"], patterns: [wordRe("polar"), wordRe("fleece")] },
    { key: "ruana_poncho", confidence: 0.92, reasons: ["kw:ruana"], patterns: [wordRe("ruana"), wordRe("poncho")] },
    { key: "saco_cuello_v", confidence: 0.9, reasons: ["kw:saco"], patterns: [wordRe("saco")] },
    // Fallback
    { key: "buzo_cuello_redondo", confidence: 0.9, reasons: ["kw:buzo"], patterns: [wordRe("buzo"), wordRe("sweatshirt")] },
  ],
  chaquetas_y_abrigos: [
    { key: "chaqueta_denim", confidence: 0.95, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "chaqueta_tipo_cuero_cuero_o_sintetico", confidence: 0.94, reasons: ["kw:cuero"], patterns: [wordRe("cuero"), phraseRe("faux leather"), phraseRe("eco leather")] },
    { key: "bomber", confidence: 0.94, reasons: ["kw:bomber"], patterns: [wordRe("bomber"), phraseRe("estilo bomber")] },
    { key: "parka", confidence: 0.93, reasons: ["kw:parka"], patterns: [wordRe("parka")] },
    { key: "rompevientos", confidence: 0.93, reasons: ["kw:rompevientos"], patterns: [wordRe("rompevientos"), wordRe("windbreaker")] },
    { key: "impermeable", confidence: 0.93, reasons: ["kw:impermeable"], patterns: [wordRe("impermeable"), wordRe("raincoat")] },
    { key: "puffer_acolchada", confidence: 0.93, reasons: ["kw:puffer"], patterns: [wordRe("puffer"), wordRe("acolchada"), wordRe("acolchado"), wordRe("down")] },
    { key: "trench_gabardina", confidence: 0.93, reasons: ["kw:trench"], patterns: [wordRe("trench"), wordRe("gabardina")] },
    { key: "abrigo_largo", confidence: 0.92, reasons: ["kw:abrigo"], patterns: [wordRe("abrigo"), phraseRe("abrigo largo"), phraseRe("chaqueta larga"), phraseRe("long coat")] },
    { key: "chaleco_acolchado", confidence: 0.92, reasons: ["kw:chaleco"], patterns: [phraseRe("chaleco acolchado"), phraseRe("puffer vest"), phraseRe("vest acolchado"), wordRe("chaleco"), wordRe("chalecos")] },
    // Catch-all: if it's still just "chaqueta".
    { key: "rompevientos", confidence: 0.9, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta")] },
  ],
  blazers_y_sastreria: [
    { key: "smoking_tuxedo_jacket", confidence: 0.95, reasons: ["kw:smoking"], patterns: [wordRe("smoking"), wordRe("tuxedo")] },
    { key: "chaleco_de_vestir", confidence: 0.94, reasons: ["kw:chaleco"], patterns: [phraseRe("chaleco de vestir"), wordRe("waistcoat"), wordRe("vest")] },
    { key: "traje_sastre_conjunto_blazer_pantalon_falda", confidence: 0.93, reasons: ["kw:traje"], patterns: [phraseRe("traje sastre"), phraseRe("matching set"), phraseRe("conjunto sastre")] },
    { key: "pantalon_sastre", confidence: 0.92, reasons: ["kw:pantalon_sastre"], patterns: [phraseRe("pantalon sastre"), phraseRe("pantalon de vestir"), phraseRe("tailored pants")] },
    { key: "falda_sastre", confidence: 0.92, reasons: ["kw:falda_sastre"], patterns: [phraseRe("falda sastre"), phraseRe("falda de vestir")] },
    { key: "blazer_oversize", confidence: 0.92, reasons: ["kw:oversize"], patterns: [wordRe("oversize"), phraseRe("over size")] },
    { key: "blazer_entallado", confidence: 0.92, reasons: ["kw:entallado"], patterns: [wordRe("entallado"), wordRe("fitted")] },
    // Fallback
    { key: "blazer_clasico", confidence: 0.9, reasons: ["kw:blazer"], patterns: [wordRe("blazer"), wordRe("saco")] },
  ],
  enterizos_y_overoles: [
    { key: "pelele_enterizo_bebe", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("pelele"), wordRe("bebe"), wordRe("baby")] },
    { key: "romper_jumpsuit_corto", confidence: 0.93, reasons: ["kw:romper"], patterns: [wordRe("romper"), phraseRe("jumpsuit corto"), phraseRe("enterizo corto")] },
    { key: "jumpsuit_largo", confidence: 0.92, reasons: ["kw:jumpsuit"], patterns: [wordRe("jumpsuit"), wordRe("jumpsit"), phraseRe("enterizo largo")] },
    { key: "overol_denim", confidence: 0.92, reasons: ["kw:denim"], patterns: [wordRe("overol"), wordRe("denim"), wordRe("jean")] },
    { key: "jardinera_overall_tipo_tiras", confidence: 0.92, reasons: ["kw:jardinera"], patterns: [wordRe("jardinera")] },
    { key: "enterizo_deportivo", confidence: 0.92, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("performance")] },
    { key: "enterizo_de_fiesta", confidence: 0.92, reasons: ["kw:fiesta"], patterns: [wordRe("fiesta"), wordRe("noche"), wordRe("formal")] },
    // Fallback
    { key: "jumpsuit_largo", confidence: 0.9, reasons: ["kw:enterizo"], patterns: [wordRe("enterizo")] },
  ],
  conjuntos_y_sets_2_piezas: [
    { key: "conjunto_pijama", confidence: 0.93, reasons: ["kw:pijama"], patterns: [wordRe("pijama")] },
    { key: "conjunto_deportivo_2_piezas", confidence: 0.93, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("performance"), wordRe("gym")] },
    { key: "set_bebe_2_3_piezas", confidence: 0.93, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("baby")] },
    { key: "set_formal_chaleco_pantalon_sastre", confidence: 0.92, reasons: ["kw:formal"], patterns: [wordRe("sastre"), wordRe("formal"), wordRe("chaleco")] },
    // Default bucket for sets without explicit composition.
    { key: "conjunto_matching_set_casual", confidence: 0.9, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("conjunto"), phraseRe("matching set")] },
  ],
  ropa_deportiva_y_performance: [
    { key: "ropa_de_compresion", confidence: 0.94, reasons: ["kw:compresion"], patterns: [wordRe("compresion"), wordRe("compression")] },
    { key: "ropa_de_running", confidence: 0.93, reasons: ["kw:running"], patterns: [wordRe("running"), phraseRe("halfzip performance"), phraseRe("half zip performance")] },
    { key: "ropa_de_ciclismo", confidence: 0.93, reasons: ["kw:ciclismo"], patterns: [wordRe("ciclismo"), wordRe("cycling")] },
    { key: "ropa_de_futbol_entrenamiento", confidence: 0.93, reasons: ["kw:futbol"], patterns: [wordRe("futbol"), wordRe("football")] },
    { key: "top_deportivo_bra_deportivo", confidence: 0.92, reasons: ["kw:top_deportivo"], patterns: [phraseRe("top deportivo"), phraseRe("bra deportivo"), wordRe("bralette")] },
    { key: "leggings_deportivos", confidence: 0.92, reasons: ["kw:leggings"], patterns: [wordRe("legging"), wordRe("leggings")] },
    { key: "shorts_deportivos", confidence: 0.92, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts")] },
    { key: "sudadera_pants_deportivos", confidence: 0.92, reasons: ["kw:pants"], patterns: [wordRe("pantalon"), wordRe("pants"), wordRe("jogger")] },
    { key: "chaqueta_deportiva", confidence: 0.92, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta"), wordRe("jacket"), wordRe("halfzip"), phraseRe("half zip")] },
    { key: "conjunto_deportivo", confidence: 0.9, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("conjunto")] },
    // Fallback
    { key: "camiseta_deportiva", confidence: 0.9, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), phraseRe("t shirt"), wordRe("tshirt")] },
  ],
};

// For some categories, descriptions are very helpful (materials, sleeve length, "estilo bomber", etc).
// For bags/accessories, descriptions tend to include "incluye llavero/correa" and can create false positives,
// so we keep those on textLite-only.
const SUBCATEGORY_ALLOW_TEXT_FULL = new Set<string>([
  "camisetas_y_tops",
  "camisas_y_blusas",
  "buzos_hoodies_y_sueteres",
  "chaquetas_y_abrigos",
  "blazers_y_sastreria",
  "pantalones_no_denim",
  "jeans_y_denim",
  "shorts_y_bermudas",
  "faldas",
  "vestidos",
  "enterizos_y_overoles",
  "conjuntos_y_sets_2_piezas",
  "ropa_deportiva_y_performance",
  "ropa_interior_basica",
  "lenceria_y_fajas_shapewear",
  "pijamas_y_ropa_de_descanso_loungewear",
  "trajes_de_bano_y_playa",
  "calzado",
  "joyeria_y_bisuteria",
  "gafas_y_optica",
]);

const inferSubcategory = (category: string, text: string): Suggestion | null => {
  const rules = SUBRULES[category] || [];
  let best: Suggestion | null = null;
  for (const rule of rules) {
    if (!includesAny(text, rule.patterns)) continue;
    if (!best || rule.confidence > best.confidence) {
      best = {
        category,
        subcategory: rule.key,
        confidence: rule.confidence,
        reasons: rule.reasons,
        kind: "subcategory",
      };
    }
  }
  return best;
};

const fallbackFromLegacy = (category: string, subcategory: string | null, text: string): Suggestion | null => {
  const cat = String(category || "").trim().toLowerCase();
  const sub = String(subcategory || "").trim().toLowerCase();

  if (cat === "tops") {
    if (sub === "camisas" || sub === "blusas") {
      return { category: "camisas_y_blusas", subcategory: null, confidence: 0.7, reasons: ["legacy:tops"], kind: "fallback" };
    }
    return { category: "camisetas_y_tops", subcategory: null, confidence: 0.7, reasons: ["legacy:tops"], kind: "fallback" };
  }

  if (cat === "bottoms") {
    if (sub === "jeans") return { category: "jeans_y_denim", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
    if (sub === "shorts") return { category: "shorts_y_bermudas", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
    if (sub === "faldas") return { category: "faldas", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
    return { category: "pantalones_no_denim", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
  }

  if (cat === "outerwear") {
    if (sub === "blazers") return { category: "blazers_y_sastreria", subcategory: null, confidence: 0.7, reasons: ["legacy:outerwear"], kind: "fallback" };
    if (sub === "buzos") return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.7, reasons: ["legacy:outerwear"], kind: "fallback" };
    if (sub === "chaquetas" || sub === "abrigos") return { category: "chaquetas_y_abrigos", subcategory: null, confidence: 0.7, reasons: ["legacy:outerwear"], kind: "fallback" };
    return { category: "chaquetas_y_abrigos", subcategory: null, confidence: 0.6, reasons: ["legacy:outerwear"], kind: "fallback" };
  }

  if (cat === "knitwear") {
    return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.7, reasons: ["legacy:knitwear"], kind: "fallback" };
  }

  if (cat === "enterizos") {
    return { category: "enterizos_y_overoles", subcategory: null, confidence: 0.7, reasons: ["legacy:enterizos"], kind: "fallback" };
  }

  if (cat === "deportivo") {
    return { category: "ropa_deportiva_y_performance", subcategory: null, confidence: 0.7, reasons: ["legacy:deportivo"], kind: "fallback" };
  }

  if (cat === "trajes_de_bano") {
    return { category: "trajes_de_bano_y_playa", subcategory: null, confidence: 0.7, reasons: ["legacy:trajes_de_bano"], kind: "fallback" };
  }

  if (cat === "ropa interior" || cat === "ropa_interior") {
    // Prefer shapewear/pijama cues if present.
    const inferred = detectApparelCategory(text);
    if (inferred && inferred.category !== "ropa_interior_basica") {
      return { ...inferred, kind: "fallback", confidence: Math.max(0.7, inferred.confidence), reasons: ["legacy:ropa_interior", ...inferred.reasons] };
    }
    return { category: "ropa_interior_basica", subcategory: null, confidence: 0.7, reasons: ["legacy:ropa_interior"], kind: "fallback" };
  }

  if (cat === "belleza") {
    return { category: "hogar_y_lifestyle", subcategory: "cuidado_personal_y_belleza", confidence: 0.99, reasons: ["legacy:belleza"], kind: "fallback" };
  }

  if (cat === "chalecos") {
    return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.6, reasons: ["legacy:chalecos"], kind: "fallback" };
  }

  if (cat === "accesorios") {
    // Last resort: eliminate the legacy bucket while keeping the item visible for manual QA.
    return { category: "hogar_y_lifestyle", subcategory: "hogar_otros", confidence: 0.4, reasons: ["legacy:accesorios_fallback"], kind: "fallback" };
  }

  // Unknown legacy bucket: keep.
  return null;
};

function isAllowedSubcategory(category: string, subcategory: string | null) {
  if (!subcategory) return true;
  const allowed = SUBCATEGORY_BY_CATEGORY[category] ?? [];
  return allowed.includes(subcategory);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const canon = CATEGORY_VALUES;
    const canonPlaceholders = canon.map((_, idx) => `$${idx + 1}`).join(",");
    const whereScope =
      scope === "enriched"
        ? `and (p.metadata -> 'enrichment') is not null`
        : "";

    const whereNull = includeNullCategory
      ? `or p.category is null or btrim(p.category) = ''`
      : "";

    const whereMissingSub = includeMissingSubcategory
      ? `or (
          p.category is not null
          and btrim(p.category) <> ''
          and btrim(p.category) in (${canonPlaceholders})
          and (p.subcategory is null or btrim(p.subcategory) = '')
        )`
      : "";

    const limitClause = limit ? `limit ${Math.max(1, Math.floor(limit))}` : "";

    const query = `
      select
        p.id::text as product_id,
        b.name as brand_name,
        p.name as product_name,
        p.description as description,
        p.category as category,
        p.subcategory as subcategory,
        p."sourceUrl" as source_url,
        p."updatedAt" as updated_at,
        (p.metadata -> 'enrichment') is not null as is_enriched
      from products p
      join brands b on b.id = p."brandId"
      where (
        (p.category is not null and btrim(p.category) <> '' and btrim(p.category) not in (${canonPlaceholders}))
        ${whereNull}
        ${whereMissingSub}
      )
      ${whereScope}
      order by p."updatedAt" desc
      ${limitClause}
    `;

    const res = await client.query<Row>(query, canon);
    const rows = res.rows;

    const changes: Array<Record<string, unknown> & { _rule: Suggestion }> = [];
    for (const row of rows) {
      const rawCategory = row.category ? String(row.category).trim() : "";
      const rawSubcategory = row.subcategory ? String(row.subcategory).trim() : "";

      const fromCategory = rawCategory.length ? rawCategory : null;
      const fromSubcategory = rawSubcategory.length ? rawSubcategory : null;
      const fromIsCanonical = fromCategory ? isCanonicalCategory(fromCategory) : false;

      // Two text views:
      // - `textLite`: name + URL only (safer for category moves; avoids noisy descriptions like care instructions mentioning perfumes, etc).
      // - `textFull`: includes description for richer subcategory inference and null-category backfill.
      const textLite = normalizeText([row.product_name, row.source_url].filter(Boolean).join(" "));
      const textFull = normalizeText([row.product_name, stripHtml(row.description), row.source_url].filter(Boolean).join(" "));

      const primaryLite = inferCanonicalCategory(textLite);
      const primaryFull = inferCanonicalCategory(textFull);
      const fallback = fromCategory ? fallbackFromLegacy(fromCategory, fromSubcategory, textLite) : null;

      const nameOnly = normalizeText(row.product_name);
      const looksLikeSockNamedMedia =
        (nameOnly.startsWith("media ") || nameOnly.startsWith("medias ")) &&
        !includesAny(nameOnly, [phraseRe("media bota"), phraseRe("media cana"), phraseRe("media pierna")]);
      const specialMissingCategory: Suggestion | null = looksLikeSockNamedMedia
        ? {
            category: "accesorios_textiles_y_medias",
            subcategory: null,
            confidence: 0.9,
            reasons: ["kw:media_product_name"],
            kind: "primary",
          }
        : null;

      let toCategory: string | null = fromCategory;
      let toSubcategory: string | null = fromSubcategory;
      let categoryRule: Suggestion | null = null;
      let subcategoryRule: Suggestion | null = null;

      // 1) Category repair:
      // - If category is missing/non-canonical: infer it (high precision).
      // - If category is canonical but subcategory is missing: allow moving category only when the signal is very strong.
      if (!fromCategory || !fromIsCanonical) {
        const candidates = [specialMissingCategory, primaryLite, primaryFull, fallback]
          .filter((item): item is Suggestion => Boolean(item))
          .filter((item) => isCanonicalCategory(item.category))
          .sort((a, b) => b.confidence - a.confidence);
        const chosen = candidates[0] ?? null;
        if (!chosen) continue;
        if (chosen.confidence < minCategoryConfidence) continue;
        toCategory = chosen.category;
        toSubcategory = chosen.subcategory ?? null;
        categoryRule = chosen;
      } else if (primaryLite && isCanonicalCategory(primaryLite.category) && primaryLite.category !== fromCategory) {
        if (primaryLite.confidence >= minMoveCategoryConfidence && isSafeCategoryMoveSuggestion(primaryLite)) {
          toCategory = primaryLite.category;
          toSubcategory = primaryLite.subcategory ?? null;
          categoryRule = { ...primaryLite, reasons: ["move:primary", ...primaryLite.reasons] };
        }
      } else if (primaryFull && primaryFull.category === fromCategory && primaryFull.subcategory) {
        // When the model inferred an in-category subcategory, use it to backfill.
        toCategory = fromCategory;
        if (!toSubcategory) {
          toSubcategory = primaryFull.subcategory;
          subcategoryRule = { ...primaryFull, reasons: ["fill_sub:primary", ...primaryFull.reasons], kind: "primary" };
        }
      }

      if (!toCategory) continue;

      // Preserve subcategory if it's already valid for the new canonical category.
      if (!toSubcategory && fromSubcategory && isAllowedSubcategory(toCategory, fromSubcategory)) {
        toSubcategory = fromSubcategory;
      }

      // If still missing/invalid, infer subcategory inside the canonical category (high precision only).
      if (!isAllowedSubcategory(toCategory, toSubcategory)) {
        toSubcategory = null;
      }
      if (!toSubcategory) {
        // Use name + URL first; descriptions can be noisy for some categories.
        let inferred = inferSubcategory(toCategory, textLite);
        if (!inferred && SUBCATEGORY_ALLOW_TEXT_FULL.has(toCategory)) {
          inferred = inferSubcategory(toCategory, textFull);
          if (inferred) {
            inferred = { ...inferred, reasons: ["src:text_full", ...inferred.reasons] };
          }
        }
        if (inferred && inferred.subcategory && inferred.confidence >= minSubcategoryConfidence) {
          if (isAllowedSubcategory(toCategory, inferred.subcategory)) {
            toSubcategory = inferred.subcategory;
            subcategoryRule = inferred;
          }
        }
      }

      const changed = fromCategory !== toCategory || fromSubcategory !== toSubcategory;
      if (!changed) continue;

      const reasons = Array.from(
        new Set([...(categoryRule?.reasons ?? []), ...(subcategoryRule?.reasons ?? [])].filter(Boolean)),
      );
      const confidence = Math.min(
        categoryRule ? categoryRule.confidence : 1,
        subcategoryRule ? subcategoryRule.confidence : 1,
      );
      const combined: Suggestion = {
        category: toCategory,
        subcategory: toSubcategory,
        confidence,
        reasons,
        kind: categoryRule ? categoryRule.kind : subcategoryRule ? subcategoryRule.kind : "subcategory",
      };

      changes.push({
        product_id: row.product_id,
        brand_name: row.brand_name,
        product_name: row.product_name,
        source_url: row.source_url,
        updated_at: row.updated_at,
        is_enriched: row.is_enriched,
        from_category: fromCategory,
        from_subcategory: fromSubcategory,
        to_category: toCategory,
        to_subcategory: toSubcategory,
        confidence: combined.confidence,
        kind: combined.kind,
        reasons: combined.reasons.join("|"),
        _rule: combined,
      });
    }

    const byFromTo = new Map<string, number>();
    for (const change of changes) {
      const key = `${change.from_category ?? "__NULL__"} -> ${change.to_category}`;
      byFromTo.set(key, (byFromTo.get(key) ?? 0) + 1);
    }

    const md: string[] = [];
    md.push(`# Reparacion de taxonomia (enriched): remap + backfill`);
    md.push("");
    md.push(`- Run: \`${runKey}\``);
    md.push(`- Apply: **${apply ? "YES" : "NO"}**`);
    md.push(`- Scope: \`${scope}\``);
    md.push(`- Include NULL category: **${includeNullCategory ? "YES" : "NO"}**`);
    md.push(`- Include missing subcategory: **${includeMissingSubcategory ? "YES" : "NO"}**`);
    md.push(`- Min category confidence: **${minCategoryConfidence}**`);
    md.push(`- Min move-category confidence: **${minMoveCategoryConfidence}**`);
    md.push(`- Min subcategory confidence: **${minSubcategoryConfidence}**`);
    md.push(`- Productos candidatos: **${rows.length}**`);
    md.push(`- Cambios propuestos: **${changes.length}**`);
    md.push("");

    md.push(`## Top remaps (from -> to)`);
    md.push("");
    md.push(`| from -> to | count |`);
    md.push(`|---|---:|`);
    for (const [key, count] of [...byFromTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      md.push(`| \`${key}\` | ${count} |`);
    }
    md.push("");

    md.push("## Archivos");
    md.push("");
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "report.md"))}`);
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "eligible_changes.csv"))}`);
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "summary.json"))}`);
    fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n") + "\n", "utf8");

    const csvRows = changes.map(({ _rule, ...rest }) => rest);
    writeCsv(
      path.join(outDir, "eligible_changes.csv"),
      csvRows,
      [
        "product_id",
        "brand_name",
        "product_name",
        "source_url",
        "updated_at",
        "is_enriched",
        "from_category",
        "from_subcategory",
        "to_category",
        "to_subcategory",
        "confidence",
        "kind",
        "reasons",
      ],
    );

    fs.writeFileSync(
      path.join(outDir, "summary.json"),
      JSON.stringify(
        {
          run: runKey,
          apply,
          scope,
          includeNullCategory,
          includeMissingSubcategory,
          minCategoryConfidence,
          minMoveCategoryConfidence,
          minSubcategoryConfidence,
          scanned: rows.length,
          proposed_changes: changes.length,
          top_remaps: [...byFromTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    if (!apply || changes.length === 0) {
      console.log(`[taxonomy_remap] dry-run report written: ${outDir}`);
      return;
    }

    const applied: typeof changes = [];
    const failed: Array<Record<string, unknown>> = [];

    const patchVersion = `taxonomy_remap_noncanonical_v1_${runKey}`;

    for (let i = 0; i < changes.length; i += chunkSize) {
      const chunk = changes.slice(i, i + chunkSize);
      for (const change of chunk) {
        try {
          const patch = {
            rule_version: patchVersion,
            applied_at: new Date().toISOString(),
            from: { category: change.from_category ?? null, subcategory: change.from_subcategory ?? null },
            to: { category: change.to_category ?? null, subcategory: change.to_subcategory ?? null },
            confidence: change.confidence,
            kind: change.kind,
            reasons: String(change.reasons || "").split("|").filter(Boolean),
          };

          await client.query(
            `
              update products
              set
                category = $1,
                subcategory = $2,
                metadata = jsonb_set(
                  case when jsonb_typeof(metadata) = 'object' then metadata else '{}'::jsonb end,
                  '{taxonomy_remap}',
                  $3::jsonb,
                  true
                ),
                "updatedAt" = now()
              where id = $4
            `,
            [
              change.to_category,
              change.to_subcategory,
              JSON.stringify(patch),
              change.product_id,
            ],
          );

          applied.push(change);
        } catch (err) {
          failed.push({
            ...change,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    fs.writeFileSync(
      path.join(outDir, "apply_summary.json"),
      JSON.stringify({ ok: failed.length === 0, applied: applied.length, failed: failed.length, failed_samples: failed.slice(0, 20) }, null, 2) + "\n",
      "utf8",
    );

    console.log(`[taxonomy_remap] applied=${applied.length} failed=${failed.length} report=${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
