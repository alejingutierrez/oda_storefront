import {
  CATEGORY_DESCRIPTIONS,
  SUBCATEGORY_DESCRIPTIONS,
} from "@/lib/product-enrichment/constants";
import {
  getPromptGroupForCategory,
  type PromptGroup,
} from "@/lib/product-enrichment/category-groups";
import { slugify } from "@/lib/product-enrichment/utils";

const MAX_PROMPT_WORDS = 100;

const hasText = (value: string | null | undefined) =>
  typeof value === "string" && value.trim().length > 0;

const toSingleLine = (value: string) => value.replace(/\s+/g, " ").trim();

const clampWords = (value: string, maxWords = MAX_PROMPT_WORDS) => {
  const normalized = toSingleLine(value);
  if (!normalized) return "";
  const words = normalized.split(" ");
  if (words.length <= maxWords) return normalized;
  return `${words.slice(0, maxWords).join(" ").trim()}.`;
};

const CATEGORY_GROUP_FALLBACK: Record<PromptGroup, string> = {
  prendas_superiores:
    "Prendas superiores. Prioriza tipo de manga, cuello, largo de torso, estructura textil y fit visual. Distingue con evidencia textual entre top, camisa/blusa y buzo.",
  prendas_exteriores:
    "Prendas exteriores de abrigo o estructura. Prioriza capa externa, forro, cierre, nivel de abrigo y formalidad. Distingue sastreria de chaquetas casuales.",
  prendas_inferiores:
    "Prendas inferiores. Prioriza tiro, largo, bota, estructura de pierna y diferencia denim vs no denim. Evita confundir con faldas o prendas completas.",
  prendas_completas:
    "Prendas completas o sets. Prioriza si es pieza unica o conjunto, largo, silueta principal y tipo de cierre. Usa descripcion para diferenciar vestido de enterizo.",
  ropa_tecnica:
    "Ropa funcional o de uso interno/descanso. Prioriza finalidad, comodidad, compresion, transpirabilidad y elasticidad. Usa descripcion tecnica para materiales y cuidado.",
  ropa_especial:
    "Ropa para uso especial por edad o contexto institucional. Prioriza rango de edad, requisitos funcionales y restricciones de uso escolar/laboral.",
  calzado:
    "Calzado. Prioriza tipo de suela, forma de punta, altura, cierre y uso principal. Usa texto para material real y detalles tecnicos; imagen para forma y color.",
  accesorios_textiles:
    "Accesorios textiles. Prioriza funcion del accesorio, zona de uso, material textil y estacionalidad. Evita confundir con joyeria, bolsos o calzado.",
  bolsos:
    "Bolsos y marroquineria. Prioriza formato, tamano, sistema de carga, compartimentos y tipo de cierre. Usa texto para dimensiones y organizacion interna.",
  joyeria:
    "Joyeria y bisuteria. Prioriza tipo de pieza, metal/base, piedra y acabado. Usa texto para quilataje o bano; imagen para forma, volumen y color visible.",
  gafas:
    "Gafas y optica. Prioriza tipo de lente, forma de montura, uso (sol, formulado, proteccion) y tecnologia optica declarada.",
  hogar_lifestyle:
    "Articulos no moda de hogar/lifestyle. Prioriza funcion de uso, material, dimensiones y mantenimiento. Evita mezclarlos con categorias de vestir.",
};

const GROUP_FOCUS_HINT: Record<PromptGroup, string> = {
  prendas_superiores:
    "Evalua manga, cuello, largo superior, estructura y nivel de abrigo.",
  prendas_exteriores:
    "Evalua abrigo, forro, estructura externa y tipo de cierre.",
  prendas_inferiores:
    "Evalua tiro, largo, bota, estructura y tipo de tela.",
  prendas_completas:
    "Evalua si es pieza unica o set, largo, silueta y cierre.",
  ropa_tecnica:
    "Evalua funcion tecnica, comodidad, elasticidad y transpirabilidad.",
  ropa_especial:
    "Evalua rango de edad, uso institucional y requisitos funcionales.",
  calzado:
    "Evalua suela, punta, altura, cierre y uso principal.",
  accesorios_textiles:
    "Evalua funcion del accesorio, zona de uso y material textil.",
  bolsos:
    "Evalua formato, tamano, capacidad, correa y compartimentos.",
  joyeria:
    "Evalua tipo de pieza, metal/base, piedra y acabado.",
  gafas:
    "Evalua lente, montura, forma y uso optico/de proteccion.",
  hogar_lifestyle:
    "Evalua funcion de hogar, material, tamano y mantenimiento.",
};

const buildGenericCategoryDescription = (label: string, group: PromptGroup | null) => {
  if (group) return CATEGORY_GROUP_FALLBACK[group];
  return `Categoria de ${label}. Clasifica con evidencia de nombre, descripcion original y metadata del vendedor.`;
};

const buildGenericSubcategoryDescription = (params: {
  categoryLabel: string;
  subcategoryLabel: string;
  categoryKey: string;
}) => {
  const group = getPromptGroupForCategory(params.categoryKey);
  const focus = group
    ? GROUP_FOCUS_HINT[group]
    : "Evalua tipo principal, uso, forma y material para distinguir esta subcategoria.";
  return `Subcategoria de ${params.categoryLabel}. Clasifica aqui cuando el tipo principal sea ${params.subcategoryLabel}. ${focus} Usa como prioridad nombre original, descripcion original y tags del vendedor; usa imagen para fit, color y patron visible.`;
};

const resolveConstantDescription = (
  map: Record<string, string>,
  key: string,
  label: string,
) => map[key] ?? map[slugify(label)] ?? null;

export const resolveCategoryPromptDescription = (params: {
  categoryKey: string;
  categoryLabel: string;
  currentDescription?: string | null;
}) => {
  if (hasText(params.currentDescription)) {
    return clampWords(String(params.currentDescription));
  }
  const fromConstants = resolveConstantDescription(
    CATEGORY_DESCRIPTIONS,
    params.categoryKey,
    params.categoryLabel,
  );
  if (fromConstants) return clampWords(fromConstants);
  const group = getPromptGroupForCategory(params.categoryKey);
  return clampWords(buildGenericCategoryDescription(params.categoryLabel, group));
};

export const resolveSubcategoryPromptDescription = (params: {
  categoryKey: string;
  categoryLabel: string;
  subcategoryKey: string;
  subcategoryLabel: string;
  currentDescription?: string | null;
}) => {
  if (hasText(params.currentDescription)) {
    return clampWords(String(params.currentDescription));
  }
  const fromConstants = resolveConstantDescription(
    SUBCATEGORY_DESCRIPTIONS,
    params.subcategoryKey,
    params.subcategoryLabel,
  );
  if (fromConstants) return clampWords(fromConstants);
  return clampWords(
    buildGenericSubcategoryDescription({
      categoryLabel: params.categoryLabel,
      subcategoryLabel: params.subcategoryLabel,
      categoryKey: params.categoryKey,
    }),
  );
};
