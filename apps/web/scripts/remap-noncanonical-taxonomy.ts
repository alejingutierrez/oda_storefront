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
  const hasSplash =
    wordRe("splash").test(text) &&
    (mlAmountRe.test(text) || wordRe("corporal").test(text) || wordRe("body").test(text));

  if (!hasStrong && !hasFragancia && !hasSplash) return null;
  return {
    category: "hogar_y_lifestyle",
    subcategory: "cuidado_personal_y_belleza",
    confidence: hasStrong || hasSplash ? 0.99 : 0.96,
    reasons: [hasStrong || hasSplash ? "kw:beauty_strong" : "kw:beauty_fragancia"],
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

  return { category: "joyeria_y_bisuteria", subcategory: null, confidence: 0.98, reasons: ["kw:jewelry"], kind: "primary" };
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

  if (includesAny(text, strongPatterns)) {
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"], kind: "primary" };
  }

  if (includesAny(text, bootPatterns)) {
    if (looksLikePantsBotaFit(text)) return null;
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"], kind: "primary" };
  }

  return null;
};

const detectBags = (text: string): Suggestion | null => {
  const patterns = [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("bag"),
    wordRe("bags"),
    wordRe("cartera"),
    wordRe("carteras"),
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
    wordRe("print"),
    wordRe("prints"),
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
    { category: "trajes_de_bano_y_playa", confidence: 0.95, reasons: ["kw:swim"], patterns: [wordRe("bikini"), wordRe("trikini"), phraseRe("traje de bano"), phraseRe("vestido de bano"), wordRe("tankini"), wordRe("rashguard"), phraseRe("licra uv"), phraseRe("salida de bano"), wordRe("pareo")] },
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
        wordRe("brasilera"),
        wordRe("cachetero"),
        wordRe("cachetera"),
        wordRe("boxer"),
        wordRe("brief"),
        wordRe("interior"),
      ],
    },
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
    { category: "camisetas_y_tops", confidence: 0.88, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), wordRe("camisilla"), wordRe("esqueleto"), phraseRe("t shirt"), wordRe("tshirt"), wordRe("tee"), wordRe("top"), wordRe("polo")] },
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
    detectTextileAccessory(text) ||
    detectApparelCategory(text)
  );
};

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
    { key: "camiseta_manga_larga", confidence: 0.88, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve"), wordRe("m l")] },
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
  ],
  shorts_y_bermudas: [
    { key: "bermuda", confidence: 0.92, reasons: ["kw:bermuda"], patterns: [wordRe("bermuda")] },
    { key: "biker_short", confidence: 0.92, reasons: ["kw:biker"], patterns: [wordRe("biker")] },
    { key: "short_deportivo", confidence: 0.9, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport")] },
    { key: "short_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "short_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "short_cargo", confidence: 0.9, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
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
  accesorios_textiles_y_medias: [
    { key: "pantimedias_medias_veladas", confidence: 0.95, reasons: ["kw:pantimedias"], patterns: [wordRe("pantimedia"), wordRe("pantimedias"), phraseRe("media velada"), wordRe("tights"), wordRe("denier")] },
    { key: "medias_calcetines", confidence: 0.92, reasons: ["kw:medias"], patterns: [wordRe("calcetin"), wordRe("calcetines"), wordRe("medias"), wordRe("sock"), wordRe("socks"), wordRe("soquete"), wordRe("soquetes")] },
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
    { key: "zapatos_formales", confidence: 0.9, reasons: ["kw:formal"], patterns: [wordRe("oxford"), wordRe("derby"), phraseRe("zapato formal"), phraseRe("zapatos formales")] },
    { key: "sandalias", confidence: 0.9, reasons: ["kw:sandalia"], patterns: [wordRe("sandalia"), wordRe("sandalias")] },
    { key: "tacones", confidence: 0.9, reasons: ["kw:tacon"], patterns: [wordRe("tacon"), wordRe("tacones"), wordRe("heel"), wordRe("heels")] },
    { key: "mocasines_loafers", confidence: 0.9, reasons: ["kw:loafers"], patterns: [wordRe("mocasin"), wordRe("mocasines"), wordRe("loafers")] },
    { key: "balerinas_flats", confidence: 0.9, reasons: ["kw:balerinas"], patterns: [wordRe("balerina"), wordRe("balerinas"), wordRe("flats")] },
    { key: "alpargatas_espadrilles", confidence: 0.9, reasons: ["kw:alpargatas"], patterns: [wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles")] },
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
  ],
  ropa_interior_basica: [
    { key: "brasier", confidence: 0.94, reasons: ["kw:brasier"], patterns: [wordRe("brasier"), wordRe("bra")] },
    { key: "bralette", confidence: 0.94, reasons: ["kw:bralette"], patterns: [wordRe("bralette")] },
    { key: "panty_trusa", confidence: 0.92, reasons: ["kw:panty"], patterns: [wordRe("panty"), wordRe("trusa")] },
    { key: "tanga", confidence: 0.92, reasons: ["kw:tanga"], patterns: [wordRe("tanga")] },
    { key: "brasilera", confidence: 0.92, reasons: ["kw:brasilera"], patterns: [wordRe("brasilera")] },
    { key: "boxer", confidence: 0.9, reasons: ["kw:boxer"], patterns: [wordRe("boxer")] },
    { key: "brief", confidence: 0.9, reasons: ["kw:brief"], patterns: [wordRe("brief")] },
  ],
  lenceria_y_fajas_shapewear: [
    { key: "faja_cintura", confidence: 0.92, reasons: ["kw:faja_cintura"], patterns: [phraseRe("faja cintura"), wordRe("cinturilla")] },
    { key: "corse", confidence: 0.92, reasons: ["kw:corse"], patterns: [wordRe("corse"), wordRe("corset")] },
    { key: "liguero", confidence: 0.92, reasons: ["kw:liguero"], patterns: [wordRe("liguero")] },
  ],
  pijamas_y_ropa_de_descanso_loungewear: [
    { key: "bata_robe", confidence: 0.93, reasons: ["kw:bata"], patterns: [wordRe("bata"), wordRe("robe")] },
    { key: "camison", confidence: 0.93, reasons: ["kw:camison"], patterns: [wordRe("camison"), wordRe("batola")] },
    { key: "pijama_termica", confidence: 0.93, reasons: ["kw:termica"], patterns: [wordRe("termica"), wordRe("thermal")] },
  ],
  trajes_de_bano_y_playa: [
    { key: "pareo", confidence: 0.92, reasons: ["kw:pareo"], patterns: [wordRe("pareo"), wordRe("sarong")] },
    { key: "tankini", confidence: 0.9, reasons: ["kw:tankini"], patterns: [wordRe("tankini")] },
    { key: "trikini", confidence: 0.9, reasons: ["kw:trikini"], patterns: [wordRe("trikini")] },
    { key: "bikini", confidence: 0.88, reasons: ["kw:bikini"], patterns: [wordRe("bikini")] },
  ],
};

const inferSubcategory = (category: string, text: string): Suggestion | null => {
  const rules = SUBRULES[category] || [];
  for (const rule of rules) {
    if (includesAny(text, rule.patterns)) {
      return { category, subcategory: rule.key, confidence: rule.confidence, reasons: rule.reasons, kind: "subcategory" };
    }
  }
  return null;
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
      )
      ${whereScope}
      order by p."updatedAt" desc
      ${limitClause}
    `;

    const res = await client.query<Row>(query, canon);
    const rows = res.rows;

    const changes: Array<Record<string, unknown> & { _rule: Suggestion }> = [];
    for (const row of rows) {
      const fromCategory = row.category ? String(row.category).trim() : null;
      const fromSubcategory = row.subcategory ? String(row.subcategory).trim() : null;

      const text = normalizeText([row.product_name, row.description, row.source_url].filter(Boolean).join(" "));

      const primary = inferCanonicalCategory(text);
      const fallback = fromCategory ? fallbackFromLegacy(fromCategory, fromSubcategory, text) : null;
      const chosen = primary ?? fallback;

      if (!chosen) continue;
      if (!isCanonicalCategory(chosen.category)) continue;

      const toCategory = chosen.category;
      let toSubcategory: string | null = chosen.subcategory ?? null;

      // Preserve subcategory if it's already valid for the new canonical category.
      if (!toSubcategory && fromSubcategory && isAllowedSubcategory(toCategory, fromSubcategory)) {
        toSubcategory = fromSubcategory;
      }

      // If still missing/invalid, infer subcategory inside the canonical category (high precision only).
      if (!isAllowedSubcategory(toCategory, toSubcategory)) {
        toSubcategory = null;
      }
      if (!toSubcategory) {
        const inferred = inferSubcategory(toCategory, text);
        if (inferred && inferred.subcategory && inferred.confidence >= minSubcategoryConfidence) {
          if (isAllowedSubcategory(toCategory, inferred.subcategory)) {
            toSubcategory = inferred.subcategory;
          }
        }
      }

      const changed = fromCategory !== toCategory || fromSubcategory !== toSubcategory;
      if (!changed) continue;

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
        confidence: chosen.confidence,
        kind: chosen.kind,
        reasons: chosen.reasons.join("|"),
        _rule: chosen,
      });
    }

    const byFromTo = new Map<string, number>();
    for (const change of changes) {
      const key = `${change.from_category ?? "__NULL__"} -> ${change.to_category}`;
      byFromTo.set(key, (byFromTo.get(key) ?? 0) + 1);
    }

    const md: string[] = [];
    md.push(`# Remapeo global: categorias NO canonicas -> taxonomia canonica`);
    md.push("");
    md.push(`- Run: \`${runKey}\``);
    md.push(`- Apply: **${apply ? "YES" : "NO"}**`);
    md.push(`- Scope: \`${scope}\``);
    md.push(`- Include NULL category: **${includeNullCategory ? "YES" : "NO"}**`);
    md.push(`- Min subcategory confidence: **${minSubcategoryConfidence}**`);
    md.push(`- Productos candidatos (NO canonicos${includeNullCategory ? "+NULL" : ""}): **${rows.length}**`);
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
