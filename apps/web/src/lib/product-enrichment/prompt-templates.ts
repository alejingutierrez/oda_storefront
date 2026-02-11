import type { PromptGroup } from "@/lib/product-enrichment/category-groups";

export type PromptTaxonomy = {
  categories: Array<{
    key: string;
    label: string;
    description: string | null;
    subcategories: Array<{ key: string; label: string; description: string | null }>;
  }>;
  categoryValues: string[];
  subcategoryValues: string[];
  styleTags: string[];
  styleTagDetails: Array<{ key: string; label: string; description: string | null }>;
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  genderValues: string[];
  seasonValues: string[];
  fitValues: string[];
};

const GROUP_INSTRUCTIONS: Record<PromptGroup, string> = {
  prendas_superiores:
    "Grupo prendas_superiores: prioriza composicion textil, tipo de manga, cuello y fit visual (ajustado/suelto/oversize).",
  prendas_exteriores:
    "Grupo prendas_exteriores: prioriza estructura, forro, capas, cierre y uso de abrigo/proteccion climatica.",
  prendas_inferiores:
    "Grupo prendas_inferiores: prioriza tiro, largo, tipo de bota, denim vs no denim y presencia de stretch.",
  prendas_completas:
    "Grupo prendas_completas: confirma si es pieza unica o set; identifica largo, tipo de cierre y ocasion principal.",
  ropa_tecnica:
    "Grupo ropa_tecnica: prioriza funcionalidad (compresion, secado rapido, UV, transpirabilidad) y comodidad.",
  ropa_especial:
    "Grupo ropa_especial: prioriza rango de edad/uso laboral-escolar y requisitos de seguridad/comodidad.",
  calzado:
    "Grupo calzado: usa imagen para suela, forma y altura; usa texto para material real, tecnologia y plantilla.",
  accesorios_textiles:
    "Grupo accesorios_textiles: prioriza tipo de textil, uso y temporada; evita confundir con joyeria.",
  bolsos:
    "Grupo bolsos: prioriza tipo de bolso, compartimentos, cierre y material principal; texto para dimensiones.",
  joyeria:
    "Grupo joyeria: imagen manda en forma/color de pieza; texto manda en metal, quilataje, banado y tipo de piedra.",
  gafas:
    "Grupo gafas: prioriza tipo de lente, proteccion UV/polarizado, forma y material de montura.",
  hogar_lifestyle:
    "Grupo hogar_lifestyle: prioriza funcion domestica, material, dimensiones y mantenimiento.",
};

const buildCategoryPrompt = (taxonomy: PromptTaxonomy, onlyCategories?: string[] | null) => {
  const allowed = onlyCategories?.length ? new Set(onlyCategories) : null;
  return taxonomy.categories
    .filter((category) => (allowed ? allowed.has(category.key) : true))
    .map((category) => {
      const header = category.description
        ? `- ${category.key}: ${category.label}. ${category.description}`
        : `- ${category.key}: ${category.label}.`;
      const subs = category.subcategories
        .map((sub) =>
          sub.description ? `  - ${sub.key}: ${sub.label}. ${sub.description}` : `  - ${sub.key}: ${sub.label}.`,
        )
        .join("\n");
      return `${header}\n${subs}`;
    })
    .join("\n");
};

const buildStyleTagGlossary = (taxonomy: PromptTaxonomy) =>
  taxonomy.styleTagDetails
    .slice(0, 80)
    .map((tag) => (tag.description ? `- ${tag.key}: ${tag.description}` : `- ${tag.key}`))
    .join("\n");

type BuildPromptParams = {
  taxonomy: PromptTaxonomy;
  group: PromptGroup | null;
  routedCategories: string[];
};

export const buildProductEnrichmentPrompt = ({
  taxonomy,
  group,
  routedCategories,
}: BuildPromptParams) => {
  const categories = buildCategoryPrompt(
    taxonomy,
    group && routedCategories.length ? routedCategories : null,
  );
  const styleGlossary = buildStyleTagGlossary(taxonomy);
  const groupInstruction = group ? GROUP_INSTRUCTIONS[group] : "Modo generico: usar toda la taxonomia publicada.";

  return `Eres un clasificador de enriquecimiento de producto de moda colombiana.
Debes devolver SOLO JSON valido con el siguiente esquema:
{
  "product": {
    "description": "string",
    "category": "string",
    "subcategory": "string",
    "style_tags": ["string"],
    "material_tags": ["string"],
    "pattern_tags": ["string"],
    "occasion_tags": ["string"],
    "gender": "string",
    "season": "string",
    "seo_title": "string",
    "seo_description": "string",
    "seo_tags": ["string"],
    "variants": [
      {
        "variant_id": "string",
        "sku": "string|null",
        "color_hex": "#RRGGBB | [\\"#RRGGBB\\", \\"#RRGGBB\\"]",
        "color_pantone": "NN-NNNN | [\\"NN-NNNN\\", \\"NN-NNNN\\"]",
        "fit": "string"
      }
    ]
  }
}

Reglas estrictas:
- description debe ser texto plano (sin HTML).
- category, subcategory, gender, season y fit deben tener un solo valor.
- subcategory debe pertenecer a la category elegida.
- style_tags debe contener EXACTAMENTE 10 valores permitidos.
- material_tags maximo 3.
- pattern_tags maximo 2.
- occasion_tags maximo 2.
- seo_title maximo 70 chars.
- seo_description entre 120 y 160 chars, sin emojis.
- seo_tags entre 6 y 12, sin duplicados.
- No inventes variantes: devuelve exactamente un objeto por variant_id recibido.
- color_hex debe ser #RRGGBB (1 a 3 valores por variante, orden de predominancia).
- color_pantone debe ser codigo TCX NN-NNNN (1 a 3 valores por variante, orden de predominancia).

Reglas de evidencia:
- Prioriza texto en este orden: product.name_original, product.description_original, signals.vendor_category/vendor_tags, signals.og_title/og_description.
- Usa signals.description_clean como base para redactar description y SEO.
- Si signals.detected_materials tiene valores, reflejalos en material_tags cuando sean compatibles.
- Si signals.signal_strength = "strong", confia en signals.inferred_category salvo evidencia fuerte en contra.
- Si signals.conflicts no esta vacio, actua con cautela y usa imagenes para desambiguar.
- Las imagenes ayudan principalmente para color, patron y fit. No inventes composicion material si el texto ya la da.
- ${groupInstruction}

Taxonomia permitida:
category -> subcategory
${categories}

style_tags permitidos:
${taxonomy.styleTags.join(", ")}

glosario style_tags (semantica):
${styleGlossary}

material_tags permitidos:
${taxonomy.materialTags.join(", ")}

pattern_tags permitidos:
${taxonomy.patternTags.join(", ")}

occasion_tags permitidos:
${taxonomy.occasionTags.join(", ")}

gender permitidos:
${taxonomy.genderValues.join(", ")}

season permitidos:
${taxonomy.seasonValues.join(", ")}

fit permitidos:
${taxonomy.fitValues.join(", ")}

Si falta evidencia para material/pattern/occasion, usa "otro" cuando exista en la lista permitida.`;
};
