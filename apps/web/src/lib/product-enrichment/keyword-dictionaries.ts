import { CATEGORY_OPTIONS } from "@/lib/product-enrichment/constants";
import { slugify } from "@/lib/product-enrichment/utils";

export type KeywordRule = {
  key: string;
  keywords: string[];
};

export type CategoryKeywordRule = {
  category: string;
  subcategory?: string;
  productType?: string;
  keywords: string[];
};

export type SubcategoryKeywordRule = {
  category: string;
  subcategory: string;
  productType?: string;
  keywords: string[];
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "o",
  "con",
  "sin",
  "para",
  "por",
  "en",
  "tipo",
  "otros",
  "otras",
  "otro",
  "otra",
  "como",
  "una",
  "uno",
  "unos",
  "unas",
  "al",
]);

const GENERIC_CATEGORY_TERMS = new Set([
  "casual",
  "formal",
  "clasico",
  "clasica",
  "moderno",
  "moderna",
  "largo",
  "larga",
  "corto",
  "corta",
  "alto",
  "alta",
  "bajo",
  "baja",
  "diario",
  "diaria",
]);

const WORD_SYNONYMS: Record<string, string[]> = {
  camiseta: ["tshirt", "t shirt", "tee", "franela"],
  top: ["bluson", "croptop", "crop top", "tank top"],
  bodysuit: ["body", "body suit"],
  polo: ["polo shirt", "camisa polo", "pique", "piqué"],
  camisa: ["shirt", "button down"],
  blusa: ["blouse"],
  guayabera: ["shirt cubana", "camisa cubana"],
  buzo: ["sudadera", "sweatshirt", "crewneck"],
  hoodie: ["canguro", "capotero", "sweatshirt con capucha"],
  sueter: ["sweater", "jersey", "pulover", "pullover"],
  cardigan: ["cárdigan", "chaqueta tejida"],
  chaleco: ["vest"],
  chaqueta: ["jacket"],
  abrigo: ["coat"],
  blazer: ["americana", "saco blazer"],
  sastreria: ["tailoring", "tailored"],
  pantalon: ["pants", "trousers", "trouser"],
  lino: ["linen"],
  jean: ["jeans", "denim"],
  shorts: ["short", "bermuda"],
  falda: ["skirt"],
  vestido: ["dress"],
  enterizo: ["jumpsuit"],
  overol: ["overall", "dungaree"],
  conjunto: ["set", "matching set", "co ord", "co-ord", "dos piezas"],
  deportiva: ["athleisure", "activewear", "sportswear"],
  interior: ["underwear", "intimate"],
  lenceria: ["lingerie"],
  faja: ["shapewear", "moldeador", "controlwear"],
  pijama: ["sleepwear", "nightwear"],
  descanso: ["loungewear", "homewear"],
  bano: ["swimwear", "beachwear"],
  tanga: ["thong", "g string", "g-string", "gstring", "hilo", "hilo dental"],
  bebe: ["baby", "newborn", "infante"],
  uniforme: ["uniform", "dotacion"],
  trabajo: ["workwear", "industrial"],
  escolar: ["school uniform"],
  medias: ["calcetines", "socks"],
  cinturones: ["belt", "belts"],
  gorras: ["caps", "baseball cap"],
  sombreros: ["hat", "hats"],
  bufandas: ["scarf", "scarves"],
  guantes: ["gloves"],
  panuelos: ["pañuelos", "bandana", "kerchief"],
  corbatas: ["tie", "ties"],
  pajaritas: ["bow tie", "bowtie", "corbatin"],
  tirantes: ["suspenders"],
  pashminas: ["shawl", "shawls", "stole"],
  tapabocas: ["mascarilla", "mask", "face mask"],
  calzado: ["footwear"],
  botas: ["boot", "boots"],
  botines: ["ankle boot", "ankle boots"],
  tenis: ["sneaker", "sneakers", "zapatillas", "zapatilla"],
  zapatos: ["shoe", "shoes"],
  sandalias: ["sandals", "sandalia"],
  tacones: ["heels", "heel", "stiletto"],
  mocasines: ["loafer", "loafers", "mocasin"],
  balerinas: ["flats", "flat", "ballerina flats"],
  alpargatas: ["espadrille", "espadrilles"],
  zuecos: ["clog", "clogs"],
  chanclas: ["flip flop", "flip flops", "sandalia de playa"],
  bolsos: ["bag", "bags", "handbag"],
  cartera: ["purse", "bolso de mano"],
  tote: ["shopper", "bolso tote"],
  bandolera: ["crossbody", "bolso cruzado"],
  mochila: ["backpack"],
  morral: ["backpack", "rucksack"],
  rinonera: ["riñonera", "fanny pack", "waist bag", "belt bag"],
  clutch: ["sobre", "evening bag"],
  estuches: ["pouch", "case", "cosmetiquera", "neceser", "portalapicero", "porta lapicero", "porta lapices", "porta lapiz"],
  loncheras: ["lunch bag", "lunchbox"],
  billetera: ["wallet"],
  llaveros: ["keychain", "key ring"],
  portadocumentos: ["document holder", "passport holder", "porta pasaporte"],
  duffel: ["bolso de viaje", "gym bag"],
  equipaje: ["luggage", "suitcase", "maleta", "trolley"],
  gafas: ["lentes", "eyewear", "glasses"],
  monturas: ["frames", "eyeglass frame"],
  goggles: ["gafas deportivas", "antiparras"],
  joyeria: ["jewelry", "bisuteria", "bisutería", "joyas"],
  aretes: ["pendientes", "earring", "earrings", "topos", "argollas", "ear cuff", "ear cuffs", "earcuff"],
  collares: ["necklace", "necklaces", "cadena", "gargantilla"],
  pulseras: ["bracelet", "bracelets", "bangle", "bangles", "brazalete"],
  anillos: ["ring", "rings"],
  tobilleras: ["anklet", "anklets"],
  dijes: ["charm", "charms", "pendant", "pendants"],
  broches: ["brooch", "brooches", "prendedor"],
  piercings: ["barbell", "stud", "septum"],
  relojes: ["watch", "watches"],
  regalo: ["gift card", "voucher", "bono", "tarjeta de regalo"],
  hogar: ["home", "decor", "deco", "mascota", "mascotas", "perro", "perros", "gato", "gatos", "pet", "pets"],
  mesa: ["table linen", "mantel", "servilleta"],
  cocina: ["kitchenware", "vajilla", "tableware", "utensilios", "botella", "botilito", "bottle", "water bottle", "termo", "cantimplora"],
  cojines: ["cushion", "cushions", "funda de cojin"],
  velas: ["candle", "candles", "aroma", "difusor", "incienso"],
  belleza: ["beauty", "perfume", "body splash", "fragancia"],
  arte: ["poster", "print", "wall art"],
  papeleria: ["stationery", "agenda", "cuaderno", "journal", "libro"],
  toallas: ["towel", "towels", "bath towel"],
  mantas: ["blanket", "throw", "cobija"],
};

const PHRASE_SYNONYMS: Record<string, string[]> = {
  "camisilla esqueleto sin mangas": ["tank top", "muscle tee", "camiseta sin mangas"],
  "top basico strap top tiras": ["strappy top", "top de tiras", "spaghetti strap top"],
  "body bodysuit": ["bodysuit", "body", "leotardo"],
  "hoodie canguro": ["hoodie", "canguro", "sudadera con capucha"],
  "hoodie con cremallera": ["zip hoodie", "hoodie zip", "sudadera con cierre"],
  "crop top": ["crop tee", "cropped tee", "cropped t shirt", "cropped t-shirt", "cropped tee shirt"],
  "buzo cuello alto half zip": ["half zip", "quarter zip", "sweater cuello alto"],
  "chaqueta tipo cuero cuero o sintetico": ["chaqueta de cuero", "chaqueta leather", "biker jacket"],
  "puffer acolchada": ["puffer", "chaqueta acolchada", "plumifero"],
  "trench gabardina": ["gabardina", "trench coat"],
  "traje sastre conjunto blazer pantalon falda": ["traje sastre", "tailored suit", "power suit"],
  "leggings casual": ["legging casual", "legging diario"],
  "jean distressed rotos": ["jean roto", "ripped jeans", "distressed denim"],
  "biker short": ["short ciclista", "cycling short"],
  "falda short skort": ["skort", "falda pantalón", "falda pantalon"],
  "vestido formal noche": ["vestido de gala", "evening dress"],
  "romper jumpsuit corto": ["romper", "enterizo corto"],
  "set bebe 2 3 piezas": ["conjunto bebe", "set bebé", "baby set"],
  "top deportivo bra deportivo": ["sports bra", "bra deportivo", "top fitness"],
  "sudadera pants deportivos": ["jogger deportivo", "pants deportivos", "sudadera deportiva"],
  "ropa de compresion": ["compresion", "compression wear"],
  "ropa de ciclismo": ["ciclismo", "cycling jersey", "cycling bib"],
  "panty trusa": ["panty", "trusa", "calzon", "calzón"],
  "boxer largo long leg": ["long leg boxer", "boxer largo"],
  "body lencero": ["body de encaje", "body sensual"],
  "medias lenceria panty lenceria": [
    "medias de encaje",
    "pantimedia sexy",
    "pantyhose",
    "hosiery",
    "stocking",
    "stockings",
    "tights",
  ],
  "faja cuerpo completo": ["body shaper", "faja completa", "full body shapewear"],
  "camiseta torso moldeador": ["camiseta moldeadora", "torso shaper"],
  "pijama enteriza onesie": ["onesie", "mameluco pijama"],
  "set loungewear jogger buzo": ["set loungewear", "conjunto homewear"],
  "vestido de bano entero": ["traje de baño entero", "one piece", "one-piece swimsuit"],
  "bermuda boxer de bano": ["boardshort", "trunk de baño", "short de baño hombre"],
  "salida de bano kaftan": [
    "kaftan",
    "cover up",
    "coverup",
    "beach cover up",
    "cobertor",
    "cobertor de playa",
    "cobertor playa",
    "salida de playa",
  ],
  "panal de agua bebe": ["pañal de agua", "swim diaper"],
  "uniforme medico scrubs": ["scrubs", "uniforme medico", "uniforme médico"],
  "ropa reflectiva alta visibilidad": ["alta visibilidad", "hi vis", "reflectiva"],
  "pantimedias medias veladas": ["pantimedia", "media velada", "pantyhose"],
  "pajaritas monos": ["bow tie", "corbatin", "corbatín"],
  "gorros beanies": ["beanie", "gorro tejido"],
  "tenis sneakers": ["sneaker", "zapatilla"],
  "zapatos formales": ["oxford", "derby", "zapato vestir"],
  "mocasines loafers": ["loafer", "mocasin", "mocasín"],
  "balerinas flats": ["flats", "bailarina", "manoletina"],
  "alpargatas espadrilles": ["espadrille", "alpargata"],
  "chanclas flip flops": ["flip flop", "sandalia plana"],
  "bolso bandolera crossbody": ["crossbody", "bolso cruzado", "bandolera"],
  "rinonera canguro": ["riñonera", "canguro", "waist bag", "belt bag"],
  "clutch sobre": ["clutch", "sobre de mano"],
  "estuches cartucheras neceseres": ["cartuchera", "neceser", "cosmetiquera", "pouch"],
  "portadocumentos porta pasaporte": ["porta pasaporte", "passport holder", "document holder"],
  "maletas y equipaje": ["equipaje", "maleta", "trolley", "suitcase"],
  "gafas opticas formuladas": ["gafas formuladas", "gafas de formula", "eyeglasses"],
  "gafas de sol": ["sunglasses", "lentes de sol"],
  "dijes charms": ["charm", "dije", "colgante"],
  "broches prendedores": ["broche", "prendedor", "pin"],
  "sets de joyeria": ["set de joyas", "jewelry set"],
  "gift card": ["tarjeta de regalo", "voucher", "bono"],
  "textiles de mesa": ["mantel", "camino de mesa", "individual", "posavasos"],
  "cocina y vajilla": ["vajilla", "tableware", "utensilios cocina", "cristaleria"],
  "cuidado personal y belleza": ["perfume", "body splash", "fragancia", "cuidado personal"],
  "arte y posters": ["poster", "print", "lamina decorativa"],
  "papeleria y libros": ["agenda", "cuaderno", "journal", "libro", "tarot"],
  "toallas y bano": ["toalla", "bath towel", "toalla de baño"],
  "mantas y cobijas": ["manta", "cobija", "blanket", "throw"],
};

const CATEGORY_ANCHOR_KEYWORDS: Record<string, string[]> = {
  camisetas_y_tops: [
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
    "body",
    "bodysuit",
    "polo",
    "henley",
  ],
  camisas_y_blusas: [
    "camisa",
    "shirt",
    "blusa",
    "blouse",
    "guayabera",
    "button down",
    "tunica",
    "tunica blusa",
    "off shoulder blouse",
  ],
  buzos_hoodies_y_sueteres: [
    "buzo",
    "sudadera",
    "hoodie",
    "canguro",
    "sweatshirt",
    "sueter",
    "sweater",
    "jersey",
    "cardigan",
    "pulover",
    "chaleco tejido",
    "ruana",
    "poncho",
  ],
  chaquetas_y_abrigos: [
    "chaqueta",
    "jacket",
    "abrigo",
    "coat",
    "parka",
    "bomber",
    "rompevientos",
    "windbreaker",
    "impermeable",
    "puffer",
    "acolchada",
    "gabardina",
    "trench",
    "chaleco acolchado",
  ],
  blazers_y_sastreria: [
    "blazer",
    "sastreria",
    "tailored",
    "americana",
    "saco de vestir",
    "smoking",
    "tuxedo",
    "traje sastre",
    "chaleco de vestir",
    "pantalon sastre",
    "falda sastre",
  ],
  pantalones_no_denim: [
    "pantalon",
    "pants",
    "trouser",
    "jogger",
    "palazzo",
    "culotte",
    "cargo",
    "chino",
    "dril",
    "sarga",
    "legging casual",
    "flare pant",
  ],
  jeans_y_denim: [
    "jean",
    "jeans",
    "denim",
    "mom jean",
    "boyfriend jean",
    "bootcut",
    "wide leg jean",
    "ripped jean",
  ],
  shorts_y_bermudas: [
    "short",
    "shorts",
    "bermuda",
    "jort",
    "jorts",
    "biker short",
    "short cargo",
    "short deportivo",
  ],
  faldas: [
    "falda",
    "skirt",
    "mini falda",
    "falda midi",
    "falda maxi",
    "falda lapiz",
    "falda plisada",
    "skort",
  ],
  vestidos: [
    "vestido",
    "dress",
    "vestido casual",
    "vestido de fiesta",
    "vestido coctel",
    "vestido formal",
    "vestido maxi",
    "vestido midi",
    "vestido mini",
  ],
  enterizos_y_overoles: [
    "enterizo",
    "jumpsuit",
    "romper",
    "overol",
    "overall",
    "jardinera",
  ],
  conjuntos_y_sets_2_piezas: [
    "conjunto",
    "set",
    "matching set",
    "co ord",
    "dos piezas",
    "2 piezas",
    "set formal",
    "set deportivo",
    "set pijama",
  ],
  ropa_deportiva_y_performance: [
    "deportivo",
    "deportiva",
    "activewear",
    "athleisure",
    "sportswear",
    "gym",
    "running",
    "ciclismo",
    "compresion",
    "training",
    "futbol",
    "entrenamiento",
  ],
  ropa_interior_basica: [
    "ropa interior",
    "interior",
    "brasier",
    "bralette",
    "panty",
    "trusa",
    "tanga",
    "brasilera",
    "boxer",
    "brief",
    "camisilla interior",
  ],
  lenceria_y_fajas_shapewear: [
    "lenceria",
    "lingerie",
    "body lencero",
    "corset",
    "corse",
    "babydoll",
    "liguero",
    "faja",
    "shapewear",
    "moldeador",
    "torso moldeador",
  ],
  pijamas_y_ropa_de_descanso_loungewear: [
    "pijama",
    "sleepwear",
    "loungewear",
    "camison",
    "bata",
    "robe",
    "onesie",
    "homewear",
    "ropa de descanso",
  ],
  trajes_de_bano_y_playa: [
    "bikini",
    "trikini",
    "tankini",
    "traje de bano",
    "vestido de bano",
    "banador",
    "swimwear",
    "rashguard",
    "licra uv",
    "pareo",
    "salida de bano",
    "cobertor",
    "cobertor de playa",
    "cobertor playa",
    "cover up",
    "coverup",
    "beachwear",
    "pantaloneta",
    "pantaloneta de bano",
    "pantaloneta de baño",
    "short de bano",
    "short de baño",
    "swim trunk",
    "swim trunks",
    "boardshort",
    "boardshorts",
  ],
  ropa_de_bebe_0_24_meses: [
    "ropa bebe",
    "bebe",
    "body bebe",
    "pelele",
    "mameluco",
    "pijama bebe",
    "newborn",
    "0 24 meses",
    "babywear",
    "conjunto bebe",
  ],
  uniformes_y_ropa_de_trabajo_escolar: [
    "uniforme",
    "uniforme escolar",
    "uniforme medico",
    "scrubs",
    "dotacion",
    "ropa de trabajo",
    "overol de trabajo",
    "bata",
    "delantal",
    "alta visibilidad",
    "reflectiva",
  ],
  accesorios_textiles_y_medias: [
    "medias",
    "calcetines",
    "pantimedia",
    "cinturon",
    "gorra",
    "sombrero",
    "bufanda",
    "guante",
    "bandana",
    "panuelo",
    "corbata",
    "pajarita",
    "tirantes",
    "pashmina",
    "diadema",
    "balaca",
    "scrunchie",
    "beanie",
    "tapabocas",
    "mascarilla",
  ],
  calzado: [
    "calzado",
    "footwear",
    "zapato",
    "zapatos",
    "tenis",
    "sneaker",
    "sandalia",
    "tacon",
    "tacones",
    "bota",
    "botas",
    "botin",
    "mocasin",
    "loafer",
    "alpargata",
    "espadrille",
    "zueco",
    "chancla",
    "flip flop",
    "glider",
    "gliders",
  ],
  bolsos_y_marroquineria: [
    "bolso",
    "bolsos",
    "cartera",
    "mochila",
    "morral",
    "rinonera",
    "riñonera",
    "crossbody",
    "bandolera",
    "clutch",
    "estuche",
    "cartuchera",
    "neceser",
    "cosmetiquera",
    "portalapicero",
    "porta lapicero",
    "porta lapices",
    "porta lapiz",
    "lonchera",
    "billetera",
    "portadocumentos",
    "duffel",
    "maleta",
    "equipaje",
  ],
  gafas_y_optica: [
    "gafas",
    "lentes",
    "montura",
    "eyewear",
    "sunglasses",
    "goggles",
    "lentes de proteccion",
    "gafas formuladas",
  ],
  joyeria_y_bisuteria: [
    "joyeria",
    "bisuteria",
    "arete",
    "aretes",
    "pendiente",
    "argolla",
    "collar",
    "cadena",
    "pulsera",
    "brazalete",
    "bracelet",
    "bangle",
    "bangles",
    "anillo",
    "tobillera",
    "dije",
    "charm",
    "llavero",
    "llaveros",
    "keychain",
    "keychains",
    "key ring",
    "keyring",
    "broche",
    "prendedor",
    "piercing",
    "ear cuff",
    "reloj",
    "watch",
    "necklace",
    "choker",
  ],
  tarjeta_regalo: [
    "gift card",
    "giftcard",
    "tarjeta regalo",
    "tarjeta de regalo",
    "bono",
    "voucher",
    "certificado regalo",
  ],
  hogar_y_lifestyle: [
    "hogar",
    "lifestyle",
    "decoracion",
    "deco",
    "textiles de mesa",
    "vajilla",
    "cocina",
    "botella",
    "botilito",
    "termo",
    "cantimplora",
    "bottle",
    "water bottle",
    "cojin",
    "funda",
    "vela",
    "difusor",
    "aroma",
    "perfume",
    "body splash",
    "poster",
    "arte",
    "papeleria",
    "agenda",
    "cuaderno",
    "betun",
    "betún",
    "grasa para cuero",
    "grasa fina para cuero",
    "limpiador para cuero",
    "cuidado del cuero",
    "leather cleaner",
    "leather care",
    "shoe care",
    "toalla",
    "manta",
    "cobija",
    "mascota",
    "mascotas",
    "perro",
    "perros",
    "gato",
    "gatos",
    "pet",
    "pets",
  ],
};

const CATEGORY_PRODUCT_TYPE: Record<string, string> = {
  camisetas_y_tops: "top",
  camisas_y_blusas: "camisa",
  buzos_hoodies_y_sueteres: "buzo",
  chaquetas_y_abrigos: "chaqueta",
  blazers_y_sastreria: "blazer",
  pantalones_no_denim: "pantalon",
  jeans_y_denim: "jeans",
  shorts_y_bermudas: "short",
  faldas: "falda",
  vestidos: "vestido",
  enterizos_y_overoles: "enterizo",
  conjuntos_y_sets_2_piezas: "conjunto",
  ropa_deportiva_y_performance: "ropa deportiva",
  ropa_interior_basica: "ropa interior",
  lenceria_y_fajas_shapewear: "lenceria",
  pijamas_y_ropa_de_descanso_loungewear: "pijama",
  trajes_de_bano_y_playa: "traje de bano",
  ropa_de_bebe_0_24_meses: "ropa bebe",
  uniformes_y_ropa_de_trabajo_escolar: "uniforme",
  accesorios_textiles_y_medias: "accesorio textil",
  calzado: "calzado",
  bolsos_y_marroquineria: "bolso",
  gafas_y_optica: "gafas",
  joyeria_y_bisuteria: "joyeria",
  tarjeta_regalo: "gift card",
  hogar_y_lifestyle: "hogar",
};

const dedupeKeywords = (values: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const cleaned = normalizeText(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    output.push(cleaned);
  });
  return output;
};

const buildKeywordsFromLabel = (label: string) => {
  const normalizedLabel = normalizeText(label);
  const rawTokens = normalizedLabel.split(" ").filter(Boolean);

  const tokens = rawTokens.filter(
    (token) => token.length >= 3 && !STOPWORDS.has(token),
  );

  const phrases: string[] = [normalizedLabel];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  for (let i = 0; i < tokens.length - 2; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  const phraseSynonyms = phrases.flatMap((phrase) => PHRASE_SYNONYMS[phrase] ?? []);
  const tokenSynonyms = tokens.flatMap((token) => WORD_SYNONYMS[token] ?? []);

  return dedupeKeywords([...phrases, ...tokens, ...phraseSynonyms, ...tokenSynonyms]);
};

const inferProductTypeFromSubcategory = (label: string, fallback: string) => {
  const tokens = normalizeText(label)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return tokens[0] ?? fallback;
};

const deriveSubcategoryKeywords = (
  categoryValue: string,
  subcategoryValue: string,
  subcategoryLabel: string,
) => {
  const keywords: string[] = [];

  if (categoryValue === "joyeria_y_bisuteria") {
    keywords.push("chapado", "banado", "bañado", "gold plated", "silver plated");
    if (subcategoryValue.includes("aretes") || subcategoryValue.includes("pendientes")) {
      keywords.push(
        "arete",
        "aretes",
        "pendiente",
        "pendientes",
        "earring",
        "earrings",
        "stud",
        "hoop earring",
        "huggie",
      );
    }
    if (subcategoryValue.includes("collares")) {
      keywords.push(
        "collar",
        "collares",
        "cadena",
        "cadenas",
        "necklace",
        "chain",
        "choker",
        "gargantilla",
      );
    }
    if (subcategoryValue.includes("pulseras") || subcategoryValue.includes("brazaletes")) {
      keywords.push(
        "pulsera",
        "pulseras",
        "brazalete",
        "brazaletes",
        "bracelet",
        "bangle",
        "bangles",
      );
    }
    if (subcategoryValue.includes("dijes") || subcategoryValue.includes("charms")) {
      keywords.push(
        "dije",
        "dijes",
        "charm",
        "charms",
        "llavero",
        "llaveros",
        "keychain",
        "keychains",
        "key ring",
        "keyring",
        "colgante",
        "pendant",
        "x1",
        "x2",
        "x3",
      );
    }
    if (subcategoryValue.includes("anillos")) {
      keywords.push("anillo", "anillos", "ring", "rings");
    }
    if (subcategoryValue.includes("tobilleras")) {
      keywords.push("tobillera", "tobilleras", "anklet", "anklets");
    }
    if (subcategoryValue.includes("broches") || subcategoryValue.includes("prendedores")) {
      keywords.push("broche", "broches", "prendedor", "prendedores", "pin");
    }
    if (subcategoryValue.includes("relojes")) {
      keywords.push("reloj", "relojes", "watch", "watches");
    }
    if (subcategoryValue.includes("piercing")) {
      keywords.push("septum", "barbell", "labret", "helix");
    }
  }

  if (categoryValue === "calzado") {
    keywords.push("suela", "plantilla", "horma", "calce", "shoelace", "cordones");
    if (subcategoryValue.includes("tenis") || subcategoryValue.includes("sneakers")) {
      keywords.push("running shoe", "trainer", "court sneaker", "glider", "gliders");
    }
    if (subcategoryValue.includes("mocasines") || subcategoryValue.includes("loafers")) {
      keywords.push("loafer", "penny loafer", "driver");
    }
    if (subcategoryValue.includes("botines")) {
      keywords.push("ankle boot", "chelsea boot");
    }
  }

  if (categoryValue === "buzos_hoodies_y_sueteres") {
    if (subcategoryValue === "hoodie_con_cremallera") {
      keywords.push("cierre", "con cierre", "zip", "zipper", "cremallera");
    }
    if (subcategoryValue === "buzo_cuello_alto_half_zip") {
      keywords.push("half zip", "quarter zip", "zip", "cierre", "cremallera");
    }
    if (subcategoryValue === "buzo_cuello_redondo") {
      keywords.push("cuello redondo", "crewneck");
    }
  }

  if (categoryValue === "bolsos_y_marroquineria") {
    keywords.push("strap", "correa", "compartimento", "zipper", "cierre", "asa");
    if (subcategoryValue.includes("bandolera") || subcategoryValue.includes("crossbody")) {
      keywords.push("crossbody", "cross body", "bolso cruzado");
    }
    if (subcategoryValue.includes("estuches") || subcategoryValue.includes("cartucheras")) {
      keywords.push(
        "pouch",
        "organizer",
        "organizador",
        "portalapicero",
        "porta lapicero",
        "porta lapices",
        "porta lapiz",
      );
    }
  }

  if (categoryValue === "shorts_y_bermudas") {
    if (subcategoryValue.includes("short_denim")) {
      keywords.push("jort", "jorts");
    }
    if (subcategoryValue.includes("biker_short")) {
      keywords.push("biker", "ciclista");
    }
  }

  if (categoryValue === "ropa_deportiva_y_performance") {
    keywords.push("dry fit", "quick dry", "transpirable", "breathable", "compresion");
  }

  if (categoryValue === "trajes_de_bano_y_playa") {
    keywords.push("uv", "sun protection", "beach", "pool", "piscina");
  }

  if (categoryValue === "uniformes_y_ropa_de_trabajo_escolar") {
    keywords.push("colegio", "dotacion", "dotación", "industrial", "corporativo", "scrubs");
  }

  if (categoryValue === "hogar_y_lifestyle") {
    keywords.push("decor", "deco", "hogar", "home");
    if (subcategoryValue.includes("hogar_otros")) {
      keywords.push(
        "mascota",
        "mascotas",
        "perro",
        "perros",
        "gato",
        "gatos",
        "pet",
        "pets",
        "betun",
        "betún",
        "grasa para cuero",
        "grasa fina para cuero",
        "limpiador para cuero",
        "cuidado del cuero",
        "leather cleaner",
        "leather care",
        "shoe care",
      );
    }
  }

  if (categoryValue === "accesorios_textiles_y_medias" && subcategoryValue.includes("accesorios_para_cabello")) {
    keywords.push("scrunchie", "balaca", "diadema", "pinza", "pasador");
  }

  keywords.push(...buildKeywordsFromLabel(subcategoryLabel));
  return dedupeKeywords(keywords);
};

export const CATEGORY_KEYWORD_RULES: CategoryKeywordRule[] = CATEGORY_OPTIONS.map((entry) => {
  const anchors = CATEGORY_ANCHOR_KEYWORDS[entry.value] ?? [];
  const labelKeywords = buildKeywordsFromLabel(entry.label).filter(
    (keyword) => !GENERIC_CATEGORY_TERMS.has(keyword),
  );
  const keywords = dedupeKeywords([...anchors, ...labelKeywords]);
  return {
    category: entry.value,
    productType: CATEGORY_PRODUCT_TYPE[entry.value],
    keywords,
  };
});

export const SUBCATEGORY_KEYWORD_RULES: SubcategoryKeywordRule[] = CATEGORY_OPTIONS.flatMap((categoryEntry) =>
  categoryEntry.subcategories.map((subcategoryEntry) => ({
    category: categoryEntry.value,
    subcategory: subcategoryEntry.value,
    productType: inferProductTypeFromSubcategory(
      subcategoryEntry.label,
      CATEGORY_PRODUCT_TYPE[categoryEntry.value] ?? slugify(categoryEntry.label),
    ),
    keywords: deriveSubcategoryKeywords(
      categoryEntry.value,
      subcategoryEntry.value,
      subcategoryEntry.label,
    ),
  })),
).filter((rule) => rule.keywords.length > 0);

export const MATERIAL_KEYWORD_RULES: KeywordRule[] = [
  { key: "algodon", keywords: ["algodon", "algodón", "cotton"] },
  { key: "algodon_pima", keywords: ["algodon pima", "algodón pima", "pima cotton"] },
  { key: "lino", keywords: ["lino", "linen"] },
  { key: "denim_algodon_indigo", keywords: ["denim", "jean", "jeans", "indigo"] },
  { key: "dril_sarga_twill", keywords: ["dril", "sarga", "twill"] },
  { key: "poliester", keywords: ["poliester", "poliéster", "polyester"] },
  { key: "nylon_poliamida", keywords: ["nylon", "poliamida", "polyamide"] },
  { key: "elastano_spandex_lycra", keywords: ["elastano", "elastane", "spandex", "lycra"] },
  { key: "viscosa_rayon", keywords: ["viscosa", "viscose", "rayon"] },
  { key: "modal", keywords: ["modal"] },
  { key: "bambu_viscosa_de_bambu", keywords: ["bambu", "bambu", "viscosa de bambu"] },
  { key: "lana", keywords: ["lana", "wool"] },
  {
    key: "acrilico_tejido_sintetico_tipo_lana",
    keywords: ["acrilico", "acrílico", "acrylic"],
  },
  { key: "cachemira", keywords: ["cachemira", "cashmere"] },
  { key: "seda", keywords: ["seda", "silk"] },
  { key: "saten_como_tejido_acabado", keywords: ["saten", "satén", "satin"] },
  { key: "gasa_chiffon", keywords: ["gasa", "chiffon"] },
  { key: "tul", keywords: ["tul", "tulle"] },
  { key: "cuero_natural", keywords: ["cuero", "leather", "piel"] },
  { key: "cuero_sintetico_pu", keywords: ["cuero sintetico", "cuero sintético", "pu", "polipiel", "vegan leather"] },
  { key: "oro", keywords: ["oro", "gold", "quilates", "18k", "14k", "10k"] },
  { key: "plata", keywords: ["plata", "silver", "925", "sterling"] },
  { key: "bronce", keywords: ["bronce", "bronze"] },
  { key: "cobre", keywords: ["cobre", "copper"] },
  { key: "otro", keywords: ["resina", "acrilico", "acrílico", "aleacion", "aleación"] },
];

export const PATTERN_KEYWORD_RULES: KeywordRule[] = [
  {
    key: "liso_solido_sin_estampado",
    keywords: ["liso", "solido", "sólido", "plain", "solid", "sin estampado"],
  },
  { key: "rayas_horizontales", keywords: ["raya horizontal", "rayas horizontales", "horizontal stripe"] },
  { key: "rayas_verticales", keywords: ["raya vertical", "rayas verticales", "vertical stripe"] },
  { key: "cuadros_plaid_tartan", keywords: ["cuadros", "plaid", "tartan"] },
  { key: "principe_de_gales", keywords: ["principe de gales", "príncipe de gales", "prince of wales"] },
  { key: "pata_de_gallo_houndstooth", keywords: ["pata de gallo", "houndstooth"] },
  { key: "polka_dots_lunares", keywords: ["lunares", "polka dot", "polka dots"] },
  { key: "animal_print_leopardo_cebra_etc", keywords: ["animal print", "leopardo", "cebra", "tigre", "snake print"] },
  { key: "floral", keywords: ["floral", "flores", "flower print"] },
  { key: "tropical_hawaiano", keywords: ["tropical", "hawaiano", "hawaiian"] },
  { key: "camuflado_camo", keywords: ["camuflado", "camo", "camouflage"] },
  { key: "tie_dye", keywords: ["tie dye", "tie-dye"] },
  { key: "degradado_ombre", keywords: ["degradado", "ombre", "ombré"] },
  { key: "geometrico", keywords: ["geometrico", "geométrico", "geometric"] },
  { key: "abstracto", keywords: ["abstracto", "abstract"] },
  { key: "paisley_cachemira", keywords: ["paisley", "cachemira"] },
  { key: "etnico_tribal", keywords: ["etnico", "étnico", "tribal"] },
  { key: "letras_tipografico", keywords: ["tipografico", "tipográfico", "lettering", "texto"] },
  {
    key: "ilustraciones_graficos_graphic_print",
    keywords: ["graphic print", "ilustracion", "ilustración", "grafico", "gráfico"],
  },
  { key: "bordado_como_patron_visible", keywords: ["bordado", "embroidered", "embroidery"] },
];

export const GENDER_KEYWORD_RULES: KeywordRule[] = [
  { key: "femenino", keywords: ["mujer", "women", "womens", "dama", "ladies", "femenino"] },
  { key: "masculino", keywords: ["hombre", "men", "mens", "caballero", "masculino"] },
  {
    key: "infantil",
    keywords: [
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
    ],
  },
  { key: "no_binario_unisex", keywords: ["unisex", "genderless"] },
];

export const hasKeyword = (text: string, keyword: string) => {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedText || !normalizedKeyword) return false;

  if (normalizedKeyword.includes(" ")) {
    const phrasePattern = normalizedKeyword
      .split(" ")
      .map((chunk) => escapeRegExp(chunk))
      .join("\\s+");
    const phraseRegex = new RegExp(`(^|\\s)${phrasePattern}(?=\\s|$)`);
    return phraseRegex.test(normalizedText);
  }

  const regex = new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}(?=\\s|$)`);
  return regex.test(normalizedText);
};

export const hasAnyKeyword = (text: string, keywords: string[]) =>
  keywords.some((keyword) => hasKeyword(text, keyword));

export const scoreKeywordHits = (text: string, keywords: string[]) => {
  const unique = dedupeKeywords(keywords);
  let score = 0;
  unique.forEach((keyword) => {
    if (!hasKeyword(text, keyword)) return;
    score += keyword.includes(" ") ? 2 : 1;
  });
  return score;
};
