export const CATEGORY_GROUPS = {
  prendas_superiores: [
    "camisetas_y_tops",
    "camisas_y_blusas",
    "buzos_hoodies_y_sueteres",
  ],
  prendas_exteriores: [
    "chaquetas_y_abrigos",
    "blazers_y_sastreria",
  ],
  prendas_inferiores: [
    "pantalones_no_denim",
    "jeans_y_denim",
    "shorts_y_bermudas",
    "faldas",
  ],
  prendas_completas: [
    "vestidos",
    "enterizos_y_overoles",
    "conjuntos_y_sets_2_piezas",
  ],
  ropa_tecnica: [
    "ropa_deportiva_y_performance",
    "ropa_interior_basica",
    "lenceria_y_fajas_shapewear",
    "pijamas_y_ropa_de_descanso_loungewear",
    "trajes_de_bano_y_playa",
  ],
  ropa_especial: [
    "ropa_de_bebe_0_24_meses",
    "uniformes_y_ropa_de_trabajo_escolar",
  ],
  calzado: ["calzado"],
  accesorios_textiles: ["accesorios_textiles_y_medias"],
  bolsos: ["bolsos_y_marroquineria"],
  joyeria: ["joyeria_y_bisuteria"],
  gafas: ["gafas_y_optica"],
  hogar_lifestyle: ["hogar_y_lifestyle", "tarjeta_regalo"],
} as const;

export type PromptGroup = keyof typeof CATEGORY_GROUPS;

const CATEGORY_TO_GROUP: Record<string, PromptGroup> = Object.entries(CATEGORY_GROUPS).reduce(
  (acc, [group, categories]) => {
    categories.forEach((category) => {
      acc[category] = group as PromptGroup;
    });
    return acc;
  },
  {} as Record<string, PromptGroup>,
);

export const getPromptGroupForCategory = (category: string | null | undefined): PromptGroup | null => {
  if (!category) return null;
  return CATEGORY_TO_GROUP[category] ?? null;
};

export const getCategoriesForPromptGroup = (group: PromptGroup | null): string[] => {
  if (!group) return [];
  return [...CATEGORY_GROUPS[group]];
};
