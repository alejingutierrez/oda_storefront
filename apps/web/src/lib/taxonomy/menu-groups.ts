import type { MenuGroup } from "./types";

export const MENU_GROUP_VALUES: MenuGroup[] = [
  "Superiores",
  "Completos",
  "Inferiores",
  "Accesorios",
  "Lifestyle",
];

export const MENU_GROUP_OPTIONS: Array<{ value: MenuGroup; label: string }> = [
  { value: "Superiores", label: "Superiores" },
  { value: "Completos", label: "Completos" },
  { value: "Inferiores", label: "Inferiores" },
  { value: "Accesorios", label: "Accesorios" },
  { value: "Lifestyle", label: "Lifestyle" },
];

const LEGACY_CATEGORY_GROUPS: Record<MenuGroup, string[]> = {
  Superiores: [
    "camisetas_y_tops",
    "camisas_y_blusas",
    "buzos_hoodies_y_sueteres",
    "chaquetas_y_abrigos",
    "blazers_y_sastreria",
    "ropa_deportiva_y_performance",
    "uniformes_y_ropa_de_trabajo_escolar",
    "ropa_de_bebe_0_24_meses",
  ],
  Completos: [
    "vestidos",
    "conjuntos_y_sets_2_piezas",
    "enterizos_y_overoles",
  ],
  Inferiores: [
    "pantalones_no_denim",
    "jeans_y_denim",
    "faldas",
    "shorts_y_bermudas",
  ],
  Accesorios: [
    "bolsos_y_marroquineria",
    "calzado",
    "joyeria_y_bisuteria",
    "gafas_y_optica",
    "accesorios_textiles_y_medias",
  ],
  Lifestyle: [
    "ropa_interior_basica",
    "lenceria_y_fajas_shapewear",
    "pijamas_y_ropa_de_descanso_loungewear",
    "trajes_de_bano_y_playa",
    "hogar_y_lifestyle",
    "tarjeta_regalo",
  ],
};

const CATEGORY_TO_MENU_GROUP: Record<string, MenuGroup> = Object.entries(LEGACY_CATEGORY_GROUPS).reduce(
  (acc, [group, categories]) => {
    const menuGroup = group as MenuGroup;
    for (const category of categories) {
      acc[category] = menuGroup;
    }
    return acc;
  },
  {} as Record<string, MenuGroup>,
);

export function isMenuGroup(value: unknown): value is MenuGroup {
  if (typeof value !== "string") return false;
  return MENU_GROUP_VALUES.includes(value as MenuGroup);
}

export function resolveCategoryMenuGroup(params: {
  categoryKey: string;
  currentMenuGroup?: unknown;
  fallback?: MenuGroup;
}): MenuGroup {
  const { categoryKey, currentMenuGroup, fallback = "Lifestyle" } = params;
  if (isMenuGroup(currentMenuGroup)) return currentMenuGroup;
  const key = String(categoryKey || "").trim();
  if (!key) return fallback;
  return CATEGORY_TO_MENU_GROUP[key] ?? fallback;
}
