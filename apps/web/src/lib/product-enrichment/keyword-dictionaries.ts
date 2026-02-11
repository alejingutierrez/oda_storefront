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

export const CATEGORY_KEYWORD_RULES: CategoryKeywordRule[] = [
  {
    category: "joyeria_y_bisuteria",
    subcategory: "aretes_pendientes",
    productType: "aretes",
    keywords: ["arete", "aretes", "pendiente", "pendientes", "argolla", "argollas", "topo", "topos"],
  },
  {
    category: "joyeria_y_bisuteria",
    subcategory: "anillos",
    productType: "anillo",
    keywords: ["anillo", "anillos", "ring", "rings"],
  },
  {
    category: "joyeria_y_bisuteria",
    subcategory: "collares",
    productType: "collar",
    keywords: ["collar", "collares", "cadena", "cadenas", "gargantilla"],
  },
  {
    category: "joyeria_y_bisuteria",
    subcategory: "pulseras_brazaletes",
    productType: "pulsera",
    keywords: ["pulsera", "pulseras", "brazalete", "brazaletes"],
  },
  {
    category: "joyeria_y_bisuteria",
    subcategory: "piercings",
    productType: "piercing",
    keywords: ["piercing", "piercings", "barbell", "ear cuff"],
  },
  {
    category: "calzado",
    productType: "calzado",
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
      "bota",
      "botas",
      "botin",
      "botines",
      "loafer",
      "mocasin",
      "mocasines",
      "alpargata",
    ],
  },
  {
    category: "bolsos_y_marroquineria",
    productType: "bolso",
    keywords: [
      "bolso",
      "bolsos",
      "cartera",
      "carteras",
      "mochila",
      "morral",
      "rinonera",
      "riñonera",
      "crossbody",
      "bandolera",
      "clutch",
      "billetera",
      "estuche",
      "neceser",
      "cosmetiquera",
      "maleta",
      "equipaje",
      "duffel",
      "llavero",
    ],
  },
  {
    category: "gafas_y_optica",
    productType: "gafas",
    keywords: ["gafas", "lentes", "lente", "montura", "optica", "sunglasses", "goggles"],
  },
  {
    category: "camisetas_y_tops",
    productType: "top",
    keywords: ["camiseta", "tshirt", "t shirt", "top", "croptop", "crop top", "camisilla", "esqueleto", "tank"],
  },
  {
    category: "camisas_y_blusas",
    productType: "camisa",
    keywords: ["camisa", "camisas", "blusa", "blusas", "shirt", "guayabera"],
  },
  {
    category: "buzos_hoodies_y_sueteres",
    productType: "buzo",
    keywords: ["buzo", "hoodie", "sweatshirt", "sueter", "sweater", "cardigan", "knit"],
  },
  {
    category: "chaquetas_y_abrigos",
    productType: "chaqueta",
    keywords: ["chaqueta", "abrigo", "coat", "jacket", "parka", "trench", "rompevientos", "impermeable"],
  },
  {
    category: "blazers_y_sastreria",
    productType: "blazer",
    keywords: ["blazer", "sastreria", "saco formal", "tuxedo", "smoking"],
  },
  {
    category: "vestidos",
    productType: "vestido",
    keywords: ["vestido", "dress", "midi", "maxi vestido"],
  },
  {
    category: "enterizos_y_overoles",
    productType: "enterizo",
    keywords: ["enterizo", "jumpsuit", "overol", "overall", "romper", "jardinera"],
  },
  {
    category: "pantalones_no_denim",
    productType: "pantalon",
    keywords: ["pantalon", "pantalones", "trouser", "jogger", "palazzo", "culotte", "cargo"],
  },
  {
    category: "jeans_y_denim",
    productType: "jeans",
    keywords: ["jean", "jeans", "denim"],
  },
  {
    category: "shorts_y_bermudas",
    productType: "short",
    keywords: ["short", "shorts", "bermuda", "bermudas"],
  },
  {
    category: "faldas",
    productType: "falda",
    keywords: ["falda", "faldas", "skirt", "skirts"],
  },
  {
    category: "trajes_de_bano_y_playa",
    productType: "traje de bano",
    keywords: ["bikini", "trikini", "tankini", "traje de bano", "banador", "bañador", "pareo", "rashguard"],
  },
  {
    category: "accesorios_textiles_y_medias",
    productType: "accesorio textil",
    keywords: [
      "medias",
      "calcetin",
      "calcetines",
      "bufanda",
      "panuelo",
      "pañuelo",
      "gorra",
      "sombrero",
      "bandana",
      "cinturon",
      "cinturon",
      "diadema",
      "balaca",
    ],
  },
  {
    category: "hogar_y_lifestyle",
    productType: "hogar",
    keywords: ["vela", "difusor", "ambientador", "poster", "agenda", "cuaderno", "vajilla", "botella", "termo"],
  },
];

export const MATERIAL_KEYWORD_RULES: KeywordRule[] = [
  { key: "algodon", keywords: ["algodon", "algodón", "cotton"] },
  { key: "lino", keywords: ["lino", "linen"] },
  { key: "denim", keywords: ["denim", "jean", "jeans"] },
  { key: "cuero", keywords: ["cuero", "leather", "polipiel"] },
  { key: "seda", keywords: ["seda", "silk"] },
  { key: "lana", keywords: ["lana", "wool"] },
  { key: "poliester", keywords: ["poliester", "poliéster", "polyester"] },
  { key: "viscosa", keywords: ["viscosa", "viscose", "rayon"] },
  { key: "nylon", keywords: ["nylon"] },
  { key: "elastano", keywords: ["elastano", "elastane", "spandex", "lycra"] },
  { key: "oro", keywords: ["oro", "gold", "quilates", "18k", "14k"] },
  { key: "plata", keywords: ["plata", "silver", "925"] },
  { key: "acero", keywords: ["acero", "stainless steel", "acero quirurgico"] },
  { key: "bronce", keywords: ["bronce"] },
  { key: "cobre", keywords: ["cobre", "copper"] },
  { key: "circonia", keywords: ["circonia", "zirconia"] },
];

export const PATTERN_KEYWORD_RULES: KeywordRule[] = [
  { key: "rayas", keywords: ["raya", "rayas", "stripe", "stripes"] },
  { key: "flores", keywords: ["flor", "floral", "flores"] },
  { key: "cuadros", keywords: ["cuadro", "cuadros", "plaid", "tartan"] },
  { key: "animal_print", keywords: ["animal print", "leopardo", "cebra", "tigre"] },
  { key: "puntos", keywords: ["puntos", "polka dot", "dot"] },
  { key: "geometrico", keywords: ["geometrico", "geométrico", "geometric"] },
  { key: "estampado", keywords: ["estampado", "print"] },
  { key: "liso", keywords: ["liso", "solid", "plain"] },
];

export const GENDER_KEYWORD_RULES: KeywordRule[] = [
  { key: "femenino", keywords: ["mujer", "women", "dama", "ladies"] },
  { key: "masculino", keywords: ["hombre", "men", "caballero"] },
  { key: "infantil", keywords: ["nino", "niño", "nina", "niña", "kids", "infantil"] },
  { key: "no_binario_unisex", keywords: ["unisex"] },
];

export const hasAnyKeyword = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.includes(keyword));
