import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  SUBCATEGORY_BY_CATEGORY,
  SUBCATEGORY_LABELS,
} from "../src/lib/product-enrichment/constants";

const { Client } = pg;

type Row = {
  product_id: string;
  brand_name: string;
  product_name: string;
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
  // Optional: when we suggest a not-yet-existing taxonomy bucket, encode it as __NEW__...
  newBucket?: { kind: "category" | "subcategory"; key: string; label: string };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const DEFAULT_SAMPLE_PER_SUB = 200;
const DEFAULT_MIN_CONF_MOVE_CATEGORY = 0.95;
const DEFAULT_MIN_CONF_MOVE_SUBCATEGORY = 0.9;
const DEFAULT_MIN_CONF_FILL_SUBCATEGORY = 0.86;

const args = new Set(process.argv.slice(2));
const getArgValue = (flag: string) => {
  const prefix = `${flag}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return null;
};

const seed = getArgValue("--seed") || process.env.AUDIT_SEED || new Date().toISOString().slice(0, 10);
const samplePerSub = Number(getArgValue("--sample-per-sub") || process.env.AUDIT_SAMPLE_PER_SUBCATEGORY || DEFAULT_SAMPLE_PER_SUB) || DEFAULT_SAMPLE_PER_SUB;
const enrichedOnly = args.has("--enriched-only") || String(process.env.AUDIT_ENRICHED_ONLY || "").toLowerCase() === "true";
const minMoveCategory = Number(getArgValue("--min-move-category") || process.env.AUDIT_MIN_MOVE_CATEGORY || DEFAULT_MIN_CONF_MOVE_CATEGORY);
const minMoveSubcategory = Number(getArgValue("--min-move-subcategory") || process.env.AUDIT_MIN_MOVE_SUBCATEGORY || DEFAULT_MIN_CONF_MOVE_SUBCATEGORY);
const minFillSubcategory = Number(getArgValue("--min-fill-subcategory") || process.env.AUDIT_MIN_FILL_SUBCATEGORY || DEFAULT_MIN_CONF_FILL_SUBCATEGORY);
const onlyCategory = (getArgValue("--only-category") || process.env.AUDIT_ONLY_CATEGORY || "").trim() || null;
const onlySubcategory = (getArgValue("--only-subcategory") || process.env.AUDIT_ONLY_SUBCATEGORY || "").trim() || null;

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in .env");
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
const outDir = ensureDir(path.join(outRoot, `audit_taxonomy_${runKey}`));

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stableSampleKey = (id: string) => crypto.createHash("md5").update(`${id}:${seed}`).digest("hex");

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

const wordRe = (word: string) => new RegExp(`(^|\\s)${word}(\\s|$)`, "i");
const phraseRe = (phrase: string) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&").replace(/\\s+/g, "\\\\s+")}\\b`, "i");
const includesAny = (text: string, patterns: RegExp[]) => patterns.some((re) => re.test(text));

const canonicalCategorySet = new Set(CATEGORY_VALUES);
const isCanonicalCategory = (value: string) => canonicalCategorySet.has(value);
const subKeyOf = (value: unknown) => {
  const trimmed = value === null || value === undefined ? "" : String(value).trim();
  return trimmed.length ? trimmed : "__NULL__";
};

// --- Global "out of fashion taxonomy" signals (new buckets) ---

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

const HOME_AROMA_PATTERNS = [
  // Avoid moving home/lifestyle scents into personal care.
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

const PET_CONTEXT = [
  wordRe("perro"),
  wordRe("perros"),
  wordRe("gato"),
  wordRe("gatos"),
  wordRe("mascota"),
  wordRe("mascotas"),
  wordRe("dog"),
  wordRe("dogs"),
  wordRe("cat"),
  wordRe("cats"),
  wordRe("pet"),
  wordRe("pets"),
];

const PET_PRODUCT = [
  wordRe("arnes"),
  wordRe("correa"),
  wordRe("collar"),
  phraseRe("dog collar"),
  phraseRe("cat collar"),
  phraseRe("dog leash"),
  phraseRe("impermeable perro"),
  phraseRe("raincoat"),
  phraseRe("cama"),
  phraseRe("pet bed"),
  phraseRe("comida"),
  phraseRe("snack"),
];

const detectBeauty = (text: string): Suggestion | null => {
  if (includesAny(text, HOME_AROMA_PATTERNS)) return null;

  const hasStrong = includesAny(text, BEAUTY_STRONG_PATTERNS);
  const hasFragancia = includesAny(text, BEAUTY_FRAGANCIA_PATTERNS);
  const hasSplash =
    wordRe("splash").test(text) &&
    (mlAmountRe.test(text) || wordRe("corporal").test(text) || wordRe("body").test(text));

  if (!hasStrong && !hasFragancia && !hasSplash) return null;
  return {
    category: "hogar_y_lifestyle",
    subcategory: "cuidado_personal_y_belleza",
    confidence: hasStrong || hasSplash ? 0.99 : 0.96,
    reasons: [hasStrong || hasSplash ? "kw:beauty_strong" : "kw:beauty_fragancia"],
  };
};

const detectPetProduct = (text: string): Suggestion | null => {
  if (!includesAny(text, PET_CONTEXT)) return null;
  if (!includesAny(text, PET_PRODUCT)) return null;
  return {
    category: "hogar_y_lifestyle",
    subcategory: "__NEW__mascotas",
    confidence: 0.97,
    reasons: ["kw:pet_product"],
    newBucket: { kind: "subcategory", key: "mascotas", label: "Mascotas" },
  };
};

// --- Category detectors (canonical) ---

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
  };
};

const hasSockContext = (text: string) =>
  includesAny(text, [
    wordRe("media"),
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("sock"),
    wordRe("socks"),
    wordRe("soquete"),
    wordRe("soquetes"),
  ]);

const detectJewelry = (text: string): Suggestion | null => {
  const patterns = [
    wordRe("arete"),
    wordRe("aretes"),
    wordRe("pendiente"),
    wordRe("pendientes"),
    wordRe("candonga"),
    wordRe("candongas"),
    wordRe("topo"),
    wordRe("topos"),
    wordRe("anillo"),
    wordRe("anillos"),
    wordRe("collar"),
    wordRe("collares"),
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
    wordRe("charm"),
    wordRe("charms"),
    wordRe("broche"),
    wordRe("broches"),
    wordRe("reloj"),
    wordRe("relojes"),
  ];

  if (!includesAny(text, patterns)) return null;

  // "tobillera" is ambiguous: can mean jewelry anklet or ankle socks.
  const hasTobillera = wordRe("tobillera").test(text) || wordRe("tobilleras").test(text);
  if (hasTobillera && hasSockContext(text)) return null;

  // Subcategory inference for jewelry is optional; keep it coarse in this audit.
  return { category: "joyeria_y_bisuteria", subcategory: null, confidence: 0.98, reasons: ["kw:jewelry"] };
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
  return { category: "gafas_y_optica", subcategory: null, confidence: 0.98, reasons: ["kw:glasses"] };
};

const detectFootwear = (text: string): Suggestion | null => {
  // "bota" is ambiguous in Spanish catalogs: "pantalon bota recta/ancha/flare..." is NOT footwear.
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
  ];
  const bootPatterns = [wordRe("bota"), wordRe("botas"), wordRe("boot"), wordRe("boots")];
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

  if (includesAny(text, strongPatterns)) {
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"] };
  }

  if (includesAny(text, bootPatterns)) {
    const looksLikePantsFit = includesAny(text, botaFitPantsPatterns) || includesAny(text, bottomsContext);
    if (looksLikePantsFit) return null;
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"] };
  }

  return null;
};

const detectBags = (text: string): Suggestion | null => {
  const patterns = [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("cartera"),
    wordRe("carteras"),
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("tarjetero"),
    wordRe("tarjeteros"),
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
  return { category: "bolsos_y_marroquineria", subcategory: null, confidence: 0.98, reasons: ["kw:bags"] };
};

const detectTextileAccessory = (text: string): Suggestion | null => {
  // Only after excluding other accessory categories.
  const patterns = [
    wordRe("media"),
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("pantimedia"),
    wordRe("pantimedias"),
    wordRe("cinturon"),
    wordRe("cinturones"),
    wordRe("correa"),
    wordRe("gorro"),
    wordRe("gorros"),
    wordRe("beanie"),
    wordRe("gorras"),
    wordRe("gorra"),
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
    wordRe("diadema"),
    wordRe("balaca"),
    wordRe("tiara"),
    wordRe("pinza"),
    wordRe("gancho"),
    wordRe("scrunchie"),
  ];
  if (!includesAny(text, patterns)) return null;
  return { category: "accesorios_textiles_y_medias", subcategory: null, confidence: 0.9, reasons: ["kw:textile_accessory"] };
};

const detectApparelCategory = (text: string): Suggestion | null => {
  // High-precision only; when ambiguous, return null.
  const rules: Array<{ category: string; confidence: number; reasons: string[]; patterns: RegExp[] }> = [
    { category: "uniformes_y_ropa_de_trabajo_escolar", confidence: 0.95, reasons: ["kw:uniform"], patterns: [wordRe("uniforme"), wordRe("scrubs"), wordRe("dotacion"), wordRe("industrial"), phraseRe("alta visibilidad")] },
    { category: "ropa_de_bebe_0_24_meses", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("recien"), wordRe("mameluco"), wordRe("pelele"), phraseRe("0 24"), phraseRe("0-24")] },
    { category: "trajes_de_bano_y_playa", confidence: 0.95, reasons: ["kw:swim"], patterns: [wordRe("bikini"), wordRe("trikini"), phraseRe("traje de bano"), phraseRe("vestido de bano"), wordRe("tankini"), wordRe("rashguard"), phraseRe("licra uv"), phraseRe("salida de bano"), wordRe("pareo")] },
    { category: "pijamas_y_ropa_de_descanso_loungewear", confidence: 0.93, reasons: ["kw:pijama"], patterns: [wordRe("pijama"), wordRe("camison"), wordRe("batola"), wordRe("bata"), wordRe("robe"), wordRe("loungewear")] },
    { category: "lenceria_y_fajas_shapewear", confidence: 0.93, reasons: ["kw:shapewear"], patterns: [wordRe("faja"), wordRe("shapewear"), wordRe("corse"), wordRe("corset"), wordRe("liguero"), wordRe("babydoll")] },
    { category: "ropa_interior_basica", confidence: 0.92, reasons: ["kw:underwear"], patterns: [wordRe("brasier"), wordRe("bralette"), wordRe("panty"), wordRe("trusa"), wordRe("boxer"), wordRe("bóxer"), wordRe("brief"), wordRe("interior")] },
    { category: "ropa_deportiva_y_performance", confidence: 0.9, reasons: ["kw:sport"], patterns: [wordRe("deportivo"), wordRe("running"), wordRe("ciclismo"), wordRe("gym"), wordRe("entrenamiento"), wordRe("compresion"), wordRe("compression")] },
    { category: "vestidos", confidence: 0.9, reasons: ["kw:vestido"], patterns: [wordRe("vestido"), wordRe("dress")] },
    { category: "enterizos_y_overoles", confidence: 0.9, reasons: ["kw:enterizo"], patterns: [wordRe("enterizo"), wordRe("jumpsuit"), wordRe("romper"), wordRe("overol"), wordRe("jardinera")] },
    { category: "conjuntos_y_sets_2_piezas", confidence: 0.88, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("sets"), wordRe("conjunto"), wordRe("conjuntos"), phraseRe("2 piezas"), phraseRe("2pzs"), phraseRe("matching set")] },
    { category: "faldas", confidence: 0.9, reasons: ["kw:falda"], patterns: [wordRe("falda"), wordRe("skirt"), wordRe("skort")] },
    { category: "shorts_y_bermudas", confidence: 0.9, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts"), wordRe("bermuda"), wordRe("bermudas")] },
    { category: "jeans_y_denim", confidence: 0.9, reasons: ["kw:jean"], patterns: [wordRe("jean"), wordRe("jeans"), wordRe("denim")] },
    { category: "pantalones_no_denim", confidence: 0.88, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("pantalones"), wordRe("jogger"), wordRe("cargo"), wordRe("palazzo"), wordRe("culotte")] },
    { category: "blazers_y_sastreria", confidence: 0.9, reasons: ["kw:blazer"], patterns: [wordRe("blazer"), wordRe("sastr"), wordRe("smoking"), wordRe("tuxedo")] },
    { category: "chaquetas_y_abrigos", confidence: 0.9, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta"), wordRe("abrigo"), wordRe("trench"), wordRe("parka"), wordRe("bomber"), wordRe("impermeable"), wordRe("rompevientos")] },
    { category: "buzos_hoodies_y_sueteres", confidence: 0.88, reasons: ["kw:buzo"], patterns: [wordRe("hoodie"), wordRe("buzo"), wordRe("sueter"), wordRe("sweater"), wordRe("cardigan"), wordRe("ruana")] },
    { category: "camisas_y_blusas", confidence: 0.88, reasons: ["kw:camisa"], patterns: [wordRe("camisa"), wordRe("blusa"), wordRe("guayabera")] },
    { category: "camisetas_y_tops", confidence: 0.88, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), phraseRe("t shirt"), wordRe("tshirt"), wordRe("tee"), wordRe("top"), wordRe("polo")] },
  ];

  for (const rule of rules) {
    if (includesAny(text, rule.patterns)) {
      return { category: rule.category, subcategory: null, confidence: rule.confidence, reasons: rule.reasons };
    }
  }
  return null;
};

const inferCanonicalCategory = (text: string): Suggestion | null => {
  // Order matters: strong non-fashion buckets first, then fashion categories.
  return (
    detectGiftCard(text) ||
    detectBeauty(text) ||
    detectPetProduct(text) ||
    detectJewelry(text) ||
    detectGlasses(text) ||
    detectBags(text) ||
    detectFootwear(text) ||
    detectTextileAccessory(text) ||
    detectApparelCategory(text)
  );
};

// --- Subcategory inference rules (within canonical categories) ---

type SubRule = { key: string; confidence: number; patterns: RegExp[]; reasons: string[] };

const SUBRULES: Record<string, SubRule[]> = {
  camisetas_y_tops: [
    { key: "body_bodysuit", confidence: 0.96, reasons: ["kw:body"], patterns: [wordRe("body"), wordRe("bodysuit"), wordRe("bodi"), wordRe("bodie")] },
    { key: "polo", confidence: 0.95, reasons: ["kw:polo"], patterns: [wordRe("polo"), wordRe("pique"), phraseRe("camiseta polo")] },
    { key: "henley_camiseta_con_botones", confidence: 0.94, reasons: ["kw:henley"], patterns: [wordRe("henley")] },
    { key: "top_basico_strap_top_tiras", confidence: 0.93, reasons: ["kw:strap_top"], patterns: [wordRe("strap"), wordRe("spaghetti"), phraseRe("top tiras"), phraseRe("top de tiras"), phraseRe("strap top")] },
    // "tank" is dangerous (tankini). Require "tank top" phrase.
    { key: "tank_top", confidence: 0.93, reasons: ["kw:tank_top"], patterns: [phraseRe("tank top"), wordRe("tanktop")] },
    { key: "camisilla_esqueleto_sin_mangas", confidence: 0.92, reasons: ["kw:sin_mangas"], patterns: [wordRe("camisilla"), wordRe("esqueleto"), phraseRe("sin mangas"), wordRe("sisa"), wordRe("sleeveless")] },
    { key: "crop_top", confidence: 0.9, reasons: ["kw:crop"], patterns: [wordRe("crop"), phraseRe("crop top")] },
    { key: "camiseta_cuello_alto_tortuga", confidence: 0.9, reasons: ["kw:cuello_alto"], patterns: [wordRe("tortuga"), wordRe("turtleneck"), phraseRe("cuello alto")] },
    { key: "camiseta_manga_larga", confidence: 0.88, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve"), wordRe("m l")] },
    { key: "camiseta_manga_corta", confidence: 0.6, reasons: ["fallback:camiseta"], patterns: [wordRe("camiseta"), phraseRe("t shirt"), wordRe("tshirt"), wordRe("tee"), wordRe("top")] },
  ],
  camisas_y_blusas: [
    { key: "guayabera", confidence: 0.96, reasons: ["kw:guayabera"], patterns: [wordRe("guayabera")] },
    { key: "camisa_denim", confidence: 0.94, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean"), phraseRe("camisa jean")] },
    { key: "camisa_de_lino", confidence: 0.94, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "camisa_estampada", confidence: 0.9, reasons: ["kw:estampada"], patterns: [wordRe("estampada"), wordRe("print"), wordRe("printed")] },
    { key: "camisa_formal", confidence: 0.88, reasons: ["kw:formal"], patterns: [wordRe("formal"), wordRe("office"), wordRe("vestir")] },
    { key: "blusa_off_shoulder_hombros_descubiertos", confidence: 0.92, reasons: ["kw:off_shoulder"], patterns: [phraseRe("off shoulder"), phraseRe("hombros descubiertos")] },
    { key: "blusa_tipo_tunica", confidence: 0.92, reasons: ["kw:tunica"], patterns: [wordRe("tunica"), wordRe("tunika")] },
    { key: "blusa_cuello_alto", confidence: 0.9, reasons: ["kw:cuello_alto"], patterns: [phraseRe("cuello alto"), wordRe("turtleneck")] },
    { key: "blusa_manga_larga", confidence: 0.85, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve")] },
    { key: "blusa_manga_corta", confidence: 0.85, reasons: ["kw:manga_corta"], patterns: [phraseRe("manga corta"), phraseRe("short sleeve")] },
    { key: "camisa_casual", confidence: 0.6, reasons: ["fallback:camisa"], patterns: [wordRe("camisa"), wordRe("shirt"), wordRe("blusa"), wordRe("blouse")] },
  ],
  buzos_hoodies_y_sueteres: [
    // IMPORTANT: do not match on "hoodie" alone. Require zipper cues.
    { key: "hoodie_con_cremallera", confidence: 0.94, reasons: ["kw:hoodie_zip"], patterns: [wordRe("cremallera"), wordRe("zip"), phraseRe("hoodie zip"), phraseRe("zip hoodie"), phraseRe("hoodie con cremallera")] },
    { key: "hoodie_canguro", confidence: 0.92, reasons: ["kw:hoodie"], patterns: [wordRe("hoodie"), wordRe("canguro")] },
    { key: "buzo_polar", confidence: 0.94, reasons: ["kw:polar"], patterns: [wordRe("polar"), phraseRe("fleece")] },
    { key: "buzo_cuello_alto_half_zip", confidence: 0.93, reasons: ["kw:half_zip"], patterns: [phraseRe("half zip"), phraseRe("1 2 zip"), phraseRe("1/2 zip"), wordRe("halfzip")] },
    { key: "cardigan", confidence: 0.94, reasons: ["kw:cardigan"], patterns: [wordRe("cardigan")] },
    { key: "chaleco_tejido", confidence: 0.92, reasons: ["kw:chaleco_tejido"], patterns: [phraseRe("chaleco tejido"), wordRe("chaleco")] },
    { key: "ruana_poncho", confidence: 0.94, reasons: ["kw:ruana"], patterns: [wordRe("ruana"), wordRe("poncho")] },
    { key: "saco_cuello_v", confidence: 0.9, reasons: ["kw:cuello_v"], patterns: [phraseRe("cuello v"), phraseRe("v neck"), phraseRe("vneck")] },
    { key: "sueter_tejido", confidence: 0.9, reasons: ["kw:sweater"], patterns: [wordRe("sueter"), wordRe("sweater"), wordRe("knit"), wordRe("tejido")] },
    { key: "buzo_cuello_redondo", confidence: 0.6, reasons: ["fallback:buzo"], patterns: [wordRe("buzo"), wordRe("sweatshirt")] },
  ],
  chaquetas_y_abrigos: [
    { key: "trench_gabardina", confidence: 0.95, reasons: ["kw:trench"], patterns: [wordRe("trench"), wordRe("gabardina")] },
    { key: "impermeable", confidence: 0.95, reasons: ["kw:impermeable"], patterns: [wordRe("impermeable"), phraseRe("rain jacket")] },
    { key: "rompevientos", confidence: 0.94, reasons: ["kw:rompevientos"], patterns: [wordRe("rompevientos"), wordRe("windbreaker")] },
    { key: "parka", confidence: 0.94, reasons: ["kw:parka"], patterns: [wordRe("parka")] },
    { key: "bomber", confidence: 0.94, reasons: ["kw:bomber"], patterns: [wordRe("bomber")] },
    { key: "puffer_acolchada", confidence: 0.94, reasons: ["kw:puffer"], patterns: [wordRe("puffer"), wordRe("acolchada")] },
    { key: "chaqueta_tipo_cuero_cuero_o_sintetico", confidence: 0.92, reasons: ["kw:cuero"], patterns: [wordRe("cuero"), wordRe("leather")] },
    { key: "chaqueta_denim", confidence: 0.92, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "chaleco_acolchado", confidence: 0.9, reasons: ["kw:chaleco"], patterns: [phraseRe("chaleco"), wordRe("chaleco")] },
    { key: "abrigo_largo", confidence: 0.9, reasons: ["kw:abrigo"], patterns: [wordRe("abrigo")] },
  ],
  blazers_y_sastreria: [
    { key: "traje_sastre_conjunto_blazer_pantalon_falda", confidence: 0.95, reasons: ["kw:traje_sastre"], patterns: [phraseRe("traje sastre"), phraseRe("set sastre"), phraseRe("conjunto sastre")] },
    { key: "smoking_tuxedo_jacket", confidence: 0.95, reasons: ["kw:smoking"], patterns: [wordRe("smoking"), wordRe("tuxedo")] },
    { key: "chaleco_de_vestir", confidence: 0.93, reasons: ["kw:chaleco_vestir"], patterns: [phraseRe("chaleco de vestir"), phraseRe("chaleco sastre"), phraseRe("waistcoat")] },
    { key: "pantalon_sastre", confidence: 0.92, reasons: ["kw:pantalon_sastre"], patterns: [phraseRe("pantalon sastre"), phraseRe("pantalon de vestir")] },
    { key: "falda_sastre", confidence: 0.92, reasons: ["kw:falda_sastre"], patterns: [phraseRe("falda sastre"), phraseRe("falda de vestir")] },
    { key: "blazer_oversize", confidence: 0.9, reasons: ["kw:oversize"], patterns: [wordRe("oversize"), phraseRe("over size")] },
    { key: "blazer_entallado", confidence: 0.88, reasons: ["kw:entallado"], patterns: [wordRe("entallado")] },
    { key: "blazer_clasico", confidence: 0.75, reasons: ["fallback:blazer"], patterns: [wordRe("blazer"), wordRe("saco")] },
  ],
  pantalones_no_denim: [
    { key: "pantalon_chino", confidence: 0.92, reasons: ["kw:chino"], patterns: [wordRe("chino"), wordRe("chinos")] },
    { key: "pantalon_cargo", confidence: 0.92, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
    { key: "jogger_casual", confidence: 0.92, reasons: ["kw:jogger"], patterns: [wordRe("jogger")] },
    { key: "palazzo", confidence: 0.92, reasons: ["kw:palazzo"], patterns: [wordRe("palazzo")] },
    { key: "culotte", confidence: 0.92, reasons: ["kw:culotte"], patterns: [wordRe("culotte")] },
    { key: "leggings_casual", confidence: 0.9, reasons: ["kw:leggings"], patterns: [wordRe("legging"), wordRe("leggings")] },
    { key: "pantalon_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "pantalon_de_dril", confidence: 0.88, reasons: ["kw:dril"], patterns: [wordRe("dril"), wordRe("sarga"), wordRe("twill")] },
    { key: "pantalon_skinny_no_denim", confidence: 0.86, reasons: ["kw:skinny"], patterns: [wordRe("skinny")] },
    { key: "pantalon_flare_no_denim", confidence: 0.86, reasons: ["kw:flare"], patterns: [wordRe("flare")] },
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
    { key: "jean_infantil", confidence: 0.86, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nino"), wordRe("nina"), wordRe("kids")] },
  ],
  shorts_y_bermudas: [
    { key: "bermuda", confidence: 0.92, reasons: ["kw:bermuda"], patterns: [wordRe("bermuda")] },
    { key: "biker_short", confidence: 0.92, reasons: ["kw:biker"], patterns: [wordRe("biker")] },
    { key: "short_deportivo", confidence: 0.9, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport")] },
    { key: "short_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "short_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "short_cargo", confidence: 0.9, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
    { key: "short_de_vestir", confidence: 0.86, reasons: ["kw:vestir"], patterns: [wordRe("vestir"), wordRe("formal")] },
    { key: "short_infantil", confidence: 0.86, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nino"), wordRe("nina"), wordRe("kids")] },
  ],
  faldas: [
    { key: "falda_short_skort", confidence: 0.92, reasons: ["kw:skort"], patterns: [wordRe("skort"), phraseRe("falda short"), phraseRe("falda-short")] },
    { key: "falda_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "falda_plisada", confidence: 0.92, reasons: ["kw:plisada"], patterns: [wordRe("plisada"), wordRe("pleated")] },
    { key: "falda_lapiz", confidence: 0.9, reasons: ["kw:lapiz"], patterns: [wordRe("lapiz"), phraseRe("pencil")] },
    { key: "falda_cruzada_wrap", confidence: 0.9, reasons: ["kw:wrap"], patterns: [wordRe("wrap"), wordRe("cruzada")] },
    { key: "falda_skater", confidence: 0.9, reasons: ["kw:skater"], patterns: [wordRe("skater")] },
    { key: "mini_falda", confidence: 0.88, reasons: ["kw:mini"], patterns: [wordRe("mini")] },
    { key: "falda_midi", confidence: 0.88, reasons: ["kw:midi"], patterns: [wordRe("midi")] },
    { key: "falda_maxi", confidence: 0.88, reasons: ["kw:maxi"], patterns: [wordRe("maxi")] },
  ],
  vestidos: [
    { key: "vestido_infantil", confidence: 0.92, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nina"), wordRe("nino"), wordRe("kids")] },
    { key: "vestido_sueter", confidence: 0.92, reasons: ["kw:sweater_dress"], patterns: [phraseRe("vestido sueter"), phraseRe("sweater dress"), wordRe("sueter")] },
    { key: "vestido_camisero", confidence: 0.92, reasons: ["kw:camisero"], patterns: [wordRe("camisero"), phraseRe("shirt dress")] },
    { key: "vestido_de_verano", confidence: 0.9, reasons: ["kw:verano"], patterns: [wordRe("verano"), wordRe("summer")] },
    { key: "vestido_de_fiesta", confidence: 0.9, reasons: ["kw:fiesta"], patterns: [wordRe("fiesta"), wordRe("party")] },
    { key: "vestido_coctel", confidence: 0.9, reasons: ["kw:coctel"], patterns: [wordRe("coctel"), wordRe("cocktail")] },
    { key: "vestido_formal_noche", confidence: 0.9, reasons: ["kw:noche"], patterns: [wordRe("noche"), wordRe("formal"), wordRe("gala")] },
    { key: "vestido_mini", confidence: 0.88, reasons: ["kw:mini"], patterns: [wordRe("mini")] },
    { key: "vestido_midi", confidence: 0.88, reasons: ["kw:midi"], patterns: [wordRe("midi")] },
    { key: "vestido_maxi", confidence: 0.88, reasons: ["kw:maxi"], patterns: [wordRe("maxi")] },
    { key: "vestido_casual", confidence: 0.6, reasons: ["fallback:vestido"], patterns: [wordRe("vestido"), wordRe("dress")] },
  ],
  enterizos_y_overoles: [
    { key: "pelele_enterizo_bebe", confidence: 0.95, reasons: ["kw:pelele"], patterns: [wordRe("pelele"), wordRe("mameluco")] },
    { key: "overol_denim", confidence: 0.92, reasons: ["kw:overol_denim"], patterns: [wordRe("overol"), wordRe("jardinera"), wordRe("denim"), wordRe("jean")] },
    { key: "romper_jumpsuit_corto", confidence: 0.92, reasons: ["kw:romper"], patterns: [wordRe("romper")] },
    { key: "jumpsuit_largo", confidence: 0.9, reasons: ["kw:jumpsuit"], patterns: [wordRe("jumpsuit"), wordRe("enterizo")] },
    { key: "enterizo_de_fiesta", confidence: 0.88, reasons: ["kw:fiesta"], patterns: [wordRe("fiesta"), wordRe("party")] },
    { key: "enterizo_deportivo", confidence: 0.88, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport")] },
  ],
  conjuntos_y_sets_2_piezas: [
    { key: "conjunto_pijama", confidence: 0.92, reasons: ["kw:pijama_set"], patterns: [wordRe("pijama"), phraseRe("set pijama")] },
    { key: "conjunto_deportivo_2_piezas", confidence: 0.9, reasons: ["kw:deportivo_set"], patterns: [wordRe("deportivo"), wordRe("sport")] },
    { key: "set_bebe_2_3_piezas", confidence: 0.9, reasons: ["kw:bebe_set"], patterns: [wordRe("bebe"), wordRe("recien")] },
    { key: "conjunto_falda_top", confidence: 0.88, reasons: ["kw:falda_top"], patterns: [wordRe("falda"), wordRe("top")] },
    { key: "conjunto_short_top", confidence: 0.88, reasons: ["kw:short_top"], patterns: [wordRe("short"), wordRe("top")] },
    { key: "conjunto_matching_set_casual", confidence: 0.7, reasons: ["fallback:set"], patterns: [wordRe("set"), wordRe("conjunto"), phraseRe("2 piezas")] },
  ],
  ropa_deportiva_y_performance: [
    { key: "ropa_de_running", confidence: 0.92, reasons: ["kw:running"], patterns: [wordRe("running")] },
    { key: "ropa_de_ciclismo", confidence: 0.92, reasons: ["kw:ciclismo"], patterns: [wordRe("ciclismo"), wordRe("cycling")] },
    { key: "ropa_de_futbol_entrenamiento", confidence: 0.92, reasons: ["kw:futbol"], patterns: [wordRe("futbol"), wordRe("soccer"), wordRe("entrenamiento")] },
    { key: "ropa_de_compresion", confidence: 0.92, reasons: ["kw:compresion"], patterns: [wordRe("compresion"), wordRe("compression")] },
    { key: "top_deportivo_bra_deportivo", confidence: 0.9, reasons: ["kw:bra"], patterns: [wordRe("bra"), wordRe("top"), phraseRe("top deportivo")] },
    { key: "leggings_deportivos", confidence: 0.9, reasons: ["kw:leggings"], patterns: [wordRe("legging"), wordRe("leggings")] },
    { key: "shorts_deportivos", confidence: 0.9, reasons: ["kw:shorts"], patterns: [wordRe("short"), wordRe("shorts")] },
    { key: "camiseta_deportiva", confidence: 0.88, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), wordRe("tshirt")] },
    { key: "conjunto_deportivo", confidence: 0.88, reasons: ["kw:conjunto"], patterns: [wordRe("set"), wordRe("conjunto")] },
    { key: "chaqueta_deportiva", confidence: 0.86, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta")] },
    { key: "sudadera_pants_deportivos", confidence: 0.86, reasons: ["kw:pants"], patterns: [wordRe("pants"), wordRe("sudadera")] },
  ],
  ropa_interior_basica: [
    { key: "brasier", confidence: 0.94, reasons: ["kw:brasier"], patterns: [wordRe("brasier"), wordRe("bra")] },
    { key: "bralette", confidence: 0.94, reasons: ["kw:bralette"], patterns: [wordRe("bralette")] },
    { key: "panty_trusa", confidence: 0.92, reasons: ["kw:panty"], patterns: [wordRe("panty"), wordRe("trusa")] },
    { key: "tanga", confidence: 0.92, reasons: ["kw:tanga"], patterns: [wordRe("tanga")] },
    { key: "brasilera", confidence: 0.92, reasons: ["kw:brasilera"], patterns: [wordRe("brasilera")] },
    { key: "boxer_largo_long_leg", confidence: 0.92, reasons: ["kw:long_leg"], patterns: [phraseRe("long leg"), phraseRe("boxer largo")] },
    { key: "boxer", confidence: 0.9, reasons: ["kw:boxer"], patterns: [wordRe("boxer"), wordRe("bóxer")] },
    { key: "brief", confidence: 0.9, reasons: ["kw:brief"], patterns: [wordRe("brief")] },
    { key: "camisilla_interior", confidence: 0.88, reasons: ["kw:camisilla"], patterns: [wordRe("camisilla"), phraseRe("camiseta interior")] },
    { key: "interior_infantil", confidence: 0.88, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids")] },
  ],
  lenceria_y_fajas_shapewear: [
    { key: "faja_cuerpo_completo", confidence: 0.94, reasons: ["kw:faja_cuerpo"], patterns: [phraseRe("cuerpo completo")] },
    { key: "faja_short", confidence: 0.92, reasons: ["kw:faja_short"], patterns: [phraseRe("faja short")] },
    { key: "faja_cintura", confidence: 0.92, reasons: ["kw:faja_cintura"], patterns: [phraseRe("faja cintura"), wordRe("cinturilla")] },
    { key: "camiseta_torso_moldeador", confidence: 0.9, reasons: ["kw:moldeador"], patterns: [wordRe("moldeador"), wordRe("moldeadora")] },
    { key: "corse", confidence: 0.92, reasons: ["kw:corse"], patterns: [wordRe("corse"), wordRe("corset")] },
    { key: "liguero", confidence: 0.92, reasons: ["kw:liguero"], patterns: [wordRe("liguero")] },
    { key: "babydoll", confidence: 0.92, reasons: ["kw:babydoll"], patterns: [wordRe("babydoll")] },
    { key: "conjunto_lenceria", confidence: 0.9, reasons: ["kw:conjunto"], patterns: [phraseRe("conjunto"), wordRe("set")] },
    { key: "body_lencero", confidence: 0.9, reasons: ["kw:body"], patterns: [wordRe("body")] },
    { key: "medias_lenceria_panty_lenceria", confidence: 0.88, reasons: ["kw:medias"], patterns: [wordRe("pantimedia"), wordRe("pantimedias"), wordRe("media"), wordRe("medias")] },
  ],
  pijamas_y_ropa_de_descanso_loungewear: [
    { key: "bata_robe", confidence: 0.93, reasons: ["kw:bata"], patterns: [wordRe("bata"), wordRe("robe")] },
    { key: "camison", confidence: 0.93, reasons: ["kw:camison"], patterns: [wordRe("camison"), wordRe("batola")] },
    { key: "pijama_termica", confidence: 0.93, reasons: ["kw:termica"], patterns: [wordRe("termica"), wordRe("thermal")] },
    { key: "pantalon_pijama", confidence: 0.9, reasons: ["kw:pantalon"], patterns: [phraseRe("pantalon pijama")] },
    { key: "short_pijama", confidence: 0.9, reasons: ["kw:short"], patterns: [phraseRe("short pijama")] },
    { key: "pijama_enteriza_onesie", confidence: 0.9, reasons: ["kw:onesie"], patterns: [wordRe("onesie")] },
    { key: "pijama_infantil", confidence: 0.88, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids")] },
    { key: "pijama_bebe", confidence: 0.88, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("recien")] },
    { key: "pijama_2_piezas", confidence: 0.7, reasons: ["fallback:pijama"], patterns: [wordRe("pijama")] },
  ],
  trajes_de_bano_y_playa: [
    { key: "traje_de_bano_infantil", confidence: 0.92, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids")] },
    { key: "panal_de_agua_bebe", confidence: 0.95, reasons: ["kw:panal"], patterns: [phraseRe("panal de agua"), phraseRe("pañal de agua"), wordRe("panal")] },
    { key: "rashguard_licra_uv", confidence: 0.94, reasons: ["kw:rashguard"], patterns: [wordRe("rashguard"), phraseRe("licra uv")] },
    { key: "salida_de_bano_kaftan", confidence: 0.92, reasons: ["kw:salida"], patterns: [phraseRe("salida de bano"), phraseRe("salida de baño"), wordRe("kaftan"), wordRe("caftan")] },
    { key: "pareo", confidence: 0.92, reasons: ["kw:pareo"], patterns: [wordRe("pareo"), wordRe("sarong")] },
    { key: "bermuda_boxer_de_bano", confidence: 0.9, reasons: ["kw:boxer_bano"], patterns: [phraseRe("boxer de bano"), phraseRe("bóxer de baño"), phraseRe("bermuda de bano")] },
    { key: "short_de_bano", confidence: 0.9, reasons: ["kw:short_bano"], patterns: [phraseRe("short de bano"), phraseRe("short de baño")] },
    { key: "tankini", confidence: 0.9, reasons: ["kw:tankini"], patterns: [wordRe("tankini")] },
    { key: "trikini", confidence: 0.9, reasons: ["kw:trikini"], patterns: [wordRe("trikini")] },
    { key: "vestido_de_bano_entero", confidence: 0.88, reasons: ["kw:entero"], patterns: [wordRe("entero"), phraseRe("una pieza")] },
    { key: "bikini", confidence: 0.88, reasons: ["kw:bikini"], patterns: [wordRe("bikini")] },
  ],
  accesorios_textiles_y_medias: [
    { key: "pantimedias_medias_veladas", confidence: 0.95, reasons: ["kw:pantimedias"], patterns: [wordRe("pantimedia"), wordRe("pantimedias"), phraseRe("media velada"), wordRe("tights"), wordRe("denier")] },
    { key: "medias_calcetines", confidence: 0.92, reasons: ["kw:medias"], patterns: [wordRe("calcetin"), wordRe("calcetines"), wordRe("media"), wordRe("medias"), wordRe("sock"), wordRe("socks"), wordRe("soquete"), wordRe("soquetes")] },
    { key: "cinturones", confidence: 0.92, reasons: ["kw:cinturon"], patterns: [wordRe("cinturon"), wordRe("cinturones"), wordRe("correa"), wordRe("belt"), wordRe("hebilla")] },
    { key: "tirantes", confidence: 0.92, reasons: ["kw:tirantes"], patterns: [wordRe("tirante"), wordRe("tirantes"), wordRe("suspender"), wordRe("suspenders")] },
    // Avoid 'tie' by itself because 'tie dye' exists; require neck tie cues.
    { key: "corbatas", confidence: 0.92, reasons: ["kw:corbata"], patterns: [wordRe("corbata"), phraseRe("neck tie"), wordRe("necktie")] },
    { key: "pajaritas_monos", confidence: 0.92, reasons: ["kw:pajarita"], patterns: [wordRe("pajarita"), wordRe("corbatin"), phraseRe("bow tie"), phraseRe("bowtie")] },
    { key: "guantes", confidence: 0.92, reasons: ["kw:guantes"], patterns: [wordRe("guante"), wordRe("guantes"), wordRe("miton"), wordRe("mitones"), wordRe("mitten"), wordRe("mittens")] },
    { key: "bufandas", confidence: 0.92, reasons: ["kw:bufanda"], patterns: [wordRe("bufanda"), wordRe("chalina"), wordRe("scarf"), phraseRe("cuello termico"), phraseRe("neck gaiter")] },
    { key: "panuelos_bandanas", confidence: 0.92, reasons: ["kw:bandana"], patterns: [wordRe("panuelo"), wordRe("panuelos"), wordRe("panoleta"), wordRe("bandana"), phraseRe("head scarf"), wordRe("turbante")] },
    { key: "chales_pashminas", confidence: 0.92, reasons: ["kw:chal"], patterns: [wordRe("chal"), wordRe("pashmina"), wordRe("estola"), wordRe("stole")] },
    { key: "gorras", confidence: 0.9, reasons: ["kw:gorra"], patterns: [wordRe("gorra"), wordRe("cap"), wordRe("snapback"), wordRe("trucker"), wordRe("visera")] },
    { key: "sombreros", confidence: 0.9, reasons: ["kw:sombrero"], patterns: [wordRe("sombrero"), phraseRe("bucket hat"), wordRe("fedora"), wordRe("panama")] },
    { key: "accesorios_para_cabello", confidence: 0.9, reasons: ["kw:cabello"], patterns: [wordRe("scrunchie"), wordRe("diadema"), wordRe("balaca"), wordRe("tiara"), wordRe("vincha"), wordRe("headband"), wordRe("pasador"), wordRe("pinza"), wordRe("gancho"), wordRe("coletero"), phraseRe("para el cabello"), phraseRe("para cabello"), wordRe("hair")] },
    // balaclava/pasamontanas should be here, but default to gorros.
    { key: "gorros_beanies", confidence: 0.9, reasons: ["kw:gorro"], patterns: [wordRe("beanie"), wordRe("balaclava"), wordRe("pasamontanas"), wordRe("gorro"), wordRe("gorros")] },
    { key: "tapabocas_mascarillas", confidence: 0.9, reasons: ["kw:tapabocas"], patterns: [wordRe("tapabocas"), wordRe("mascarilla"), phraseRe("face mask")] },
  ],
  calzado: [
    { key: "botas", confidence: 0.92, reasons: ["kw:botas"], patterns: [wordRe("botas"), wordRe("bota")] },
    { key: "botines", confidence: 0.92, reasons: ["kw:botines"], patterns: [wordRe("botin"), wordRe("botines")] },
    { key: "tenis_sneakers", confidence: 0.92, reasons: ["kw:tenis"], patterns: [wordRe("tenis"), wordRe("sneaker"), wordRe("sneakers")] },
    { key: "zapatos_deportivos", confidence: 0.9, reasons: ["kw:zapato_deportivo"], patterns: [phraseRe("zapato deportivo"), phraseRe("zapatos deportivos")] },
    { key: "zapatos_formales", confidence: 0.9, reasons: ["kw:formal"], patterns: [wordRe("oxford"), wordRe("derby"), phraseRe("zapato formal"), phraseRe("zapatos formales")] },
    { key: "sandalias", confidence: 0.9, reasons: ["kw:sandalia"], patterns: [wordRe("sandalia"), wordRe("sandalias")] },
    { key: "tacones", confidence: 0.9, reasons: ["kw:tacon"], patterns: [wordRe("tacon"), wordRe("tacones"), wordRe("heel"), wordRe("heels")] },
    { key: "mocasines_loafers", confidence: 0.9, reasons: ["kw:loafers"], patterns: [wordRe("mocasin"), wordRe("mocasines"), wordRe("loafers")] },
    { key: "balerinas_flats", confidence: 0.9, reasons: ["kw:balerinas"], patterns: [wordRe("balerina"), wordRe("balerinas"), wordRe("flats")] },
    { key: "alpargatas_espadrilles", confidence: 0.9, reasons: ["kw:alpargatas"], patterns: [wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles")] },
    { key: "zuecos", confidence: 0.9, reasons: ["kw:zuecos"], patterns: [wordRe("zueco"), wordRe("zuecos"), wordRe("clog"), wordRe("clogs")] },
    { key: "chanclas_flip_flops", confidence: 0.9, reasons: ["kw:chanclas"], patterns: [wordRe("chancla"), wordRe("chanclas"), phraseRe("flip flop"), phraseRe("flip flops")] },
  ],
  bolsos_y_marroquineria: [
    { key: "maletas_y_equipaje", confidence: 0.95, reasons: ["kw:maleta"], patterns: [wordRe("maleta"), wordRe("maletas"), wordRe("equipaje"), wordRe("trolley"), wordRe("luggage"), wordRe("suitcase")] },
    { key: "estuches_cartucheras_neceseres", confidence: 0.95, reasons: ["kw:cartuchera"], patterns: [wordRe("cartuchera"), wordRe("cartucheras"), wordRe("estuche"), wordRe("estuches"), wordRe("neceser"), wordRe("neceseres"), wordRe("cosmetiquera"), wordRe("pouch"), wordRe("lapicera")] },
    { key: "llaveros", confidence: 0.94, reasons: ["kw:llavero"], patterns: [wordRe("llavero"), wordRe("llaveros"), wordRe("keychain"), wordRe("keychains")] },
    { key: "portadocumentos_porta_pasaporte", confidence: 0.94, reasons: ["kw:documentos"], patterns: [phraseRe("porta pasaporte"), phraseRe("porta documentos"), phraseRe("portadocumentos"), phraseRe("passport")] },
    { key: "billetera", confidence: 0.92, reasons: ["kw:billetera"], patterns: [wordRe("billetera"), wordRe("monedero"), wordRe("tarjetero"), wordRe("wallet")] },
    { key: "mochila", confidence: 0.92, reasons: ["kw:mochila"], patterns: [wordRe("mochila")] },
    { key: "morral", confidence: 0.92, reasons: ["kw:morral"], patterns: [wordRe("morral")] },
    { key: "rinonera_canguro", confidence: 0.92, reasons: ["kw:rinonera"], patterns: [wordRe("rinonera"), wordRe("canguro")] },
    { key: "clutch_sobre", confidence: 0.92, reasons: ["kw:clutch"], patterns: [wordRe("clutch"), wordRe("sobre")] },
    { key: "bolso_tote", confidence: 0.9, reasons: ["kw:tote"], patterns: [wordRe("tote")] },
    { key: "bolso_bandolera_crossbody", confidence: 0.9, reasons: ["kw:crossbody"], patterns: [wordRe("bandolera"), wordRe("crossbody"), phraseRe("manos libres")] },
    { key: "bolso_de_viaje_duffel", confidence: 0.9, reasons: ["kw:duffel"], patterns: [wordRe("duffel"), phraseRe("bolso de viaje")] },
    { key: "cartera_bolso_de_mano", confidence: 0.6, reasons: ["fallback:bolso"], patterns: [wordRe("bolso"), wordRe("cartera"), wordRe("bag")] },
  ],
};

const inferCamisasYBlusas = (text: string): Suggestion | null => {
  const isCamisa = includesAny(text, [wordRe("camisa"), wordRe("shirt"), wordRe("guayabera")]);
  const isBlusa = includesAny(text, [
    wordRe("blusa"),
    wordRe("blouse"),
    wordRe("tunica"),
    wordRe("tunika"),
    phraseRe("off shoulder"),
    phraseRe("hombros descubiertos"),
  ]);

  if (wordRe("guayabera").test(text)) {
    return { category: "camisas_y_blusas", subcategory: "guayabera", confidence: 0.96, reasons: ["kw:guayabera"] };
  }

  // Camisa-specific buckets should not capture blusas just because they are "printed" or "linen".
  if (isCamisa && includesAny(text, [wordRe("denim"), wordRe("jean")])) {
    return { category: "camisas_y_blusas", subcategory: "camisa_denim", confidence: 0.94, reasons: ["kw:camisa_denim"] };
  }
  if (isCamisa && includesAny(text, [wordRe("lino"), wordRe("linen")])) {
    return { category: "camisas_y_blusas", subcategory: "camisa_de_lino", confidence: 0.94, reasons: ["kw:camisa_lino"] };
  }
  if (
    isCamisa &&
    includesAny(text, [wordRe("estampada"), wordRe("estampado"), wordRe("print"), wordRe("printed")])
  ) {
    return { category: "camisas_y_blusas", subcategory: "camisa_estampada", confidence: 0.9, reasons: ["kw:camisa_estampada"] };
  }
  if (isCamisa && includesAny(text, [wordRe("formal"), wordRe("office"), wordRe("vestir")])) {
    return { category: "camisas_y_blusas", subcategory: "camisa_formal", confidence: 0.88, reasons: ["kw:camisa_formal"] };
  }

  if (includesAny(text, [phraseRe("off shoulder"), phraseRe("hombros descubiertos")])) {
    return { category: "camisas_y_blusas", subcategory: "blusa_off_shoulder_hombros_descubiertos", confidence: 0.92, reasons: ["kw:off_shoulder"] };
  }
  if (includesAny(text, [wordRe("tunica"), wordRe("tunika")])) {
    return { category: "camisas_y_blusas", subcategory: "blusa_tipo_tunica", confidence: 0.92, reasons: ["kw:tunica"] };
  }
  if (includesAny(text, [phraseRe("cuello alto"), wordRe("turtleneck")])) {
    return { category: "camisas_y_blusas", subcategory: "blusa_cuello_alto", confidence: 0.9, reasons: ["kw:cuello_alto"] };
  }
  if (includesAny(text, [phraseRe("manga larga"), phraseRe("long sleeve")])) {
    return { category: "camisas_y_blusas", subcategory: "blusa_manga_larga", confidence: 0.85, reasons: ["kw:manga_larga"] };
  }
  if (includesAny(text, [phraseRe("manga corta"), phraseRe("short sleeve")])) {
    return { category: "camisas_y_blusas", subcategory: "blusa_manga_corta", confidence: 0.85, reasons: ["kw:manga_corta"] };
  }

  if (isCamisa && !isBlusa) {
    return { category: "camisas_y_blusas", subcategory: "camisa_casual", confidence: 0.6, reasons: ["fallback:camisa"] };
  }

  return null;
};

const inferRopaDeportiva = (text: string): Suggestion | null => {
  const hasSet = includesAny(text, [wordRe("set"), wordRe("conjunto"), phraseRe("2 piezas"), phraseRe("2pzs")]);
  const hasCompresion = includesAny(text, [wordRe("compresion"), wordRe("compression")]);
  const hasTopBra = includesAny(text, [wordRe("bra"), phraseRe("top deportivo"), wordRe("top")]);
  const hasLeggings = includesAny(text, [wordRe("legging"), wordRe("leggings")]);
  const hasShorts = includesAny(text, [wordRe("short"), wordRe("shorts")]);
  const hasPants = includesAny(text, [wordRe("pants"), wordRe("sudadera")]);
  const hasChaqueta = includesAny(text, [wordRe("chaqueta"), wordRe("jacket")]);
  const hasCamiseta = includesAny(text, [wordRe("camiseta"), wordRe("tshirt"), phraseRe("t shirt")]);

  const hasRunning = includesAny(text, [wordRe("running")]);
  const hasCiclismo = includesAny(text, [wordRe("ciclismo"), wordRe("cycling")]);
  const hasFutbol = includesAny(text, [wordRe("futbol"), wordRe("soccer"), wordRe("entrenamiento")]);

  // Prefer garment type first; sport-specific buckets are fallback (avoid losing type detail).
  if (hasSet) return { category: "ropa_deportiva_y_performance", subcategory: "conjunto_deportivo", confidence: 0.9, reasons: ["kw:conjunto"] };
  if (hasCompresion) return { category: "ropa_deportiva_y_performance", subcategory: "ropa_de_compresion", confidence: 0.92, reasons: ["kw:compresion"] };
  if (hasTopBra) return { category: "ropa_deportiva_y_performance", subcategory: "top_deportivo_bra_deportivo", confidence: 0.9, reasons: ["kw:top_bra"] };
  if (hasLeggings) return { category: "ropa_deportiva_y_performance", subcategory: "leggings_deportivos", confidence: 0.9, reasons: ["kw:leggings"] };
  if (hasShorts) return { category: "ropa_deportiva_y_performance", subcategory: "shorts_deportivos", confidence: 0.9, reasons: ["kw:shorts"] };
  if (hasPants) return { category: "ropa_deportiva_y_performance", subcategory: "sudadera_pants_deportivos", confidence: 0.86, reasons: ["kw:pants"] };
  if (hasChaqueta) return { category: "ropa_deportiva_y_performance", subcategory: "chaqueta_deportiva", confidence: 0.86, reasons: ["kw:chaqueta"] };
  if (hasCamiseta) return { category: "ropa_deportiva_y_performance", subcategory: "camiseta_deportiva", confidence: 0.88, reasons: ["kw:camiseta"] };

  if (hasRunning) return { category: "ropa_deportiva_y_performance", subcategory: "ropa_de_running", confidence: 0.78, reasons: ["kw:running"] };
  if (hasCiclismo) return { category: "ropa_deportiva_y_performance", subcategory: "ropa_de_ciclismo", confidence: 0.78, reasons: ["kw:ciclismo"] };
  if (hasFutbol) return { category: "ropa_deportiva_y_performance", subcategory: "ropa_de_futbol_entrenamiento", confidence: 0.78, reasons: ["kw:futbol"] };

  return null;
};

const inferSubcategory = (category: string, text: string): Suggestion | null => {
  if (category === "camisas_y_blusas") return inferCamisasYBlusas(text);
  if (category === "ropa_deportiva_y_performance") return inferRopaDeportiva(text);

  const rules = SUBRULES[category] || [];
  for (const rule of rules) {
    if (includesAny(text, rule.patterns)) {
      return { category, subcategory: rule.key, confidence: rule.confidence, reasons: rule.reasons };
    }
  }
  return null;
};

async function main() {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const res = await client.query(
    `
      SELECT
        p.id::text AS product_id,
        p.name AS product_name,
        p.category AS category,
        p.subcategory AS subcategory,
        p."sourceUrl" AS source_url,
        p."updatedAt" AS updated_at,
        (p.metadata -> 'enrichment') IS NOT NULL AS is_enriched,
        b.name AS brand_name
      FROM "products" p
      JOIN "brands" b ON b.id = p."brandId"
    `,
    );

    const all: Row[] = res.rows;
    const scopedBase = enrichedOnly ? all.filter((r) => r.is_enriched) : all;
    const scoped = scopedBase.filter((r) => {
      const cat = r.category ? String(r.category).trim() : "";
      const sub = r.subcategory ? String(r.subcategory).trim() : "";
      if (onlyCategory && cat !== onlyCategory) return false;
      if (onlySubcategory && sub !== onlySubcategory) return false;
      return true;
    });

  const categories = new Map<string, Row[]>();
  for (const row of scoped) {
    const cat = row.category ? String(row.category).trim() : "__NULL__";
    const list = categories.get(cat) || [];
    list.push(row);
    categories.set(cat, list);
  }

  const categoryStats: Array<Record<string, unknown>> = [];
  const subStats: Array<Record<string, unknown>> = [];
  const samples: Array<Record<string, unknown>> = [];
  const mismatches: Array<Record<string, unknown>> = [];
  const newBucketCounts = new Map<string, number>();
  const newBucketByCurrentCategory = new Map<string, Map<string, number>>(); // bucketKey -> currentCategory -> count

  const kindCounts = new Map<string, number>();
  const moveCategoryCounts = new Map<string, number>(); // from -> to
  const remapCategoryCounts = new Map<string, number>(); // from -> to (legacy/null)
  const moveSubcategoryCounts = new Map<string, number>(); // category: fromSub -> toSub
  const fillSubcategoryCounts = new Map<string, number>(); // category: __NULL__ -> toSub
  const invalidComboCounts = new Map<string, number>(); // category: sub

  const md: string[] = [];
  md.push("# Auditoria global de taxonomia (titulo vs categoria/subcategoria)");
  md.push("");
  md.push(`- Seed: \`${seed}\``);
  md.push(`- Alcance: \`${enrichedOnly ? "solo_enriched" : "todos"}\``);
  md.push(`- Only category: \`${onlyCategory || "(none)"}\``);
  md.push(`- Only subcategory: \`${onlySubcategory || "(none)"}\``);
  md.push(`- Sample por (categoria, subcategoria): **${samplePerSub}**`);
  md.push(`- Total productos considerados: **${scoped.length.toLocaleString("es-CO")}**`);
  md.push("");

  const sortedCategories = Array.from(categories.entries())
    .map(([category, rows]) => ({ category, rows }))
    .sort((a, b) => b.rows.length - a.rows.length);

  for (const { category: currentCategory, rows: catRows } of sortedCategories) {
    const isCanon = currentCategory !== "__NULL__" && isCanonicalCategory(currentCategory);
    const bySub = new Map<string, Row[]>();
    for (const row of catRows) {
      const sub = subKeyOf(row.subcategory);
      const list = bySub.get(sub) || [];
      list.push(row);
      bySub.set(sub, list);
    }

    const enrichedCount = catRows.filter((r) => r.is_enriched).length;
    const missingSubCount = catRows.filter((r) => !r.subcategory || String(r.subcategory).trim().length === 0).length;

    categoryStats.push({
      category: currentCategory,
      category_label: CATEGORY_LABELS[currentCategory] || currentCategory,
      is_canonical: isCanon,
      total: catRows.length,
      enriched: enrichedCount,
      not_enriched: catRows.length - enrichedCount,
      missing_subcategory: missingSubCount,
      pct_missing_subcategory: catRows.length ? Number(((100 * missingSubCount) / catRows.length).toFixed(1)) : 0,
      subcategories_distinct: bySub.size,
    });

    // Analyze each (category, subcategory) group.
    for (const [currentSub, groupRows] of bySub.entries()) {
      const canonicalSubs = isCanon ? SUBCATEGORY_BY_CATEGORY[currentCategory] || [] : [];
      const isValidSub = isCanon ? currentSub === "__NULL__" || canonicalSubs.includes(currentSub) : true;

      let inferredAny = 0;
      let inferredSame = 0;
      let inferredDiff = 0;
      let inferredOut = 0;

      // For __NULL__ groups, keep a distribution of inferred subcategories (top 10 in report).
      const inferredDist = new Map<string, number>();

      const scored: Array<Record<string, unknown> & { _sample_key: string }> = groupRows.map((row) => {
        const text = normalizeText(row.product_name);
        const primary = inferCanonicalCategory(text);

        // If current category is canonical, treat primary mismatch as "move category" only if very strong.
        // If current category is not canonical/NULL, primary becomes the suggested canonical category.
        let suggestedCategory = currentCategory;
        let suggestedSubcategory: string | null = currentSub === "__NULL__" ? null : currentSub;
        let confidence = 0;
        const reasons: string[] = [];
        let suggestionKind = "keep";
        let newBucketKey = "";
        let newBucketLabel = "";

        if (primary) {
          confidence = primary.confidence;
          reasons.push(...primary.reasons);

          if (primary.newBucket) {
            newBucketKey = `${primary.newBucket.kind}:${primary.newBucket.key}`;
            newBucketLabel = primary.newBucket.label;
            newBucketCounts.set(newBucketKey, (newBucketCounts.get(newBucketKey) || 0) + 1);
          }

          if (!isCanon || currentCategory === "__NULL__") {
            suggestedCategory = primary.category;
            suggestedSubcategory = primary.subcategory;
            suggestionKind = "remap_category";
          } else if (primary.newBucket && primary.category === currentCategory) {
            // Category is correct but taxonomy lacks a subcategory for this semantic bucket.
            suggestedSubcategory = primary.subcategory;
            suggestionKind = "new_subcategory_candidate";
          } else if (primary.category !== currentCategory && primary.confidence >= minMoveCategory) {
            suggestedCategory = primary.category;
            suggestedSubcategory = primary.subcategory;
            suggestionKind = "move_category";
            inferredOut += 1;
          }
        }

        // If category stays the same and is canonical, try subcategory inference.
        if (suggestedCategory === currentCategory && isCanon) {
          const inferredSub = inferSubcategory(currentCategory, text);
          if (inferredSub) {
            inferredAny += 1;
            if (inferredSub.subcategory) {
              const inferredKey = inferredSub.subcategory;
              const inferredConf = inferredSub.confidence;
              const inferredReasons = inferredSub.reasons;

              // Track distribution for missing-subcategory groups.
              inferredDist.set(inferredKey, (inferredDist.get(inferredKey) || 0) + 1);

              if (currentSub === "__NULL__") {
                if (inferredConf >= minFillSubcategory) {
                  suggestedSubcategory = inferredKey;
                  confidence = Math.max(confidence, inferredConf);
                  reasons.push(...inferredReasons);
                  suggestionKind = "fill_subcategory";
                }
              } else {
                if (inferredKey === currentSub) {
                  inferredSame += 1;
                } else {
                  inferredDiff += 1;
                  if (inferredConf >= minMoveSubcategory) {
                    suggestedSubcategory = inferredKey;
                    confidence = Math.max(confidence, inferredConf);
                    reasons.push(...inferredReasons);
                    suggestionKind = "move_subcategory";
                  }
                }
              }
            }
          }
        }

        // Flag invalid subcategory combos explicitly.
        if (isCanon && !isValidSub && currentSub !== "__NULL__") {
          suggestionKind = "invalid_subcategory";
        }

        const out = {
          product_id: row.product_id,
          brand_name: row.brand_name,
          product_name: row.product_name,
          is_enriched: row.is_enriched ? "true" : "false",
          current_category: currentCategory,
          current_category_label: CATEGORY_LABELS[currentCategory] || currentCategory,
          current_subcategory: currentSub,
          current_subcategory_label: SUBCATEGORY_LABELS[currentSub] || currentSub,
          is_current_category_canonical: isCanon ? "true" : "false",
          is_current_subcategory_valid: isValidSub ? "true" : "false",
          suggested_category: suggestedCategory,
          suggested_category_label: CATEGORY_LABELS[suggestedCategory] || suggestedCategory,
          suggested_subcategory: suggestedSubcategory || "",
          suggested_subcategory_label:
            (suggestedSubcategory && SUBCATEGORY_LABELS[suggestedSubcategory]) ? SUBCATEGORY_LABELS[suggestedSubcategory] : suggestedSubcategory || "",
          suggestion_kind: suggestionKind,
          confidence: confidence ? Number(confidence.toFixed(3)) : 0,
          reasons: reasons.join("|"),
          suggested_new_bucket: newBucketKey,
          suggested_new_bucket_label: newBucketLabel,
          source_url: row.source_url || "",
          updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : "",
          _sample_key: stableSampleKey(row.product_id),
        };

        if (suggestionKind !== "keep") {
          mismatches.push({ ...out, _sample_key: undefined });

          kindCounts.set(suggestionKind, (kindCounts.get(suggestionKind) || 0) + 1);

          if (suggestionKind === "move_category") {
            const key = `${currentCategory} -> ${suggestedCategory}`;
            moveCategoryCounts.set(key, (moveCategoryCounts.get(key) || 0) + 1);
          }
          if (suggestionKind === "remap_category") {
            const key = `${currentCategory} -> ${suggestedCategory}`;
            remapCategoryCounts.set(key, (remapCategoryCounts.get(key) || 0) + 1);
          }
          if (suggestionKind === "move_subcategory") {
            const key = `${currentCategory}:${currentSub} -> ${suggestedSubcategory || ""}`;
            moveSubcategoryCounts.set(key, (moveSubcategoryCounts.get(key) || 0) + 1);
          }
          if (suggestionKind === "fill_subcategory") {
            const key = `${currentCategory}:__NULL__ -> ${suggestedSubcategory || ""}`;
            fillSubcategoryCounts.set(key, (fillSubcategoryCounts.get(key) || 0) + 1);
          }
          if (suggestionKind === "invalid_subcategory") {
            const key = `${currentCategory}:${currentSub}`;
            invalidComboCounts.set(key, (invalidComboCounts.get(key) || 0) + 1);
          }

          if (newBucketKey) {
            const byCat = newBucketByCurrentCategory.get(newBucketKey) || new Map<string, number>();
            byCat.set(currentCategory, (byCat.get(currentCategory) || 0) + 1);
            newBucketByCurrentCategory.set(newBucketKey, byCat);
          }
        }

        return out;
      });

      // Stable sample for this group.
      scored.sort((a, b) => (a._sample_key < b._sample_key ? -1 : a._sample_key > b._sample_key ? 1 : 0));
      const picked = scored.slice(0, samplePerSub);
      for (const item of picked) {
        // Drop internal key from the exported sample file.
        const { _sample_key: _ignored, ...rest } = item;
        samples.push(rest);
      }

      // Summarize sub stats.
      const topInferred = Array.from(inferredDist.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");

      subStats.push({
        category: currentCategory,
        category_label: CATEGORY_LABELS[currentCategory] || currentCategory,
        is_canonical_category: isCanon,
        subcategory: currentSub,
        subcategory_label: SUBCATEGORY_LABELS[currentSub] || currentSub,
        is_valid_subcategory: isValidSub,
        total: groupRows.length,
        inferred_any: inferredAny,
        inferred_same: inferredSame,
        inferred_diff: inferredDiff,
        inferred_out_category: inferredOut,
        top_inferred_for_null: currentSub === "__NULL__" ? topInferred : "",
      });
    }
  }

  // Write outputs.
  fs.writeFileSync(path.join(outDir, "category_stats.json"), JSON.stringify(categoryStats, null, 2) + "\n", "utf8");
  writeCsv(
    path.join(outDir, "subcategory_stats.csv"),
    subStats,
    [
      "category",
      "category_label",
      "is_canonical_category",
      "subcategory",
      "subcategory_label",
      "is_valid_subcategory",
      "total",
      "inferred_any",
      "inferred_same",
      "inferred_diff",
      "inferred_out_category",
      "top_inferred_for_null",
    ],
  );

  const sampleHeaders = [
    "product_id",
    "brand_name",
    "product_name",
    "is_enriched",
    "current_category",
    "current_category_label",
    "current_subcategory",
    "current_subcategory_label",
    "is_current_category_canonical",
    "is_current_subcategory_valid",
    "suggested_category",
    "suggested_category_label",
    "suggested_subcategory",
    "suggested_subcategory_label",
    "suggestion_kind",
    "confidence",
    "reasons",
    "suggested_new_bucket",
    "suggested_new_bucket_label",
    "source_url",
    "updated_at",
  ];

  writeCsv(path.join(outDir, "samples.csv"), samples, sampleHeaders);
  writeCsv(path.join(outDir, "mismatches.csv"), mismatches, sampleHeaders);

  // Markdown report: top issues + new bucket candidates.
  const toSortedPairs = (map: Map<string, number>, limit = 20) =>
    Array.from(map.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);

  md.push("## Resumen (conteos por tipo de sugerencia)");
  md.push("");
  const kindSorted = toSortedPairs(kindCounts, 50);
  if (kindSorted.length === 0) {
    md.push("- (sin sugerencias)");
  } else {
    md.push("| suggestion_kind | count |");
    md.push("|---|---:|");
    for (const item of kindSorted) {
      md.push(`| \`${item.key}\` | ${item.value} |`);
    }
  }
  md.push("");

  md.push("## Top categorias NO canonicas (para remap)");
  md.push("");
  const nonCanonical = categoryStats
    .filter((row) => row.category !== "__NULL__" && row.is_canonical === false)
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, 15);
  if (nonCanonical.length === 0) {
    md.push("- (ninguna)");
  } else {
    md.push("| category | total | enriched | not_enriched | subcats_distinct |");
    md.push("|---|---:|---:|---:|---:|");
    for (const row of nonCanonical) {
      md.push(
        `| \`${row.category}\` | ${row.total} | ${row.enriched} | ${row.not_enriched} | ${row.subcategories_distinct} |`,
      );
    }
  }
  md.push("");

  md.push("## Canonicas con mas subcategoria faltante (subcategory NULL)");
  md.push("");
  const canonicalMissing = categoryStats
    .filter((row) => row.is_canonical === true && Number(row.missing_subcategory) > 0)
    .sort((a, b) => Number(b.missing_subcategory) - Number(a.missing_subcategory))
    .slice(0, 15);
  if (canonicalMissing.length === 0) {
    md.push("- (ninguna)");
  } else {
    md.push("| category | total | missing_subcategory | % missing |");
    md.push("|---|---:|---:|---:|");
    for (const row of canonicalMissing) {
      md.push(`| \`${row.category}\` | ${row.total} | ${row.missing_subcategory} | ${row.pct_missing_subcategory}% |`);
    }
  }
  md.push("");

  md.push("## Top move_category (por titulo)");
  md.push("");
  const moveCatSorted = toSortedPairs(moveCategoryCounts, 30);
  if (moveCatSorted.length === 0) {
    md.push("- (ninguno)");
  } else {
    md.push("| from -> to | count |");
    md.push("|---|---:|");
    for (const item of moveCatSorted) {
      md.push(`| \`${item.key}\` | ${item.value} |`);
    }
  }
  md.push("");

  md.push("## Top move_subcategory (por titulo)");
  md.push("");
  const moveSubSorted = toSortedPairs(moveSubcategoryCounts, 30);
  if (moveSubSorted.length === 0) {
    md.push("- (ninguno)");
  } else {
    md.push("| category: from_sub -> to_sub | count |");
    md.push("|---|---:|");
    for (const item of moveSubSorted) {
      md.push(`| \`${item.key}\` | ${item.value} |`);
    }
  }
  md.push("");

  md.push("## Top remap_category (legacy/NULL -> canonica, por titulo)");
  md.push("");
  const remapSorted = toSortedPairs(remapCategoryCounts, 30);
  if (remapSorted.length === 0) {
    md.push("- (ninguno)");
  } else {
    md.push("| from -> to | count |");
    md.push("|---|---:|");
    for (const item of remapSorted) {
      md.push(`| \`${item.key}\` | ${item.value} |`);
    }
  }
  md.push("");

  md.push("## Top fill_subcategory (para subcategory NULL)");
  md.push("");
  const fillSorted = toSortedPairs(fillSubcategoryCounts, 30);
  if (fillSorted.length === 0) {
    md.push("- (ninguno)");
  } else {
    md.push("| category: __NULL__ -> suggested_sub | count |");
    md.push("|---|---:|");
    for (const item of fillSorted) {
      md.push(`| \`${item.key}\` | ${item.value} |`);
    }
  }
  md.push("");

  const newBucketsSorted = Array.from(newBucketCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  md.push("## Hallazgos: nuevos buckets (candidatos)");
  md.push("");
  if (newBucketsSorted.length === 0) {
    md.push("- (ninguno)");
  } else {
    md.push("| bucket | count | top current categories |");
    md.push("|---|---:|---|");
    for (const item of newBucketsSorted.slice(0, 20)) {
      const byCat = newBucketByCurrentCategory.get(item.key) || new Map<string, number>();
      const topCats = Array.from(byCat.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      md.push(`| \`${item.key}\` | ${item.count} | ${topCats || "-"} |`);
    }
  }
  md.push("");

  md.push("## Combos invalidos (categoria canonica + subcategoria fuera de arbol)");
  md.push("");
  const invalidSorted = toSortedPairs(invalidComboCounts, 20);
  if (invalidSorted.length === 0) {
    md.push("- (ninguno)");
  } else {
    md.push("| combo | count |");
    md.push("|---|---:|");
    for (const item of invalidSorted) {
      md.push(`| \`${item.key}\` | ${item.value} |`);
    }
  }
  md.push("");

  md.push("## Output");
  md.push("");
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "samples.csv"))}`);
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "mismatches.csv"))}`);
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "subcategory_stats.csv"))}`);
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "category_stats.json"))}`);
  md.push("");

  fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n") + "\n", "utf8");

    // Console hint (visible in logs if needed).
    console.log(`[audit-taxonomy] wrote ${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
