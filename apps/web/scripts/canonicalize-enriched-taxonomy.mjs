import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const args = new Set(process.argv.slice(2));
const getArgValue = (flag) => {
  const prefix = `${flag}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return null;
};

const apply = args.has("--apply") || String(process.env.TAXON_APPLY || "").toLowerCase() === "true";
const minConfidence = Number(getArgValue("--min-confidence") || process.env.TAXON_MIN_CONFIDENCE || 0.92);
const limit = Number(getArgValue("--limit") || process.env.TAXON_LIMIT || 0) || null;
const chunkSize = Math.max(50, Number(getArgValue("--chunk-size") || process.env.TAXON_CHUNK_SIZE || 200));

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in .env/.env.local");
}

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const now = new Date();
const dateKey = now.toISOString().slice(0, 10).replaceAll("-", "");
const timeKey = now.toISOString().slice(11, 19).replaceAll(":", "");
const runKey = `${dateKey}_${timeKey}`;
const outRoot = ensureDir(path.join(repoRoot, "reports"));
const outDir = ensureDir(path.join(outRoot, `taxonomy_canon_enriched_${runKey}`));

const toCsv = (value) => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
};

const writeCsv = (filePath, rows, headers) => {
  const out = [];
  out.push(headers.join(","));
  for (const row of rows) {
    out.push(headers.map((key) => toCsv(row[key])).join(","));
  }
  fs.writeFileSync(filePath, out.join("\n") + "\n", "utf8");
};

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (word) => new RegExp(`(^|\\s)${escapeRe(word)}(\\s|$)`, "i");
const phraseRe = (phrase) => new RegExp(`\\b${escapeRe(phrase).replace(/\\s+/g, "\\\\s+")}\\b`, "i");
const includesAny = (text, patterns) => patterns.some((re) => re.test(text));

const LEGACY_CATEGORIES = [
  "tops",
  "bottoms",
  "outerwear",
  "knitwear",
  "accesorios",
  "ropa_interior",
  "trajes_de_bano",
  "deportivo",
  "enterizos",
];

// Canonical category keys we are willing to write in this script.
const CANON_CATS = new Set([
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
  "ropa_deportiva_y_performance",
  "ropa_interior_basica",
  "lenceria_y_fajas_shapewear",
  "trajes_de_bano_y_playa",
  "accesorios_textiles_y_medias",
  "calzado",
  "bolsos_y_marroquineria",
  "gafas_y_optica",
  "joyeria_y_bisuteria",
  "tarjeta_regalo",
  "hogar_y_lifestyle",
]);

// A tiny whitelist of canonical subcategory keys we may set. (Otherwise set null.)
const SUB = {
  // tarjeta_regalo
  gift_card: "gift_card",

  // calzado
  botas: "botas",
  botines: "botines",
  tenis_sneakers: "tenis_sneakers",
  zapatos_deportivos: "zapatos_deportivos",
  zapatos_formales: "zapatos_formales",
  sandalias: "sandalias",
  tacones: "tacones",
  mocasines_loafers: "mocasines_loafers",
  balerinas_flats: "balerinas_flats",
  alpargatas_espadrilles: "alpargatas_espadrilles",
  zuecos: "zuecos",
  chanclas_flip_flops: "chanclas_flip_flops",

  // vestidos
  vestido_camisero: "vestido_camisero",
  vestido_maxi: "vestido_maxi",
  vestido_midi: "vestido_midi",
  vestido_mini: "vestido_mini",
  vestido_infantil: "vestido_infantil",
  vestido_de_fiesta: "vestido_de_fiesta",
  vestido_coctel: "vestido_coctel",
  vestido_formal_noche: "vestido_formal_noche",
  vestido_de_verano: "vestido_de_verano",
  vestido_sueter: "vestido_sueter",
  vestido_casual: "vestido_casual",

  // faldas
  mini_falda: "mini_falda",
  falda_midi: "falda_midi",
  falda_maxi: "falda_maxi",
  falda_cruzada_wrap: "falda_cruzada_wrap",
  falda_denim: "falda_denim",

  // jeans_y_denim
  jean_skinny: "jean_skinny",
  jean_slim: "jean_slim",
  jean_straight: "jean_straight",
  jean_regular: "jean_regular",
  jean_mom: "jean_mom",
  jean_boyfriend: "jean_boyfriend",
  jean_bootcut: "jean_bootcut",
  jean_flare: "jean_flare",
  jean_wide_leg: "jean_wide_leg",

  // pantalones_no_denim
  pantalon_chino: "pantalon_chino",
  pantalon_cargo: "pantalon_cargo",
  jogger_casual: "jogger_casual",
  palazzo: "palazzo",
  culotte: "culotte",
  leggings_casual: "leggings_casual",
  pantalon_de_lino: "pantalon_de_lino",
  pantalon_de_dril: "pantalon_de_dril",
  pantalon_skinny_no_denim: "pantalon_skinny_no_denim",
  pantalon_flare_no_denim: "pantalon_flare_no_denim",
};

const detectFootwearSubcategory = (text) => {
  if (includesAny(text, [wordRe("bota"), wordRe("botas"), wordRe("boot"), wordRe("boots")])) return SUB.botas;
  if (includesAny(text, [wordRe("botin"), wordRe("botines"), wordRe("bootie"), wordRe("booties")])) return SUB.botines;
  if (includesAny(text, [wordRe("tenis"), wordRe("sneaker"), wordRe("sneakers")])) return SUB.tenis_sneakers;
  if (includesAny(text, [phraseRe("zapato deportivo"), phraseRe("zapatos deportivos")])) return SUB.zapatos_deportivos;
  if (includesAny(text, [phraseRe("zapato formal"), phraseRe("zapatos formales"), wordRe("oxford")])) return SUB.zapatos_formales;
  if (includesAny(text, [wordRe("sandalia"), wordRe("sandalias"), wordRe("sandal"), wordRe("sandals")])) return SUB.sandalias;
  if (includesAny(text, [wordRe("tacon"), wordRe("tacones"), wordRe("stiletto"), wordRe("heel"), wordRe("heels")])) return SUB.tacones;
  if (includesAny(text, [wordRe("mocasin"), wordRe("mocasines"), wordRe("loafer"), wordRe("loafers")])) return SUB.mocasines_loafers;
  if (includesAny(text, [wordRe("balerina"), wordRe("balerinas"), wordRe("flat"), wordRe("flats")])) return SUB.balerinas_flats;
  if (includesAny(text, [wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles")])) return SUB.alpargatas_espadrilles;
  if (includesAny(text, [wordRe("zueco"), wordRe("zuecos"), wordRe("clog"), wordRe("clogs")])) return SUB.zuecos;
  if (includesAny(text, [wordRe("chancla"), wordRe("chanclas"), phraseRe("flip flop"), phraseRe("flip flops")])) return SUB.chanclas_flip_flops;
  return null;
};

const detectDressSubcategory = (text) => {
  if (includesAny(text, [wordRe("camisero"), phraseRe("vestido camisero")])) return SUB.vestido_camisero;
  if (includesAny(text, [wordRe("maxi"), wordRe("largo"), wordRe("larga")])) return SUB.vestido_maxi;
  if (includesAny(text, [wordRe("midi")])) return SUB.vestido_midi;
  if (includesAny(text, [wordRe("mini"), wordRe("corto"), wordRe("corta")])) return SUB.vestido_mini;
  if (includesAny(text, [wordRe("infantil"), wordRe("nina"), wordRe("niña"), wordRe("bebe"), wordRe("bebé")])) return SUB.vestido_infantil;
  if (includesAny(text, [wordRe("fiesta")])) return SUB.vestido_de_fiesta;
  if (includesAny(text, [wordRe("coctel"), wordRe("cóctel"), wordRe("cocktail")])) return SUB.vestido_coctel;
  if (includesAny(text, [wordRe("formal"), wordRe("noche"), wordRe("gala")])) return SUB.vestido_formal_noche;
  if (includesAny(text, [wordRe("verano")])) return SUB.vestido_de_verano;
  if (includesAny(text, [wordRe("sueter"), wordRe("sweater")])) return SUB.vestido_sueter;
  if (includesAny(text, [wordRe("casual")])) return SUB.vestido_casual;
  return null;
};

const detectSkirtSubcategory = (text) => {
  if (includesAny(text, [wordRe("midi")])) return SUB.falda_midi;
  if (includesAny(text, [wordRe("maxi"), wordRe("larga"), wordRe("largo")])) return SUB.falda_maxi;
  if (includesAny(text, [wordRe("mini"), wordRe("corta"), wordRe("corto")])) return SUB.mini_falda;
  if (includesAny(text, [wordRe("cruzada"), wordRe("wrap")])) return SUB.falda_cruzada_wrap;
  if (includesAny(text, [wordRe("denim"), wordRe("jean"), wordRe("jeans")])) return SUB.falda_denim;
  return null;
};

const detectJeansSubcategory = (text) => {
  if (includesAny(text, [wordRe("skinny"), wordRe("ultraslim"), wordRe("ultra")])) return SUB.jean_skinny;
  if (includesAny(text, [wordRe("slim")])) return SUB.jean_slim;
  if (includesAny(text, [wordRe("recto"), wordRe("straight")])) return SUB.jean_straight;
  if (includesAny(text, [wordRe("mom")])) return SUB.jean_mom;
  if (includesAny(text, [wordRe("boyfriend"), wordRe("slouchy")])) return SUB.jean_boyfriend;
  if (includesAny(text, [wordRe("bootcut")])) return SUB.jean_bootcut;
  if (includesAny(text, [wordRe("campana"), wordRe("flare")])) return SUB.jean_flare;
  if (includesAny(text, [wordRe("palazo"), wordRe("palazzo"), wordRe("wide")])) return SUB.jean_wide_leg;
  if (includesAny(text, [wordRe("regular")])) return SUB.jean_regular;
  return null;
};

const detectPantsSubcategory = (text) => {
  if (includesAny(text, [wordRe("cargo")])) return SUB.pantalon_cargo;
  if (includesAny(text, [wordRe("chino")])) return SUB.pantalon_chino;
  if (includesAny(text, [wordRe("jogger")])) return SUB.jogger_casual;
  if (includesAny(text, [wordRe("palazo"), wordRe("palazzo")])) return SUB.palazzo;
  if (includesAny(text, [wordRe("culotte")])) return SUB.culotte;
  if (includesAny(text, [wordRe("legging"), wordRe("leggings"), wordRe("leggins")])) return SUB.leggings_casual;
  if (includesAny(text, [wordRe("lino")])) return SUB.pantalon_de_lino;
  if (includesAny(text, [wordRe("dril")])) return SUB.pantalon_de_dril;
  if (includesAny(text, [wordRe("skinny")])) return SUB.pantalon_skinny_no_denim;
  if (includesAny(text, [wordRe("campana"), wordRe("flare")])) return SUB.pantalon_flare_no_denim;
  return null;
};

const classifyCanonical = (input) => {
  const text = normalizeText([input.name, input.url, input.description].filter(Boolean).join(" "));
  const fromCategory = (input.category || "").trim();
  const fromSubcategory = (input.subcategory || "").trim();

  const hasBottomsContext = includesAny(text, [
    wordRe("jean"),
    wordRe("jeans"),
    wordRe("pantalon"),
    wordRe("pantalones"),
    wordRe("legging"),
    wordRe("leggings"),
    wordRe("leggins"),
  ]);
  const hasGarmentContext = includesAny(text, [
    wordRe("jean"),
    wordRe("jeans"),
    wordRe("denim"),
    wordRe("pantalon"),
    wordRe("pantalones"),
    wordRe("legging"),
    wordRe("leggings"),
    wordRe("leggins"),
    wordRe("falda"),
    wordRe("faldas"),
    wordRe("vestido"),
    wordRe("vestidos"),
    wordRe("enterizo"),
    wordRe("enterizos"),
    wordRe("blusa"),
    wordRe("bluson"),
    wordRe("blusones"),
    wordRe("camisa"),
    wordRe("camisas"),
    wordRe("camiseta"),
    wordRe("camisetas"),
    wordRe("buzo"),
    wordRe("buzos"),
    wordRe("hoodie"),
    wordRe("sweatshirt"),
    wordRe("sueter"),
    wordRe("sweater"),
    wordRe("cardigan"),
    wordRe("chaqueta"),
    wordRe("chaquetas"),
    wordRe("abrigo"),
    wordRe("abrigos"),
    wordRe("blazer"),
    wordRe("blazers"),
    wordRe("chaleco"),
    wordRe("chalecos"),
    wordRe("conjunto"),
    wordRe("set"),
    wordRe("short"),
    wordRe("shorts"),
    wordRe("bermuda"),
    wordRe("bermudas"),
  ]);

  // Gift cards.
  if (includesAny(text, [phraseRe("gift card"), wordRe("giftcard"), phraseRe("tarjeta regalo"), phraseRe("tarjeta de regalo"), phraseRe("bono de regalo"), wordRe("voucher")])) {
    return { category: "tarjeta_regalo", subcategory: SUB.gift_card, confidence: 0.99, reasons: ["kw:gift_card"] };
  }

  // Swimwear must beat "vestido".
  if (includesAny(text, [wordRe("bikini"), wordRe("trikini"), wordRe("tankini"), phraseRe("traje de bano"), phraseRe("vestido de bano"), wordRe("banador"), wordRe("pareo"), wordRe("rashguard")])) {
    return { category: "trajes_de_bano_y_playa", subcategory: null, confidence: 0.97, reasons: ["kw:swim"] };
  }

  // Shapewear before basic underwear.
  if (includesAny(text, [wordRe("faja"), wordRe("fajas"), wordRe("shapewear"), wordRe("moldeador"), wordRe("moldeadora"), wordRe("corset"), wordRe("corse"), wordRe("bustier"), wordRe("liguero")])) {
    return { category: "lenceria_y_fajas_shapewear", subcategory: null, confidence: 0.97, reasons: ["kw:shapewear"] };
  }

  if (includesAny(text, [wordRe("brasier"), wordRe("bralette"), wordRe("panty"), wordRe("trusa"), wordRe("tanga"), wordRe("brasilera"), wordRe("boxer"), wordRe("brief"), wordRe("interior"), wordRe("lingerie"), wordRe("jockstrap"), wordRe("suspensorio"), wordRe("thong"), wordRe("trunks")])) {
    return { category: "ropa_interior_basica", subcategory: null, confidence: 0.96, reasons: ["kw:underwear"] };
  }

  const jewelryStrong = includesAny(text, [
    wordRe("arete"),
    wordRe("aretes"),
    wordRe("topo"),
    wordRe("topos"),
    wordRe("pendiente"),
    wordRe("pendientes"),
    wordRe("argolla"),
    wordRe("argollas"),
    wordRe("collar"),
    wordRe("collares"),
    wordRe("pulsera"),
    wordRe("pulseras"),
    wordRe("brazalete"),
    wordRe("brazaletes"),
    wordRe("anillo"),
    wordRe("anillos"),
    wordRe("tobillera"),
    wordRe("tobilleras"),
    wordRe("dije"),
    wordRe("dijes"),
    wordRe("charm"),
    wordRe("charms"),
    wordRe("piercing"),
    wordRe("piercings"),
    wordRe("reloj"),
    wordRe("relojes"),
    wordRe("bisuteria"),
  ]);
  const jewelryChainOnly = !hasGarmentContext && includesAny(text, [wordRe("cadena"), wordRe("cadenas")]);
  if (jewelryStrong || jewelryChainOnly) {
    return { category: "joyeria_y_bisuteria", subcategory: null, confidence: 0.98, reasons: ["kw:jewelry"] };
  }

  if (includesAny(text, [wordRe("gafas"), wordRe("lente"), wordRe("lentes"), wordRe("montura"), wordRe("monturas"), wordRe("optica"), wordRe("sunglasses")])) {
    return { category: "gafas_y_optica", subcategory: null, confidence: 0.98, reasons: ["kw:eyewear"] };
  }

  // Bags before calzado/textiles because some URLs contain generic accessory terms.
  const bagStrong = includesAny(text, [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("mochila"),
    wordRe("mochilas"),
    wordRe("morral"),
    wordRe("morrales"),
    wordRe("rinonera"),
    wordRe("rinoneras"),
    wordRe("canguro"),
    wordRe("clutch"),
    wordRe("tote"),
    wordRe("bandolera"),
    wordRe("crossbody"),
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("monedero"),
    wordRe("monederos"),
    wordRe("cartuchera"),
    wordRe("cartucheras"),
    wordRe("neceser"),
    wordRe("neceseres"),
    wordRe("cosmetiquera"),
    wordRe("cosmetiqueras"),
    wordRe("estuche"),
    wordRe("estuches"),
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
  ]);
  // "cartera" can appear in apparel construction/terminology in some catalogs; gate it on garment context.
  const bagCarteraOnly = !hasGarmentContext && includesAny(text, [wordRe("cartera"), wordRe("carteras")]);
  if (bagStrong || bagCarteraOnly) {
    return { category: "bolsos_y_marroquineria", subcategory: null, confidence: 0.98, reasons: ["kw:bag"] };
  }

  const footwearStrong = includesAny(text, [
    wordRe("zapato"),
    wordRe("zapatos"),
    wordRe("tenis"),
    wordRe("sneaker"),
    wordRe("sneakers"),
    wordRe("sandalia"),
    wordRe("sandalias"),
    wordRe("tacon"),
    wordRe("tacones"),
    wordRe("stiletto"),
    wordRe("mocasin"),
    wordRe("mocasines"),
    wordRe("loafer"),
    wordRe("loafers"),
    wordRe("balerina"),
    wordRe("balerinas"),
    wordRe("alpargata"),
    wordRe("alpargatas"),
    wordRe("zueco"),
    wordRe("zuecos"),
    wordRe("chancla"),
    wordRe("chanclas"),
    phraseRe("flip flop"),
    phraseRe("flip flops"),
    wordRe("oxford"),
  ]);
  const footwearBootOnly =
    !hasBottomsContext &&
    includesAny(text, [
      wordRe("bota"),
      wordRe("botas"),
      wordRe("botin"),
      wordRe("botines"),
      wordRe("boot"),
      wordRe("boots"),
      wordRe("bootie"),
      wordRe("booties"),
    ]);
  if (footwearStrong || footwearBootOnly) {
    return { category: "calzado", subcategory: detectFootwearSubcategory(text), confidence: 0.98, reasons: ["kw:footwear"] };
  }

  const beltHit = includesAny(text, [
    wordRe("cinturon"),
    wordRe("cinturones"),
    wordRe("belt"),
    wordRe("belts"),
  ]);
  const textileAccessoryHit = includesAny(text, [
    wordRe("media"),
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("pantimedia"),
    wordRe("pantimedias"),
    wordRe("cinturon"),
    wordRe("cinturones"),
    wordRe("gorra"),
    wordRe("gorras"),
    wordRe("sombrero"),
    wordRe("sombreros"),
    wordRe("bufanda"),
    wordRe("bufandas"),
    wordRe("bandana"),
    wordRe("bandanas"),
    wordRe("corbata"),
    wordRe("corbatas"),
    wordRe("pajarita"),
    wordRe("pajaritas"),
    wordRe("tirante"),
    wordRe("tirantes"),
    wordRe("chal"),
    wordRe("chales"),
    wordRe("pashmina"),
    wordRe("pashminas"),
    wordRe("guante"),
    wordRe("guantes"),
  ]);
  // "con cinturón" is common apparel phrasing; only treat belts as accessories when there isn't garment context.
  if (textileAccessoryHit && !(hasGarmentContext && beltHit)) {
    return { category: "accesorios_textiles_y_medias", subcategory: null, confidence: 0.95, reasons: ["kw:textile_accessory"] };
  }

  // Legacy category mapping (only if keyword rules above did not trigger).
  if (fromCategory === "tops") {
    if (fromSubcategory === "camisetas") {
      return { category: "camisetas_y_tops", subcategory: null, confidence: 0.99, reasons: ["map:tops/camisetas"] };
    }
    if (fromSubcategory === "blusas" || fromSubcategory === "camisas") {
      return { category: "camisas_y_blusas", subcategory: null, confidence: 0.99, reasons: ["map:tops/blusas_camisas"] };
    }
    // Unknown legacy subcategory: still move to a sane canonical bucket.
    return { category: "camisas_y_blusas", subcategory: null, confidence: 0.93, reasons: ["map:tops/*"] };
  }
  if (fromCategory === "bottoms") {
    if (fromSubcategory === "jeans") {
      return { category: "jeans_y_denim", subcategory: detectJeansSubcategory(text), confidence: 0.99, reasons: ["map:bottoms/jeans"] };
    }
    if (fromSubcategory === "pantalones") {
      return { category: "pantalones_no_denim", subcategory: detectPantsSubcategory(text), confidence: 0.99, reasons: ["map:bottoms/pantalones"] };
    }
    if (fromSubcategory === "shorts") {
      return { category: "shorts_y_bermudas", subcategory: null, confidence: 0.99, reasons: ["map:bottoms/shorts"] };
    }
    if (fromSubcategory === "faldas") {
      return { category: "faldas", subcategory: detectSkirtSubcategory(text), confidence: 0.99, reasons: ["map:bottoms/faldas"] };
    }
    return { category: "pantalones_no_denim", subcategory: detectPantsSubcategory(text), confidence: 0.92, reasons: ["map:bottoms/*"] };
  }
  if (fromCategory === "outerwear") {
    if (fromSubcategory === "blazers") {
      return { category: "blazers_y_sastreria", subcategory: null, confidence: 0.99, reasons: ["map:outerwear/blazers"] };
    }
    if (fromSubcategory === "buzos") {
      return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.99, reasons: ["map:outerwear/buzos"] };
    }
    if (fromSubcategory === "chaquetas" || fromSubcategory === "abrigos") {
      return { category: "chaquetas_y_abrigos", subcategory: null, confidence: 0.99, reasons: ["map:outerwear/chaquetas_abrigos"] };
    }
    return { category: "chaquetas_y_abrigos", subcategory: null, confidence: 0.93, reasons: ["map:outerwear/*"] };
  }
  if (fromCategory === "knitwear") {
    return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.95, reasons: ["map:knitwear"] };
  }
  if (fromCategory === "deportivo") {
    return { category: "ropa_deportiva_y_performance", subcategory: null, confidence: 0.99, reasons: ["map:deportivo"] };
  }
  if (fromCategory === "trajes_de_bano") {
    return { category: "trajes_de_bano_y_playa", subcategory: null, confidence: 0.99, reasons: ["map:trajes_de_bano"] };
  }
  if (fromCategory === "ropa_interior") {
    return { category: "ropa_interior_basica", subcategory: null, confidence: 0.95, reasons: ["map:ropa_interior"] };
  }
  if (fromCategory === "enterizos") {
    return { category: "enterizos_y_overoles", subcategory: null, confidence: 0.99, reasons: ["map:enterizos"] };
  }

  // Apparel.
  if (includesAny(text, [wordRe("vestido"), wordRe("dress")])) {
    return { category: "vestidos", subcategory: detectDressSubcategory(text), confidence: 0.95, reasons: ["kw:dress"] };
  }

  if (includesAny(text, [wordRe("enterizo"), wordRe("jumpsuit"), wordRe("overol"), wordRe("overall"), wordRe("romper"), wordRe("jardinera")])) {
    return { category: "enterizos_y_overoles", subcategory: null, confidence: 0.95, reasons: ["kw:jumpsuit"] };
  }

  if (includesAny(text, [wordRe("falda"), wordRe("skirt")])) {
    return { category: "faldas", subcategory: detectSkirtSubcategory(text), confidence: 0.95, reasons: ["kw:skirt"] };
  }

  if (includesAny(text, [wordRe("jean"), wordRe("jeans")])) {
    return { category: "jeans_y_denim", subcategory: detectJeansSubcategory(text), confidence: 0.95, reasons: ["kw:jeans"] };
  }

  if (includesAny(text, [wordRe("pantalon"), wordRe("pantalones"), wordRe("trouser")])) {
    return { category: "pantalones_no_denim", subcategory: detectPantsSubcategory(text), confidence: 0.94, reasons: ["kw:pants"] };
  }

  // Unknown or not worth touching yet.
  return null;
};

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const params = [LEGACY_CATEGORIES];
    const limitClause = limit ? `limit ${Math.max(1, Math.floor(limit))}` : "";
    const query = `
      select
        p.id,
        p.name,
        p.description,
        p.category,
        p.subcategory,
        p."sourceUrl" as url,
        p.metadata,
        b.name as brand
      from products p
      join brands b on b.id = p."brandId"
      where exists (
        select 1 from product_enrichment_items i
        where i."productId" = p.id and i.status = 'completed'
      )
        and (
          p.category is null
          or p.category = any($1)
          or p.subcategory is null
        )
      order by p."updatedAt" desc
      ${limitClause}
    `;

    const { rows } = await client.query(query, params);

    const changes = [];
    for (const row of rows) {
      const fromCategory = row.category ?? null;
      const fromSubcategory = row.subcategory ?? null;
      const suggestion = classifyCanonical({
        name: row.name,
        description: row.description,
        url: row.url,
        category: fromCategory,
        subcategory: fromSubcategory,
      });
      if (!suggestion) continue;
      if (!CANON_CATS.has(suggestion.category)) continue;

      const toCategory = suggestion.category;
      const toSubcategory = suggestion.subcategory ?? null;
      const changed = fromCategory !== toCategory || fromSubcategory !== toSubcategory;
      if (!changed) continue;

      const type = fromCategory !== toCategory ? "move_category" : "move_subcategory";
      changes.push({
        type,
        product_id: row.id,
        brand: row.brand,
        name: row.name,
        url: row.url,
        from_category: fromCategory ?? "",
        from_subcategory: fromSubcategory ?? "",
        to_category: toCategory,
        to_subcategory: toSubcategory ?? "",
        confidence: suggestion.confidence,
        reasons: (suggestion.reasons || []).join("|"),
      });
    }

    const eligible = changes.filter((c) => Number(c.confidence) >= minConfidence);

    const summary = {
      run: runKey,
      apply,
      minConfidence,
      scanned: rows.length,
      changes_detected: changes.length,
      eligible_changes: eligible.length,
      breakdown: Object.fromEntries(
        Object.entries(
          eligible.reduce((acc, c) => {
            acc[c.type] = (acc[c.type] || 0) + 1;
            return acc;
          }, {}),
        ).sort((a, b) => b[1] - a[1]),
      ),
      legacy_categories: LEGACY_CATEGORIES,
    };

    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    writeCsv(
      path.join(outDir, "suggestions.csv"),
      changes,
      [
        "type",
        "product_id",
        "brand",
        "name",
        "url",
        "from_category",
        "from_subcategory",
        "to_category",
        "to_subcategory",
        "confidence",
        "reasons",
      ],
    );
    writeCsv(
      path.join(outDir, "eligible_changes.csv"),
      eligible,
      [
        "type",
        "product_id",
        "brand",
        "name",
        "url",
        "from_category",
        "from_subcategory",
        "to_category",
        "to_subcategory",
        "confidence",
        "reasons",
      ],
    );

    const md = [];
    md.push(`# Canonicalización de taxonomía (solo productos con enrichment completado)`);
    md.push("");
    md.push(`- Run: \`${runKey}\``);
    md.push(`- Apply: **${apply ? "YES" : "NO"}**`);
    md.push(`- Min confidence: **${minConfidence}**`);
    md.push(`- Productos candidatos (enrichment completed + legacy/null): **${rows.length}**`);
    md.push(`- Cambios detectados: **${changes.length}**`);
    md.push(`- Cambios elegibles (>= min-confidence): **${eligible.length}**`);
    md.push("");
    md.push(`## Breakdown (solo elegibles)`);
    md.push("");
    md.push(`| tipo | count |`);
    md.push(`|---|---:|`);
    for (const [key, count] of Object.entries(summary.breakdown ?? {})) {
      md.push(`| \`${key}\` | ${count} |`);
    }
    md.push("");
    md.push("## Archivos");
    md.push("");
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "summary.json"))}`);
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "suggestions.csv"))}`);
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "eligible_changes.csv"))}`);
    fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n") + "\n", "utf8");

    if (!apply || eligible.length === 0) {
      console.log(`[taxonomy] dry-run report written: ${outDir}`);
      return;
    }

    // Apply in chunks.
    const applied = [];
    const failed = [];
    for (let i = 0; i < eligible.length; i += chunkSize) {
      const chunk = eligible.slice(i, i + chunkSize);
      for (const change of chunk) {
        try {
          const metaRes = await client.query(`select metadata from products where id=$1`, [change.product_id]);
          const existing = metaRes.rows?.[0]?.metadata;
          const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
          const patch = {
            ...base,
            taxonomy_canonicalization: {
              rule_version: "taxonomy_canon_v1_20260208",
              applied_at: new Date().toISOString(),
              from: { category: change.from_category || null, subcategory: change.from_subcategory || null },
              to: { category: change.to_category || null, subcategory: change.to_subcategory || null },
              confidence: change.confidence,
              reasons: change.reasons || null,
            },
          };

          await client.query(
            `update products set category=$1, subcategory=$2, metadata=$3::jsonb, \"updatedAt\"=now() where id=$4`,
            [
              change.to_category || null,
              change.to_subcategory || null,
              JSON.stringify(patch),
              change.product_id,
            ],
          );
          applied.push(change);
        } catch (err) {
          failed.push({ ...change, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    fs.writeFileSync(
      path.join(outDir, "apply_summary.json"),
      JSON.stringify({ ok: failed.length === 0, applied: applied.length, failed: failed.length, failed_samples: failed.slice(0, 20) }, null, 2) +
        "\n",
      "utf8",
    );

    console.log(`[taxonomy] applied=${applied.length} failed=${failed.length} report=${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
