export type GenderKey = "Femenino" | "Masculino" | "Unisex" | "Infantil";

export const GENDER_ROUTE: Record<GenderKey, string> = {
  Femenino: "femenino",
  Masculino: "masculino",
  Unisex: "unisex",
  Infantil: "infantil",
};

const GENDER_ALIASES: Record<string, GenderKey> = {
  femenino: "Femenino",
  mujer: "Femenino",
  masculino: "Masculino",
  hombre: "Masculino",
  male: "Masculino",
  infantil: "Infantil",
  nino: "Infantil",
  no_binario_unisex: "Unisex",
  unisex: "Unisex",
  unknown: "Unisex",
};

export function normalizeGender(raw?: string | null): GenderKey {
  if (!raw) {
    return "Unisex";
  }
  const key = raw.toLowerCase().trim();
  return GENDER_ALIASES[key] ?? "Unisex";
}

export const CATEGORY_GROUPS = {
  Superiores: [
    "camisetas_y_tops",
    "camisas_y_blusas",
    "buzos_hoodies_y_sueteres",
    "chaquetas_y_abrigos",
    "blazers_y_sastreria",
    "conjuntos_y_sets_2_piezas",
    "vestidos",
    "enterizos_y_overoles",
    "tops",
    "uniformes_y_ropa_de_trabajo_escolar",
    "outerwear",
    "ropa_deportiva_y_performance",
    "deportivo",
    "knitwear",
    "enterizos",
    "ropa_de_bebe_0_24_meses",
  ],
  Inferiores: [
    "pantalones_no_denim",
    "jeans_y_denim",
    "faldas",
    "shorts_y_bermudas",
    "bottoms",
  ],
  Accesorios: [
    "accesorios_textiles_y_medias",
    "bolsos_y_marroquineria",
    "joyeria_y_bisuteria",
    "calzado",
    "gafas_y_optica",
    "accesorios",
    "tarjeta_regalo",
    "hogar_y_lifestyle",
    "ropa_interior",
    "ropa_interior_basica",
    "lenceria_y_fajas_shapewear",
    "pijamas_y_ropa_de_descanso_loungewear",
    "trajes_de_bano_y_playa",
    "trajes_de_bano",
  ],
} as const;

export const SPECIAL_SUBCATEGORY_SPLITS = {
  outerwear: {
    column: "Superiores",
    subcategories: ["chaquetas", "buzos", "abrigos", "blazers"],
  },
  ropa_deportiva_y_performance: {
    superiores: [
      "top_deportivo_bra_deportivo",
      "camiseta_deportiva",
      "chaqueta_deportiva",
      "ropa_de_running",
      "ropa_de_ciclismo",
      "ropa_de_futbol_entrenamiento",
      "ropa_de_compresion",
      "conjunto_deportivo",
    ],
    inferiores: [
      "leggings_deportivos",
      "shorts_deportivos",
      "sudadera_pants_deportivos",
    ],
  },
} as const;

const LABEL_OVERRIDES: Record<string, string> = {
  camisetas_y_tops: "Camisetas y tops",
  camisas_y_blusas: "Camisas y blusas",
  buzos_hoodies_y_sueteres: "Buzos, hoodies y sueteres",
  chaquetas_y_abrigos: "Chaquetas y abrigos",
  blazers_y_sastreria: "Blazers y sastreria",
  conjuntos_y_sets_2_piezas: "Conjuntos y sets",
  enterizos_y_overoles: "Enterizos y overoles",
  uniformes_y_ropa_de_trabajo_escolar: "Uniformes y trabajo",
  ropa_de_bebe_0_24_meses: "Bebe 0-24 meses",
  pantalones_no_denim: "Pantalones",
  jeans_y_denim: "Jeans y denim",
  shorts_y_bermudas: "Shorts y bermudas",
  accesorios_textiles_y_medias: "Textiles y medias",
  bolsos_y_marroquineria: "Bolsos y marroquineria",
  joyeria_y_bisuteria: "Joyeria y bisuteria",
  gafas_y_optica: "Gafas y optica",
  ropa_interior_basica: "Ropa interior basica",
  lenceria_y_fajas_shapewear: "Lenceria y fajas",
  pijamas_y_ropa_de_descanso_loungewear: "Pijamas y descanso",
  trajes_de_bano_y_playa: "Trajes de bano y playa",
  trajes_de_bano: "Trajes de bano",
  ropa_deportiva_y_performance: "Ropa deportiva",
  outerwear: "Outerwear",
  knitwear: "Knitwear",
  bottoms: "Bottoms",
  tops: "Tops",
  deportivo: "Deportivo",
  accesorios: "Accesorios",
  ropa_interior: "Ropa interior",
  calzado: "Calzado",
  vestidos: "Vestidos",
  faldas: "Faldas",
  tarjeta_regalo: "Tarjeta regalo",
  hogar_y_lifestyle: "Hogar y lifestyle",
};

const SUBCATEGORY_OVERRIDES: Record<string, string> = {
  top_deportivo_bra_deportivo: "Top deportivo",
  camiseta_deportiva: "Camiseta deportiva",
  chaqueta_deportiva: "Chaqueta deportiva",
  ropa_de_running: "Running",
  ropa_de_ciclismo: "Ciclismo",
  ropa_de_futbol_entrenamiento: "Futbol y entrenamiento",
  ropa_de_compresion: "Compresion",
  conjunto_deportivo: "Conjunto deportivo",
  leggings_deportivos: "Leggings",
  shorts_deportivos: "Shorts deportivos",
  sudadera_pants_deportivos: "Pants deportivos",
  estuches_cartucheras_neceseres: "Estuches / cartucheras / neceseres",
  papeleria_y_libros: "Papelería y libros",
  llaveros: "Llaveros",
};

const SMALL_WORDS = new Set([
  "y",
  "de",
  "del",
  "la",
  "las",
  "los",
  "por",
  "para",
  "en",
  "a",
  "e",
  "o",
]);

export function labelize(value: string): string {
  if (LABEL_OVERRIDES[value]) {
    return LABEL_OVERRIDES[value];
  }
  return value
    .split("_")
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function labelizeSubcategory(value: string): string {
  if (SUBCATEGORY_OVERRIDES[value]) {
    return SUBCATEGORY_OVERRIDES[value];
  }
  return labelize(value);
}

export function buildCategoryHref(
  gender: GenderKey,
  category: string,
  subcategory?: string
): string {
  const genderRoute = GENDER_ROUTE[gender];
  if (subcategory) {
    return `/g/${genderRoute}/${category}/${subcategory}`;
  }
  return `/g/${genderRoute}/${category}`;
}
