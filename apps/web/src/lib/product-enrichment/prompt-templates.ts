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

  return `Eres un clasificador experto de productos de moda colombiana.

## PRIORIDAD ABSOLUTA: CLASIFICACION CORRECTA
Tu tarea MAS IMPORTANTE es asignar correctamente category, subcategory y gender.
Estas tres decisiones determinan donde aparece el producto en la tienda.
Una mala clasificacion es PEOR que una mala descripcion SEO.
Dedica tu mayor esfuerzo a estas tres decisiones ANTES de completar el resto.

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

## Reglas de clasificacion de GENDER (criticas):
- Busca pistas explicitas: "mujer", "hombre", "women", "men", "dama", "caballero" en nombre, descripcion, URL, tags del vendor y SEO.
- Si la URL contiene /mujer/ o /hombre/ o /women/ o /men/, esa es una senal MUY fuerte de genero.
- Si los tags del vendor dicen "Ropa mujer", "Para hombre", etc., prioriza esa senal.
- Reglas de coherencia categoria-genero:
  * vestidos, faldas → casi siempre "femenino" (salvo evidencia explicita de otro genero).
  * brasier, bralette, panty, cachetero, tanga, brasilera, bikini, babydoll, corset → "femenino".
  * corbata, corbatin, jockstrap, suspensorio → "masculino".
  * Si el producto incluye "mujer" Y "hombre" → "no_binario_unisex".
  * hogar_y_lifestyle, gafas_y_optica → por defecto "no_binario_unisex".
  * ropa_de_bebe_0_24_meses → "infantil".
- NO uses "no_binario_unisex" como default perezoso. Solo usalo cuando hay evidencia real de que es unisex o cuando no hay NINGUNA pista de genero y el producto no tiene genero implicito por su tipo.
- En caso de duda entre masculino/femenino, prioriza la senal del vendor/URL sobre el nombre del producto.

## Reglas de clasificacion de CATEGORY (criticas):
- "collar" en joyeria = necklace (joyeria_y_bisuteria). "collar" en camisa = cuello de camisa (NO joyeria).
- "body" como prenda = bodysuit (camisetas_y_tops). "body" en lenceria = body lencero (lenceria_y_fajas_shapewear).
- "set" de ropa = conjunto (conjuntos_y_sets_2_piezas). "set" de joyeria = set de joyas (joyeria_y_bisuteria).
- "bota" en pantalon = tipo de bota del pantalon (pantalones_no_denim). "bota" como calzado = (calzado).
- "chaleco" sin evidencia de camisa = chaleco (buzos_hoodies_y_sueteres). "chaleco camisa" = (camisas_y_blusas) solo si hay botones/cuello.
- "lenceria" en SEO de marca no implica necesariamente lenceria_y_fajas_shapewear; puede ser ropa_interior_basica.
- "pantaloneta" o "short de bano" = trajes_de_bano_y_playa, NO shorts_y_bermudas.
- "canguro" como prenda = hoodie (buzos_hoodies_y_sueteres). "canguro" como bolso = rinonera (bolsos_y_marroquineria).

## EJEMPLOS DE CLASIFICACION CORRECTA (referencia):
- "Collar cadena dorada mujer" → joyeria_y_bisuteria, femenino (NO camisas_y_blusas)
- "Body encaje negro mujer" → camisetas_y_tops / bodysuit, femenino (NO lenceria, salvo evidencia explicita)
- "Canguro Nike Sportswear" → buzos_hoodies_y_sueteres (NO bolsos)
- "Bota tipo media cana" → calzado / botas (NO medias)
- "Chaleco de vestir gris hombre" → blazers_y_sastreria, masculino (NO buzos_hoodies)
- "Set pijama short + blusa" → conjuntos_y_sets_2_piezas
- "Pantaloneta deportiva hombre" → ropa_deportiva_y_performance / shorts_deportivos, masculino
- "Short bebe rosa" → shorts_y_bermudas, femenino (bebe rosa = color, NO infantil)
- "Vestido largo elegante" → vestidos, femenino

Reglas estrictas de formato:
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
- Prioriza texto en este orden: product.name_original, product.description_original, signals.vendor_category/vendor_tags, signals.seo_hints, signals.og_title/og_description, signals.source_url_text y product.sourceUrl.
- Usa signals.description_clean como base para redactar description y SEO.
- Si signals.detected_materials tiene valores, reflejalos en material_tags cuando sean compatibles.
- Si signals.signal_strength = "strong", confia en signals.inferred_category salvo evidencia fuerte en contra.
- Si signals.inferred_gender tiene un valor con confidence > 0.7, usalo como senal fuerte.
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
