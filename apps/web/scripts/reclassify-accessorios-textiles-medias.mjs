import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const DEFAULT_CATEGORY = "accesorios_textiles_y_medias";
const DEFAULT_MIN_CONFIDENCE = 0.92;
const DEFAULT_CHUNK_SIZE = 300;

const args = new Set(process.argv.slice(2));
const getArgValue = (flag) => {
  const prefix = `${flag}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return null;
};

const category = getArgValue("--category") || process.env.RECLASS_CATEGORY || DEFAULT_CATEGORY;
const apply = args.has("--apply") || String(process.env.RECLASS_APPLY || "").toLowerCase() === "true";
const minConfidence = Number(getArgValue("--min-confidence") || process.env.RECLASS_MIN_CONFIDENCE || DEFAULT_MIN_CONFIDENCE);
const limit = Number(getArgValue("--limit") || process.env.RECLASS_LIMIT || 0) || null;
const chunkSize = Number(getArgValue("--chunk-size") || process.env.RECLASS_CHUNK_SIZE || DEFAULT_CHUNK_SIZE);

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in .env");
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
const outDir = ensureDir(path.join(outRoot, `reclass_${category}_${runKey}`));

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

const wordRe = (word) => new RegExp(`(^|\\s)${word}(\\s|$)`, "i");
const phraseRe = (phrase) => new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");

// Canonical taxonomy keys (must match slugify output from constants.ts).
const CAT = {
  accesorios_textiles_y_medias: "accesorios_textiles_y_medias",
  joyeria_y_bisuteria: "joyeria_y_bisuteria",
  calzado: "calzado",
  bolsos_y_marroquineria: "bolsos_y_marroquineria",
  gafas_y_optica: "gafas_y_optica",
  tarjeta_regalo: "tarjeta_regalo",
  hogar_y_lifestyle: "hogar_y_lifestyle",
  trajes_de_bano_y_playa: "trajes_de_bano_y_playa",
};

const SUB = {
  // accesorios_textiles_y_medias
  medias_calcetines: "medias_calcetines",
  pantimedias_medias_veladas: "pantimedias_medias_veladas",
  cinturones: "cinturones",
  gorras: "gorras",
  sombreros: "sombreros",
  bufandas: "bufandas",
  guantes: "guantes",
  panuelos_bandanas: "panuelos_bandanas",
  corbatas: "corbatas",
  pajaritas_monos: "pajaritas_monos",
  tirantes: "tirantes",
  chales_pashminas: "chales_pashminas",
  accesorios_para_cabello: "accesorios_para_cabello",
  gorros_beanies: "gorros_beanies",
  tapabocas_mascarillas: "tapabocas_mascarillas",

  // joyeria_y_bisuteria
  aretes_pendientes: "aretes_pendientes",
  collares: "collares",
  pulseras_brazaletes: "pulseras_brazaletes",
  anillos: "anillos",
  tobilleras: "tobilleras",
  dijes_charms: "dijes_charms",
  broches_prendedores: "broches_prendedores",
  sets_de_joyeria: "sets_de_joyeria",
  piercings: "piercings",
  relojes: "relojes",

  // gafas_y_optica
  gafas_de_sol: "gafas_de_sol",
  gafas_opticas_formuladas: "gafas_opticas_formuladas",
  monturas: "monturas",
  goggles_deportivas: "goggles_deportivas",
  lentes_de_proteccion: "lentes_de_proteccion",

  // bolsos_y_marroquineria
  cartera_bolso_de_mano: "cartera_bolso_de_mano",
  bolso_tote: "bolso_tote",
  bolso_bandolera_crossbody: "bolso_bandolera_crossbody",
  mochila: "mochila",
  morral: "morral",
  rinonera_canguro: "rinonera_canguro",
  clutch_sobre: "clutch_sobre",
  estuches_cartucheras_neceseres: "estuches_cartucheras_neceseres",
  billetera: "billetera",
  llaveros: "llaveros",
  portadocumentos_porta_pasaporte: "portadocumentos_porta_pasaporte",
  bolso_de_viaje_duffel: "bolso_de_viaje_duffel",

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

  // tarjeta_regalo
  gift_card: "gift_card",

  // hogar_y_lifestyle
  textiles_de_mesa: "textiles_de_mesa",
  cojines_y_fundas: "cojines_y_fundas",
  velas_y_aromas: "velas_y_aromas",
  arte_y_posters: "arte_y_posters",
  papeleria_y_libros: "papeleria_y_libros",
  toallas_y_bano: "toallas_y_bano",
  mantas_y_cobijas: "mantas_y_cobijas",
  hogar_otros: "hogar_otros",

  // trajes_de_bano_y_playa
  pareo: "pareo",
};

const includesAny = (text, patterns) => patterns.some((re) => re.test(text));

const isPetContext = (text) =>
  includesAny(text, [
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
  ]);

const hasSockContext = (text) =>
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

const hasHairContext = (text) =>
  includesAny(text, [
    wordRe("cabello"),
    wordRe("pelo"),
    wordRe("hair"),
    phraseRe("hair clip"),
    phraseRe("hairclip"),
    wordRe("scrunchie"),
    wordRe("scrunchies"),
    wordRe("diadema"),
    wordRe("diademas"),
    wordRe("balaca"),
    wordRe("balacas"),
    wordRe("tiara"),
    wordRe("tiaras"),
    wordRe("vincha"),
    wordRe("vinchas"),
    wordRe("headband"),
    wordRe("headbands"),
    wordRe("pasador"),
    wordRe("pasadores"),
    wordRe("pinza"),
    wordRe("pinzas"),
    wordRe("gancho"),
    wordRe("ganchos"),
  ]);

const detectGiftCard = (text) => {
  const patterns = [
    phraseRe("gift card"),
    wordRe("giftcard"),
    phraseRe("e gift card"),
    phraseRe("e giftcard"),
    phraseRe("tarjeta regalo"),
    phraseRe("tarjeta de regalo"),
    phraseRe("bono de regalo"),
    wordRe("voucher"),
    wordRe("vauche"), // common typo
    wordRe("bono"),
  ];

  // Avoid matching generic "bono" (can be discount/bonus) unless also has gift cues.
  const hasGiftCue = includesAny(text, [wordRe("gift"), phraseRe("tarjeta regalo"), phraseRe("tarjeta de regalo"), wordRe("voucher")]);
  if (includesAny(text, [wordRe("bono")]) && !hasGiftCue) return null;

  if (!includesAny(text, patterns)) return null;
  return {
    category: CAT.tarjeta_regalo,
    subcategory: SUB.gift_card,
    confidence: 0.99,
    reasons: ["kw:gift_card"],
  };
};

const detectHome = (text) => {
  const tablePatterns = [
    wordRe("mantel"),
    wordRe("manteles"),
    phraseRe("camino de mesa"),
    phraseRe("table runner"),
    wordRe("servilleta"),
    wordRe("servilletas"),
    wordRe("servilletero"),
    wordRe("servilleteros"),
    wordRe("napkin"),
    wordRe("napkins"),
    phraseRe("napkin ring"),
    phraseRe("napkin rings"),
    phraseRe("napkin holder"),
    phraseRe("napkin holders"),
    wordRe("individual"),
    wordRe("individuales"),
    wordRe("placemat"),
    wordRe("placemats"),
    wordRe("posavasos"),
    wordRe("coaster"),
    wordRe("coasters"),
  ];

  const pillowPatterns = [
    wordRe("cojin"),
    wordRe("cojines"),
    wordRe("cushion"),
    wordRe("cushions"),
    wordRe("pillow"),
    wordRe("pillows"),
    wordRe("funda"),
    wordRe("fundas"),
    wordRe("pillowcase"),
    wordRe("pillowcases"),
  ];

  const candlePatterns = [
    wordRe("vela"),
    wordRe("velas"),
    phraseRe("scented candle"),
    wordRe("candle"),
    wordRe("candles"),
    wordRe("difusor"),
    wordRe("difusores"),
    wordRe("diffuser"),
    wordRe("diffusers"),
    wordRe("incienso"),
    wordRe("incense"),
    wordRe("aroma"),
    wordRe("aromas"),
    wordRe("fragancia"),
    wordRe("fragancias"),
    wordRe("fragrance"),
    wordRe("fragrances"),
  ];

  const posterPatterns = [
    wordRe("poster"),
    wordRe("posters"),
    wordRe("afiche"),
    wordRe("afiches"),
    wordRe("lamina"),
    wordRe("laminas"),
  ];

  const paperPatterns = [
    wordRe("papeleria"),
    wordRe("libro"),
    wordRe("libros"),
    wordRe("librito"),
    wordRe("libritos"),
    wordRe("agenda"),
    wordRe("agendas"),
    wordRe("cuaderno"),
    wordRe("cuadernos"),
    wordRe("sticker"),
    wordRe("stickers"),
    wordRe("separalibros"),
    wordRe("marcapaginas"),
    phraseRe("marca paginas"),
    wordRe("bookmark"),
    wordRe("bookmarks"),
    wordRe("oraculo"),
    wordRe("oraculos"),
    wordRe("tarot"),
    wordRe("journal"),
    wordRe("journals"),
    wordRe("notebook"),
    wordRe("notebooks"),
    // "book(s)" is useful for english-only titles; guard against lookbooks below.
    wordRe("book"),
    wordRe("books"),
    phraseRe("para colorear"),
    phraseRe("coloring book"),
    phraseRe("colouring book"),
    wordRe("postcard"),
    wordRe("postcards"),
  ];

  const towelPatterns = [
    wordRe("toalla"),
    wordRe("toallas"),
    wordRe("towel"),
    wordRe("towels"),
    wordRe("bath"),
    wordRe("bano"),
  ];

  const blanketPatterns = [
    wordRe("manta"),
    wordRe("mantas"),
    wordRe("cobija"),
    wordRe("cobijas"),
    wordRe("blanket"),
    wordRe("blankets"),
    wordRe("throw"),
    wordRe("throws"),
  ];

  const otherPatterns = [
    wordRe("taza"),
    wordRe("tazas"),
    wordRe("mug"),
    wordRe("mugs"),
    wordRe("vaso"),
    wordRe("vasos"),
  ];

  if (includesAny(text, tablePatterns)) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.textiles_de_mesa, confidence: 0.97, reasons: ["kw:home_table"] };
  }
  if (includesAny(text, pillowPatterns)) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.cojines_y_fundas, confidence: 0.97, reasons: ["kw:home_pillow"] };
  }
  if (includesAny(text, candlePatterns)) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.velas_y_aromas, confidence: 0.97, reasons: ["kw:home_candle"] };
  }
  if (includesAny(text, posterPatterns)) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.arte_y_posters, confidence: 0.96, reasons: ["kw:home_poster"] };
  }
  const paperGuard = includesAny(text, [
    // Avoid stealing "lookbook" content.
    wordRe("lookbook"),
    // Avoid misclassifying bags that mention "book/notebook" in the title.
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("cartera"),
    wordRe("carteras"),
    wordRe("bag"),
    wordRe("bags"),
    wordRe("tote"),
    wordRe("mochila"),
    wordRe("mochilas"),
    wordRe("morral"),
    wordRe("morrales"),
    wordRe("wallet"),
    wordRe("handbag"),
  ]);
  if (includesAny(text, paperPatterns) && !paperGuard) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.papeleria_y_libros, confidence: 0.97, reasons: ["kw:lifestyle_paper"] };
  }
  if (includesAny(text, towelPatterns)) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.toallas_y_bano, confidence: 0.96, reasons: ["kw:home_towel"] };
  }
  const wrapGuard = includesAny(text, [
    wordRe("bufanda"),
    wordRe("bufandas"),
    wordRe("scarf"),
    wordRe("scarves"),
    wordRe("chal"),
    wordRe("chales"),
    wordRe("pashmina"),
    wordRe("pashminas"),
    wordRe("estola"),
    wordRe("estolas"),
    wordRe("stole"),
    wordRe("stoles"),
    wordRe("shawl"),
    wordRe("shawls"),
  ]);
  if (includesAny(text, blanketPatterns) && !wrapGuard) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.mantas_y_cobijas, confidence: 0.96, reasons: ["kw:home_blanket"] };
  }
  if (includesAny(text, otherPatterns)) {
    return { category: CAT.hogar_y_lifestyle, subcategory: SUB.hogar_otros, confidence: 0.93, reasons: ["kw:home_other"] };
  }
  return null;
};

const detectEyewear = (text) => {
  const anyEyewear = includesAny(text, [
    wordRe("gafas"),
    wordRe("lente"),
    wordRe("lentes"),
    wordRe("montura"),
    wordRe("monturas"),
    wordRe("optica"),
    wordRe("sunglasses"),
    wordRe("goggle"),
    wordRe("goggles"),
    wordRe("frames"),
    wordRe("frame"),
  ]);
  if (!anyEyewear) return null;

  let sub = null;
  let reasons = ["kw:eyewear"];
  if (includesAny(text, [wordRe("sunglasses"), phraseRe("gafas de sol"), phraseRe("gafas sol")])) {
    sub = SUB.gafas_de_sol;
    reasons.push("sub:gafas_de_sol");
  } else if (includesAny(text, [wordRe("goggles"), wordRe("goggle")])) {
    sub = SUB.goggles_deportivas;
    reasons.push("sub:goggles_deportivas");
  } else if (includesAny(text, [wordRe("montura"), wordRe("monturas"), wordRe("frame"), wordRe("frames")])) {
    sub = SUB.monturas;
    reasons.push("sub:monturas");
  } else if (includesAny(text, [wordRe("optica"), wordRe("formulada"), wordRe("formuladas"), wordRe("prescription")])) {
    sub = SUB.gafas_opticas_formuladas;
    reasons.push("sub:gafas_opticas_formuladas");
  } else if (includesAny(text, [phraseRe("lentes de proteccion"), wordRe("proteccion"), wordRe("safety")])) {
    sub = SUB.lentes_de_proteccion;
    reasons.push("sub:lentes_de_proteccion");
  } else {
    sub = SUB.gafas_de_sol;
    reasons.push("sub:default_gafas_de_sol");
  }

  return { category: CAT.gafas_y_optica, subcategory: sub, confidence: 0.98, reasons };
};

const detectBags = (text) => {
  const anyBag = includesAny(text, [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("cartera"),
    wordRe("carteras"),
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("monedero"),
    wordRe("monederos"),
    wordRe("cartuchera"),
    wordRe("cartucheras"),
    wordRe("cosmetiquera"),
    wordRe("cosmetiqueras"),
    wordRe("neceser"),
    wordRe("neceseres"),
    wordRe("estuche"),
    wordRe("estuches"),
    wordRe("pouch"),
    wordRe("pouches"),
    wordRe("lapicera"),
    wordRe("lapiceras"),
    wordRe("llavero"),
    wordRe("llaveros"),
    wordRe("keychain"),
    wordRe("keychains"),
    wordRe("mochila"),
    wordRe("mochilas"),
    wordRe("morral"),
    wordRe("morrales"),
    wordRe("rinonera"),
    wordRe("rinoneras"),
    wordRe("canguro"),
    phraseRe("belt bag"),
    wordRe("clutch"),
    wordRe("tote"),
    wordRe("bandolera"),
    wordRe("crossbody"),
    phraseRe("porta pasaporte"),
    phraseRe("portapasaporte"),
    phraseRe("porta documentos"),
    phraseRe("portadocumentos"),
    wordRe("duffel"),
    phraseRe("bolso de viaje"),
    wordRe("wallet"),
    wordRe("handbag"),
    wordRe("bag"),
    wordRe("bags"),
  ]);
  if (!anyBag) return null;

  const reasons = ["kw:bag"];
  let sub = SUB.cartera_bolso_de_mano;

  const keychain = includesAny(text, [wordRe("llavero"), wordRe("llaveros"), wordRe("keychain"), wordRe("keychains")]);
  const cases = includesAny(text, [
    wordRe("cartuchera"),
    wordRe("cartucheras"),
    wordRe("cosmetiquera"),
    wordRe("cosmetiqueras"),
    wordRe("neceser"),
    wordRe("neceseres"),
    wordRe("estuche"),
    wordRe("estuches"),
    wordRe("pouch"),
    wordRe("pouches"),
    wordRe("lapicera"),
    wordRe("lapiceras"),
  ]);

  if (keychain) sub = SUB.llaveros;
  else if (cases) sub = SUB.estuches_cartucheras_neceseres;
  else if (includesAny(text, [wordRe("tote")])) sub = SUB.bolso_tote;
  else if (includesAny(text, [wordRe("crossbody"), wordRe("bandolera")])) sub = SUB.bolso_bandolera_crossbody;
  else if (includesAny(text, [wordRe("mochila"), wordRe("mochilas")])) sub = SUB.mochila;
  else if (includesAny(text, [wordRe("morral"), wordRe("morrales")])) sub = SUB.morral;
  else if (includesAny(text, [wordRe("rinonera"), wordRe("rinoneras"), wordRe("canguro"), phraseRe("belt bag")])) sub = SUB.rinonera_canguro;
  else if (includesAny(text, [wordRe("clutch"), wordRe("sobre")])) sub = SUB.clutch_sobre;
  else if (includesAny(text, [wordRe("billetera"), wordRe("billeteras"), wordRe("wallet"), wordRe("monedero"), wordRe("monederos")])) sub = SUB.billetera;
  else if (includesAny(text, [phraseRe("porta pasaporte"), phraseRe("portapasaporte"), phraseRe("porta documentos"), phraseRe("portadocumentos")])) {
    sub = SUB.portadocumentos_porta_pasaporte;
  } else if (includesAny(text, [wordRe("duffel"), phraseRe("bolso de viaje")])) sub = SUB.bolso_de_viaje_duffel;
  else if (includesAny(text, [wordRe("cartera"), wordRe("handbag")])) sub = SUB.cartera_bolso_de_mano;

  reasons.push(`sub:${sub}`);
  const confidence = keychain || cases ? 0.98 : 0.97;
  return { category: CAT.bolsos_y_marroquineria, subcategory: sub, confidence, reasons };
};

const detectFootwear = (text) => {
  const anyFootwear = includesAny(text, [
    wordRe("zapato"),
    wordRe("zapatos"),
    wordRe("tenis"),
    wordRe("tennis"),
    wordRe("sneaker"),
    wordRe("sneakers"),
    wordRe("shoe"),
    wordRe("shoes"),
    wordRe("sandalia"),
    wordRe("sandalias"),
    wordRe("sandal"),
    wordRe("sandals"),
    wordRe("tacon"),
    wordRe("tacones"),
    wordRe("heel"),
    wordRe("heels"),
    wordRe("bota"),
    wordRe("botas"),
    wordRe("boot"),
    wordRe("boots"),
    wordRe("botin"),
    wordRe("botines"),
    wordRe("bootie"),
    wordRe("booties"),
    wordRe("mocasin"),
    wordRe("mocasines"),
    wordRe("loafer"),
    wordRe("loafers"),
    wordRe("balerina"),
    wordRe("balerinas"),
    wordRe("flat"),
    wordRe("flats"),
    wordRe("alpargata"),
    wordRe("alpargatas"),
    wordRe("espadrille"),
    wordRe("espadrilles"),
    wordRe("zueco"),
    wordRe("zuecos"),
    wordRe("clog"),
    wordRe("clogs"),
    wordRe("chancla"),
    wordRe("chanclas"),
    phraseRe("flip flops"),
    phraseRe("flip flop"),
    wordRe("slipper"),
    wordRe("slippers"),
  ]);
  if (!anyFootwear) return null;

  const reasons = ["kw:footwear"];
  let sub = SUB.zapatos_formales;

  if (includesAny(text, [wordRe("bota"), wordRe("botas"), wordRe("boot"), wordRe("boots")])) sub = SUB.botas;
  else if (includesAny(text, [wordRe("botin"), wordRe("botines"), wordRe("bootie"), wordRe("booties")])) sub = SUB.botines;
  else if (includesAny(text, [wordRe("tenis"), wordRe("sneaker"), wordRe("sneakers")])) sub = SUB.tenis_sneakers;
  else if (includesAny(text, [phraseRe("zapato deportivo"), phraseRe("zapatos deportivos")])) sub = SUB.zapatos_deportivos;
  else if (includesAny(text, [wordRe("sandalia"), wordRe("sandalias"), wordRe("sandal"), wordRe("sandals")])) sub = SUB.sandalias;
  else if (includesAny(text, [wordRe("tacon"), wordRe("tacones"), wordRe("heel"), wordRe("heels")])) sub = SUB.tacones;
  else if (includesAny(text, [wordRe("mocasin"), wordRe("mocasines"), wordRe("loafer"), wordRe("loafers")])) sub = SUB.mocasines_loafers;
  else if (includesAny(text, [wordRe("balerina"), wordRe("balerinas"), wordRe("flat"), wordRe("flats")])) sub = SUB.balerinas_flats;
  else if (includesAny(text, [wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles")])) sub = SUB.alpargatas_espadrilles;
  else if (includesAny(text, [wordRe("zueco"), wordRe("zuecos"), wordRe("clog"), wordRe("clogs")])) sub = SUB.zuecos;
  else if (includesAny(text, [wordRe("chancla"), wordRe("chanclas"), phraseRe("flip flops"), phraseRe("flip flop")])) sub = SUB.chanclas_flip_flops;
  else if (includesAny(text, [wordRe("zapato"), wordRe("zapatos"), wordRe("shoe"), wordRe("shoes")])) sub = SUB.zapatos_formales;

  reasons.push(`sub:${sub}`);
  return { category: CAT.calzado, subcategory: sub, confidence: 0.97, reasons };
};

const detectSwimwear = (text) => {
  const pareo = includesAny(text, [wordRe("pareo"), wordRe("pareos"), wordRe("sarong"), wordRe("sarongs")]);
  if (!pareo) return null;
  return { category: CAT.trajes_de_bano_y_playa, subcategory: SUB.pareo, confidence: 0.98, reasons: ["kw:pareo"] };
};

const detectJewelry = (text) => {
  const hasCollar = includesAny(text, [wordRe("collar"), wordRe("collares"), wordRe("necklace"), wordRe("necklaces")]);
  const hasAnklet = includesAny(text, [wordRe("tobillera"), wordRe("tobilleras"), wordRe("anklet"), wordRe("anklets")]);
  const hasBroche = includesAny(text, [wordRe("broche"), wordRe("broches"), wordRe("prendedor"), wordRe("prendedores")]);
  const hasChoker =
    includesAny(text, [wordRe("choker"), wordRe("chokers"), wordRe("gargantilla"), wordRe("gargantillas")]) ||
    text.includes("choker");
  const hasRingContext = includesAny(text, [
    wordRe("compromiso"),
    wordRe("matrimonio"),
    wordRe("boda"),
    wordRe("alianza"),
    wordRe("alianzas"),
    wordRe("wedding"),
    wordRe("engagement"),
  ]);
  const hasEarringSyn = includesAny(text, [
    wordRe("candonga"),
    wordRe("candongas"),
    wordRe("earcuff"),
    wordRe("earcuffs"),
    phraseRe("ear cuff"),
    phraseRe("ear cuffs"),
    wordRe("topo"),
    wordRe("topos"),
    wordRe("stud"),
    wordRe("studs"),
    wordRe("hoop"),
    wordRe("hoops"),
    wordRe("argolla"),
    wordRe("argollas"),
    wordRe("arracada"),
    wordRe("arracadas"),
  ]);
  const jewelryPatterns = [
    wordRe("arete"),
    wordRe("aretes"),
    wordRe("pendiente"),
    wordRe("pendientes"),
    wordRe("earring"),
    wordRe("earrings"),
    wordRe("anillo"),
    wordRe("anillos"),
    wordRe("ring"),
    wordRe("rings"),
    wordRe("alianza"),
    wordRe("alianzas"),
    wordRe("pulsera"),
    wordRe("pulseras"),
    wordRe("brazalete"),
    wordRe("brazaletes"),
    wordRe("bracelet"),
    wordRe("bracelets"),
    wordRe("bangle"),
    wordRe("bangles"),
    wordRe("piercing"),
    wordRe("piercings"),
    wordRe("dije"),
    wordRe("dijes"),
    wordRe("charm"),
    wordRe("charms"),
    wordRe("pendant"),
    wordRe("pendants"),
    wordRe("reloj"),
    wordRe("relojes"),
    wordRe("watch"),
    wordRe("watches"),
    // Keep "collar" & "tobillera" special-cased for disambiguation below.
  ];

  const anyJewelry = hasCollar || hasAnklet || hasBroche || hasChoker || hasEarringSyn || includesAny(text, jewelryPatterns);
  if (!anyJewelry) return null;

  // Disambiguation: "broche" can be a hair accessory (clip). Don't steal those from textiles.
  if (hasBroche && hasHairContext(text)) return null;

  // Disambiguation: pet collars should not become jewelry.
  if (hasCollar && isPetContext(text)) return null;

  // Disambiguation: "tobillera" can be a sock type (ankle socks).
  if (hasAnklet && hasSockContext(text)) return null;
  if (hasAnklet && !includesAny(text, [wordRe("anklet"), wordRe("anklets")])) {
    // If it's only "tobillera(s)" without other jewelry cues, it's safer to treat as socks.
    const otherJewelryCue = includesAny(text, [
      wordRe("arete"),
      wordRe("aretes"),
      wordRe("pendiente"),
      wordRe("pendientes"),
      wordRe("earring"),
      wordRe("earrings"),
      wordRe("anillo"),
      wordRe("anillos"),
      wordRe("ring"),
      wordRe("rings"),
      wordRe("pulsera"),
      wordRe("pulseras"),
      wordRe("brazalete"),
      wordRe("brazaletes"),
      wordRe("bracelet"),
      wordRe("bracelets"),
      wordRe("cadena"),
      wordRe("cadenas"),
      wordRe("chain"),
      wordRe("chains"),
      wordRe("oro"),
      wordRe("plata"),
      wordRe("gold"),
      wordRe("silver"),
      wordRe("charm"),
      wordRe("charms"),
      wordRe("dije"),
      wordRe("dijes"),
    ]);
    if (!otherJewelryCue) return null;
  }

  // Disambiguation: "argolla/stud/hoops" can be hardware wording for belts/accessories.
  const beltContext = includesAny(text, [
    wordRe("cinturon"),
    wordRe("cinturones"),
    wordRe("belt"),
    wordRe("correa"),
    wordRe("correas"),
    wordRe("hebilla"),
    wordRe("hebillas"),
  ]);
  const strongEarringSyn = includesAny(text, [
    wordRe("candonga"),
    wordRe("candongas"),
    wordRe("earcuff"),
    wordRe("earcuffs"),
    phraseRe("ear cuff"),
    phraseRe("ear cuffs"),
    wordRe("topo"),
    wordRe("topos"),
    wordRe("arracada"),
    wordRe("arracadas"),
  ]);
  const weakHardwareSyn = includesAny(text, [
    wordRe("argolla"),
    wordRe("argollas"),
    wordRe("stud"),
    wordRe("studs"),
    wordRe("hoop"),
    wordRe("hoops"),
  ]);
  const otherJewelryCue = hasCollar || hasAnklet || hasBroche || hasChoker || includesAny(text, jewelryPatterns);
  if (beltContext && weakHardwareSyn && !strongEarringSyn && !otherJewelryCue) return null;

  let sub = null;
  const reasons = ["kw:jewelry"];

  const argollaAsRing = hasRingContext && includesAny(text, [wordRe("argolla"), wordRe("argollas")]);
  const alianzaAsRing = includesAny(text, [wordRe("alianza"), wordRe("alianzas")]);

  if (argollaAsRing || alianzaAsRing) {
    sub = SUB.anillos;
  } else if (
    includesAny(text, [
      wordRe("arete"),
      wordRe("aretes"),
      wordRe("pendiente"),
      wordRe("pendientes"),
      wordRe("earring"),
      wordRe("earrings"),
      wordRe("candonga"),
      wordRe("candongas"),
      wordRe("earcuff"),
      wordRe("earcuffs"),
      phraseRe("ear cuff"),
      phraseRe("ear cuffs"),
      wordRe("topo"),
      wordRe("topos"),
      wordRe("stud"),
      wordRe("studs"),
      wordRe("hoop"),
      wordRe("hoops"),
      wordRe("argolla"),
      wordRe("argollas"),
      wordRe("arracada"),
      wordRe("arracadas"),
    ])
  ) {
    sub = SUB.aretes_pendientes;
  } else if (hasChoker || hasCollar) {
    sub = SUB.collares;
  } else if (includesAny(text, [wordRe("pulsera"), wordRe("pulseras"), wordRe("brazalete"), wordRe("brazaletes"), wordRe("bracelet"), wordRe("bracelets"), wordRe("bangle"), wordRe("bangles")])) {
    sub = SUB.pulseras_brazaletes;
  } else if (includesAny(text, [wordRe("anillo"), wordRe("anillos"), wordRe("ring"), wordRe("rings")])) {
    sub = SUB.anillos;
  } else if (hasAnklet) {
    sub = SUB.tobilleras;
  } else if (includesAny(text, [wordRe("dije"), wordRe("dijes"), wordRe("charm"), wordRe("charms"), wordRe("pendant"), wordRe("pendants")])) {
    sub = SUB.dijes_charms;
  } else if (includesAny(text, [wordRe("broche"), wordRe("broches"), wordRe("prendedor"), wordRe("prendedores")])) {
    sub = SUB.broches_prendedores;
  } else if (includesAny(text, [wordRe("piercing"), wordRe("piercings")])) {
    sub = SUB.piercings;
  } else if (includesAny(text, [wordRe("reloj"), wordRe("relojes"), wordRe("watch"), wordRe("watches")])) {
    sub = SUB.relojes;
  }

  // "Set" of jewelry: only if we already have a jewelry signal and "set" is present.
  const hasSet = includesAny(text, [wordRe("set"), wordRe("sets"), phraseRe("set of")]);
  if (hasSet && sub) {
    reasons.push("kw:set");
    // Keep explicit subcategory unless it's missing.
    if (!sub) sub = SUB.sets_de_joyeria;
  }

  if (!sub) {
    // Category-only move; leave subcategory null.
    return { category: CAT.joyeria_y_bisuteria, subcategory: null, confidence: 0.96, reasons: [...reasons, "sub:unknown"] };
  }

  reasons.push(`sub:${sub}`);
  return { category: CAT.joyeria_y_bisuteria, subcategory: sub, confidence: 0.97, reasons };
};

const detectAccessorySubcategory = (text) => {
  // New buckets first (more specific).
  const hair = includesAny(text, [
    wordRe("scrunchie"),
    wordRe("scrunchies"),
    wordRe("diadema"),
    wordRe("diademas"),
    wordRe("balaca"),
    wordRe("balacas"),
    wordRe("tiara"),
    wordRe("tiaras"),
    wordRe("vincha"),
    wordRe("vinchas"),
    wordRe("headband"),
    wordRe("headbands"),
    wordRe("pasador"),
    wordRe("pasadores"),
    wordRe("pinza"),
    wordRe("pinzas"),
    wordRe("gancho"),
    wordRe("ganchos"),
    wordRe("coletero"),
    wordRe("coleteros"),
    wordRe("liguita"),
    wordRe("liguitas"),
    phraseRe("para el cabello"),
    phraseRe("para cabello"),
    phraseRe("para el pelo"),
    phraseRe("para pelo"),
    phraseRe("hair clip"),
    phraseRe("hairclip"),
  ]);
  if (hair) return { subcategory: SUB.accesorios_para_cabello, confidence: 0.95, reasons: ["kw:hair_accessory"] };

  const hasBucketHat = phraseRe("bucket hat").test(text) || phraseRe("sombrero bucket").test(text);
  const hasBeanie = includesAny(text, [wordRe("beanie"), wordRe("beanies")]);
  const hasGorro = includesAny(text, [wordRe("gorro"), wordRe("gorros")]);
  const hasKnitSignal = includesAny(text, [wordRe("tejido"), wordRe("lana"), wordRe("termico"), wordRe("invierno"), wordRe("wool"), wordRe("knit")]);
  if (!hasBucketHat && (hasBeanie || (hasGorro && hasKnitSignal))) {
    return { subcategory: SUB.gorros_beanies, confidence: 0.93, reasons: ["kw:beanie"] };
  }

  const mask = includesAny(text, [wordRe("tapabocas"), wordRe("mascarilla"), wordRe("mascarillas"), wordRe("mask"), wordRe("masks")]);
  if (mask) return { subcategory: SUB.tapabocas_mascarillas, confidence: 0.94, reasons: ["kw:mask"] };

  // Existing subcategories (high precision keywords).
  const pantyMedia = includesAny(text, [
    wordRe("pantimedia"),
    wordRe("pantimedias"),
    phraseRe("media velada"),
    phraseRe("medias veladas"),
    wordRe("tights"),
    wordRe("stocking"),
    wordRe("stockings"),
    wordRe("pantyhose"),
    wordRe("denier"),
    phraseRe("panty media"),
    phraseRe("panty medias"),
  ]);
  if (pantyMedia) return { subcategory: SUB.pantimedias_medias_veladas, confidence: 0.96, reasons: ["kw:tights"] };

  const socks = includesAny(text, [
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("media"),
    wordRe("medias"),
    wordRe("sock"),
    wordRe("socks"),
    wordRe("soquete"),
    wordRe("soquetes"),
    // "tobillera" can be ankle socks too (but jewelry already handled earlier).
    wordRe("tobillera"),
    wordRe("tobilleras"),
  ]);
  if (socks) return { subcategory: SUB.medias_calcetines, confidence: 0.95, reasons: ["kw:socks"] };

  const belt = includesAny(text, [wordRe("cinturon"), wordRe("cinturones"), wordRe("correa"), wordRe("correas"), wordRe("belt"), wordRe("hebilla"), wordRe("hebillas")]);
  if (belt) return { subcategory: SUB.cinturones, confidence: 0.95, reasons: ["kw:belt"] };

  const suspenders = includesAny(text, [wordRe("tirante"), wordRe("tirantes"), wordRe("suspender"), wordRe("suspenders")]);
  if (suspenders) return { subcategory: SUB.tirantes, confidence: 0.96, reasons: ["kw:suspenders"] };

  const bowTie = includesAny(text, [wordRe("pajarita"), wordRe("pajaritas"), wordRe("corbatin"), wordRe("corbatines"), phraseRe("bow tie"), phraseRe("bowtie")]);
  if (bowTie) return { subcategory: SUB.pajaritas_monos, confidence: 0.96, reasons: ["kw:bow_tie"] };

  const tie = includesAny(text, [wordRe("corbata"), wordRe("corbatas"), wordRe("necktie"), phraseRe("neck tie")]);
  if (tie) return { subcategory: SUB.corbatas, confidence: 0.96, reasons: ["kw:tie"] };

  const gloves = includesAny(text, [wordRe("guante"), wordRe("guantes"), wordRe("glove"), wordRe("gloves"), wordRe("miton"), wordRe("mitones"), wordRe("mitten"), wordRe("mittens"), wordRe("manopla"), wordRe("manoplas")]);
  if (gloves) return { subcategory: SUB.guantes, confidence: 0.96, reasons: ["kw:gloves"] };

  const scarf = includesAny(text, [wordRe("bufanda"), wordRe("bufandas"), wordRe("chalina"), wordRe("chalinas"), wordRe("scarf"), phraseRe("cuello termico"), phraseRe("neck gaiter")]);
  if (scarf) return { subcategory: SUB.bufandas, confidence: 0.95, reasons: ["kw:scarf"] };

  const headscarf = includesAny(text, [
    wordRe("panuelo"),
    wordRe("panuelos"),
    wordRe("panoleta"),
    wordRe("panoletas"),
    wordRe("bandana"),
    wordRe("bandanas"),
    phraseRe("head scarf"),
    phraseRe("headscarf"),
    wordRe("turbante"),
    wordRe("turbantes"),
  ]);
  if (headscarf) return { subcategory: SUB.panuelos_bandanas, confidence: 0.93, reasons: ["kw:bandana"] };

  const shawl = includesAny(text, [wordRe("chal"), wordRe("chales"), wordRe("pashmina"), wordRe("pashminas"), wordRe("estola"), wordRe("estolas"), wordRe("stole"), wordRe("stoles"), wordRe("shawl"), wordRe("shawls")]);
  if (shawl) return { subcategory: SUB.chales_pashminas, confidence: 0.94, reasons: ["kw:shawl"] };

  const cap = includesAny(text, [wordRe("gorra"), wordRe("gorras"), wordRe("cap"), wordRe("caps"), wordRe("visera"), wordRe("viseras"), wordRe("snapback"), wordRe("trucker")]);
  if (cap) return { subcategory: SUB.gorras, confidence: 0.93, reasons: ["kw:cap"] };

  const hat = includesAny(text, [wordRe("sombrero"), wordRe("sombreros"), phraseRe("bucket hat"), wordRe("fedora"), wordRe("panama")]);
  if (hat) return { subcategory: SUB.sombreros, confidence: 0.93, reasons: ["kw:hat"] };

  // "moño/mono" ambiguous; treat only with contextual cues.
  const mono = includesAny(text, [wordRe("mono"), wordRe("monos"), wordRe("mono"), wordRe("monos"), wordRe("mono"), wordRe("monos")]);
  if (mono) {
    if (hair) return { subcategory: SUB.accesorios_para_cabello, confidence: 0.8, reasons: ["kw:mono_hair_ctx"] };
    if (tie || bowTie) return { subcategory: SUB.pajaritas_monos, confidence: 0.8, reasons: ["kw:mono_tie_ctx"] };
  }

  return null;
};

const classify = (row) => {
  const title = row.product_name || "";
  const url = row.source_url || "";
  const text = normalizeText(`${title} ${url}`);

  const gift = detectGiftCard(text);
  if (gift) return { ...gift, kind: "move_category" };

  const home = detectHome(text);
  if (home) return { ...home, kind: "move_category" };

  const eyewear = detectEyewear(text);
  if (eyewear) return { ...eyewear, kind: "move_category" };

  const bags = detectBags(text);
  if (bags) return { ...bags, kind: "move_category" };

  const footwear = detectFootwear(text);
  if (footwear) return { ...footwear, kind: "move_category" };

  const swimwear = detectSwimwear(text);
  if (swimwear) return { ...swimwear, kind: "move_category" };

  const jewelry = detectJewelry(text);
  if (jewelry) return { ...jewelry, kind: "move_category" };

  const accessorySub = detectAccessorySubcategory(text);
  if (accessorySub) {
    return {
      category: CAT.accesorios_textiles_y_medias,
      subcategory: accessorySub.subcategory,
      confidence: accessorySub.confidence,
      reasons: accessorySub.reasons,
      kind: "move_subcategory",
    };
  }

  return { category: row.current_category, subcategory: row.current_subcategory, confidence: 0.0, reasons: [], kind: "keep" };
};

const stableSampleKey = (id) => crypto.createHash("md5").update(`${id}:${runKey}`).digest("hex");

const client = new Client({ connectionString: databaseUrl });

await client.connect();

const scriptVersion = `rules_v2_${runKey}`;

try {
  const limitSql = limit ? `limit ${Number(limit)}` : "";
  const res = await client.query(
    `
      select
        p.id::text as product_id,
        p.name as product_name,
        p.category as current_category,
        p.subcategory as current_subcategory,
        p."sourceUrl" as source_url,
        p."updatedAt" as updated_at,
        b.name as brand_name,
        p.metadata as metadata
      from "products" p
      join "brands" b on b.id = p."brandId"
      where p.category = $1
      order by p.id asc
      ${limitSql}
    `,
    [category],
  );

  const rows = res.rows;
  const suggestions = rows.map((row) => {
    const meta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null;
    const enrichment = meta?.enrichment && typeof meta.enrichment === "object" && !Array.isArray(meta.enrichment) ? meta.enrichment : null;
    const promptVersion = enrichment?.prompt_version ?? null;
    const provider = enrichment?.provider ?? null;
    const model = enrichment?.model ?? null;
    const platform = meta?.platform ?? null;

    const suggested = classify(row);

    const nextCategory = suggested.category ?? row.current_category ?? null;
    const nextSubcategory = suggested.subcategory ?? null;
    const kind =
      nextCategory !== row.current_category
        ? "move_category"
        : nextSubcategory !== (row.current_subcategory ?? null)
          ? "move_subcategory"
          : "keep";

    // Confidence gate: never apply low-confidence changes, but still report them.
    const eligible = suggested.confidence >= minConfidence && kind !== "keep";

    return {
      product_id: row.product_id,
      brand_name: row.brand_name,
      product_name: row.product_name,
      source_url: row.source_url || "",
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : "",
      prompt_version: typeof promptVersion === "string" ? promptVersion : "",
      provider: typeof provider === "string" ? provider : provider === null ? "" : String(provider),
      model: typeof model === "string" ? model : model === null ? "" : String(model),
      platform: typeof platform === "string" ? platform : platform === null ? "" : String(platform),
      current_category: row.current_category ?? "",
      current_subcategory: row.current_subcategory ?? "",
      suggested_category: nextCategory ?? "",
      suggested_subcategory: nextSubcategory ?? "",
      change_kind: kind,
      confidence: suggested.confidence,
      eligible: eligible ? "yes" : "no",
      reasons: (suggested.reasons ?? []).join(";"),
      _sample_key: stableSampleKey(row.product_id),
    };
  });

  const changes = suggestions
    .filter((row) => row.change_kind !== "keep")
    .sort((a, b) => (a._sample_key < b._sample_key ? -1 : a._sample_key > b._sample_key ? 1 : 0));

  const eligibleChanges = changes.filter((row) => row.eligible === "yes");

  const agg = {
    category,
    runKey,
    scriptVersion,
    apply,
    minConfidence,
    scanned: suggestions.length,
    changes: changes.length,
    eligibleChanges: eligibleChanges.length,
  };

  const countBy = (items, key) => {
    const map = new Map();
    for (const item of items) {
      const value = item[key] ?? "";
      map.set(value, (map.get(value) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, value: v }))
      .sort((a, b) => b.value - a.value);
  };

  const byKind = countBy(changes, "change_kind");
  const bySuggestedCategory = countBy(eligibleChanges, "suggested_category");
  const bySuggestedSubcategory = countBy(eligibleChanges, "suggested_subcategory");

  const byBrand = new Map();
  for (const row of eligibleChanges) {
    const key = row.brand_name || "(sin marca)";
    byBrand.set(key, (byBrand.get(key) || 0) + 1);
  }
  const topBrands = Array.from(byBrand.entries())
    .map(([k, v]) => ({ key: k, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ...agg, byKind, bySuggestedCategory, bySuggestedSubcategory, topBrands }, null, 2) + "\n", "utf8");

  const headers = [
    "product_id",
    "brand_name",
    "product_name",
    "source_url",
    "updated_at",
    "prompt_version",
    "provider",
    "model",
    "platform",
    "current_category",
    "current_subcategory",
    "suggested_category",
    "suggested_subcategory",
    "change_kind",
    "confidence",
    "eligible",
    "reasons",
  ];

  writeCsv(path.join(outDir, "suggestions.csv"), suggestions.map(({ _sample_key, ...rest }) => rest), headers);
  writeCsv(path.join(outDir, "eligible_changes.csv"), eligibleChanges.map(({ _sample_key, ...rest }) => rest), headers);

  const md = [];
  md.push(`# Reclasificación por reglas: \`${category}\``);
  md.push("");
  md.push(`- Run: \`${runKey}\``);
  md.push(`- Script version: \`${scriptVersion}\``);
  md.push(`- Apply: **${apply ? "YES" : "NO"}**`);
  md.push(`- Min confidence: **${minConfidence}**`);
  md.push(`- Productos escaneados: **${suggestions.length}**`);
  md.push(`- Cambios detectados (cualquier confianza): **${changes.length}**`);
  md.push(`- Cambios elegibles (>= min-confidence): **${eligibleChanges.length}**`);
  md.push("");
  md.push("## Breakdown");
  md.push("");
  md.push("| tipo | count |");
  md.push("|---|---:|");
  for (const row of byKind) md.push(`| \`${row.key}\` | ${row.value} |`);
  md.push("");
  md.push("### Por categoría destino (solo elegibles)");
  md.push("");
  md.push("| categoria | count |");
  md.push("|---|---:|");
  for (const row of bySuggestedCategory.slice(0, 30)) md.push(`| \`${row.key}\` | ${row.value} |`);
  md.push("");
  md.push("### Por subcategoría destino (solo elegibles)");
  md.push("");
  md.push("| subcategoria | count |");
  md.push("|---|---:|");
  for (const row of bySuggestedSubcategory.slice(0, 40)) md.push(`| \`${row.key}\` | ${row.value} |`);
  md.push("");
  md.push("### Top marcas impactadas (solo elegibles)");
  md.push("");
  md.push("| marca | cambios |");
  md.push("|---|---:|");
  for (const row of topBrands) md.push(`| ${toCsv(row.key)} | ${row.value} |`);
  md.push("");
  md.push("## Archivos");
  md.push("");
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "summary.json"))}`);
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "suggestions.csv"))}`);
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "eligible_changes.csv"))}`);
  md.push("");
  fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n") + "\n", "utf8");

  if (!apply) {
    console.log(`Dry-run report written to: ${outDir}`);
    process.exit(0);
  }

  const toUpdate = eligibleChanges.map((row) => ({
    product_id: row.product_id,
    next_category: row.suggested_category,
    next_subcategory: row.suggested_subcategory || "",
    confidence: row.confidence,
    reasons: row.reasons ? row.reasons.split(";").filter(Boolean) : [],
    prev_category: row.current_category || null,
    prev_subcategory: row.current_subcategory || null,
  }));

  const updatedIds = [];
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    const chunk = toUpdate.slice(i, i + chunkSize);
    const ids = chunk.map((row) => row.product_id);
    const cats = chunk.map((row) => row.next_category);
    const subs = chunk.map((row) => row.next_subcategory || "");
    const patches = chunk.map((row) =>
      JSON.stringify({
        reclassification: {
          source: "rules",
          version: scriptVersion,
          appliedAt: now.toISOString(),
          confidence: row.confidence,
          reasons: row.reasons,
          previous: { category: row.prev_category, subcategory: row.prev_subcategory },
          next: { category: row.next_category, subcategory: row.next_subcategory || null },
        },
      }),
    );

    const result = await client.query(
      `
        with u as (
          select
            unnest($1::text[]) as id,
            unnest($2::text[]) as next_category,
            unnest($3::text[]) as next_subcategory,
            unnest($4::text[])::jsonb as patch
        )
        update "products" p
        set
          category = u.next_category,
          subcategory = nullif(u.next_subcategory, ''),
          metadata = coalesce(p.metadata, '{}'::jsonb) || u.patch,
          "updatedAt" = now()
        from u
        where p.id = u.id
        returning p.id::text as id
      `,
      [ids, cats, subs, patches],
    );
    for (const row of result.rows) updatedIds.push(row.id);
  }

  const postCounts = await client.query(
    `
      select category, count(*)::int as cnt
      from "products"
      where category in ($1,$2,$3,$4,$5,$6,$7,$8)
      group by category
      order by cnt desc
    `,
    [
      CAT.accesorios_textiles_y_medias,
      CAT.joyeria_y_bisuteria,
      CAT.calzado,
      CAT.bolsos_y_marroquineria,
      CAT.gafas_y_optica,
      CAT.tarjeta_regalo,
      CAT.hogar_y_lifestyle,
      CAT.trajes_de_bano_y_playa,
    ],
  );

  const applySummary = {
    ...agg,
    updatedCount: updatedIds.length,
    updatedSample: updatedIds.slice(0, 25),
    postCategoryCounts: postCounts.rows,
  };
  fs.writeFileSync(path.join(outDir, "apply_summary.json"), JSON.stringify(applySummary, null, 2) + "\n", "utf8");

  console.log(`Applied ${updatedIds.length} updates. Report: ${outDir}`);
} finally {
  await client.end();
}
