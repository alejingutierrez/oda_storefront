# Plan de Mejora: Product Enrichment Service

## Diagnostico del Estado Actual

### Prompt actual (v11)
- **Un solo prompt monolitico** (`buildPrompt` en `openai.ts:677-776`) para las 28 categorias.
- El prompt lista TODA la taxonomia (categorias, subcategorias, style tags, materials, patterns, occasions) en un solo bloque de texto. Esto diluye el contexto relevante para cada producto.
- Las reglas de clasificacion estan hardcodeadas como texto libre (lineas 728-744): "si el texto dice joyeria usa X", "si dice calzado usa Y". Esto es fragil y no escala.
- El nombre del producto se envia como campo `product.name` en el payload JSON, pero el prompt no tiene instrucciones especificas de como interpretar patrones de nombre por categoria.
- Las imagenes se envian (hasta 8) pero con la regla rigida de "texto siempre gana sobre imagen", sin distincion por tipo de producto.
- style_tags siempre deben ser exactamente 10, y si el modelo falla se rellenan aleatoriamente desde la taxonomia.
- No hay paso previo de pre-clasificacion; el modelo debe simultaneamente clasificar, categorizar, extraer colores, generar SEO y asignar tags en una sola llamada.

### Descripcion original del producto: como llega y como se pierde
La descripcion original del producto es una de las senales mas ricas que tenemos, pero actualmente esta sub-utilizada:

**Flujo actual de la descripcion**:
1. **Shopify** (`adapters/shopify.ts:92`): `data.description ?? data.body_html` - llega como **HTML crudo** con etiquetas, listas de materiales, tablas de tallas, instrucciones de cuidado.
2. **Generic** (`adapters/generic.ts:242`): `product?.description ?? meta["description"] ?? meta["og:description"]` - puede ser HTML, JSON-LD description, o texto plano de meta tags.
3. **Almacenamiento** (`extractor.ts:543`): Se guarda en `product.description` como texto (con HTML parcialmente limpio).
4. **Enrichment** (`openai.ts:1012`): Se envia como `product.description` en el payload JSON al LLM.
5. **Post-enrichment** (`openai.ts:832-833`): `stripHtml(input.description)` limpia el HTML de la respuesta del LLM, pero la descripcion ORIGINAL ya se perdio.

**Que informacion valiosa contiene la descripcion original y no se esta aprovechando**:
- **Composicion de materiales**: "95% Algodon, 5% Elastano" - dato exacto que el LLM tiene que adivinar.
- **Instrucciones de cuidado**: "Lavar a mano, no usar secadora" - indica tipo de tela/material.
- **Tablas de medidas**: "Largo: 65cm, Pecho: 48cm" - indica tipo de prenda y fit.
- **Detalles tecnicos**: "Con proteccion UV 50+", "Tela breathable", "Impermeable".
- **Tipo de prenda explicito**: "Vestido midi con corte A y cierre en espalda".
- **Origen/fabricacion**: "Hecho en Colombia", "Importado de Italia".

### Metadata de scraping: senales de oro desaprovechadas
El `product.metadata` contiene senales extremadamente valiosas que el enrichment recibe pero el prompt no destaca:

**Shopify** (`adapters/shopify.ts:103-111`):
```json
{
  "platform": "shopify",
  "handle": "aretes-luna-dorados",          // ← Senal de producto en la URL
  "product_type": "Joyería",                // ← Categoria ASIGNADA por el vendedor!
  "tags": ["mujer", "aretes", "oro 18k",    // ← Tags del vendedor, muy confiables
           "collar", "regalo", "premium"],
  "raw": { "id": 123456 }
}
```

**Generic/Custom** (`adapters/generic.ts:266-271`):
```json
{
  "platform": "custom",
  "jsonld": true,                           // ← Indica que habia datos estructurados
  "meta": {                                 // ← TODOS los meta tags del HTML
    "og:title": "Aretes Luna | Marca XYZ",
    "og:description": "Aretes banados en oro...",
    "og:type": "product",
    "description": "Hermosos aretes...",
    "product:price:amount": "89900"
  }
}
```

**Problema clave**: Toda esta metadata SE ENVIA al LLM en el payload (linea 1024: `metadata: params.product.metadata ?? null`), pero el prompt solo dice vagamente "metadata (og:title, og:description, jsonld, etc.)" sin instrucciones especificas de como usar `product_type`, `tags`, o los meta tags.

### Output completo del LLM de enrichment (por que siempre es necesario)
El LLM genera 13+ campos que requieren capacidades que no se pueden replicar con regex:

**Campos generativos** (requieren generacion de texto):
- `description` - Descripcion nueva en espanol neutro, sin HTML, incorporando detalles del producto
- `seo_title` - Titulo SEO <= 70 chars, combina nombre + marca (`openai.ts:714`)
- `seo_description` - 120-160 chars, espanol neutro, sin emojis (`openai.ts:715`)
- `seo_tags` - 6-12 tags SEO en espanol, sin duplicados (`openai.ts:716`)

**Campos de clasificacion** (requieren comprension contextual):
- `category` + `subcategory` - De la taxonomia de ~28 categorias y ~200 subcategorias
- `style_tags` - EXACTAMENTE 10 de la taxonomia (10 de ~40+ opciones) (`openai.ts:710`)
- `material_tags` - Hasta 3 (`openai.ts:711`)
- `pattern_tags` - Hasta 2 (`openai.ts:712`)
- `occasion_tags` - Hasta 2 (`openai.ts:713`)
- `gender` - De las opciones permitidas
- `season` - De las opciones permitidas

**Campos que requieren vision** (imagenes):
- `color_hex` - 1-3 colores #RRGGBB por variante, en orden de predominancia (`openai.ts:720`)
- `color_pantone` - 1-3 codigos Pantone TCX por variante (`openai.ts:721`)
- `fit` - Clasificacion de fit por variante (necesita ver la imagen para slim/oversize/etc.)

**Implicacion para el plan**: La llamada principal al LLM es SIEMPRE necesaria. Las mejoras del plan buscan que el LLM reciba MEJOR informacion (senales pre-procesadas, prompt mas enfocado, descripcion limpia) para que TODOS estos outputs mejoren, no solo la clasificacion.

### Normalizer ya tiene keyword matching - pero no se comunica al enrichment
El archivo `normalizer.ts` tiene un sistema sofisticado de keyword matching (lineas 246-507) con diccionarios de categorias, materiales, patrones, colores y generos. Estas mismas senales NO se pasan al enrichment porque el normalizer solo se ejecuta en el paso de scraping.

---

## Plan de Implementacion

### Fase 0: Agregacion de senales pre-LLM (Signal Harvesting)

**Objetivo**: Antes de llamar al LLM, construir un perfil de senales agregadas de TODAS las fuentes disponibles (nombre, descripcion, metadata, tags del vendor) y pasarlo al prompt como contexto estructurado.

**Justificacion**: El normalizer (`normalizer.ts:246-507`) ya tiene keyword dictionaries para categorias, materiales, patrones, colores y genero. Pero esos diccionarios solo se usan en scraping y no se comunican al enrichment. Ademas, hay senales especificas de plataforma (Shopify `product_type`, `tags`) que el enrichment ignora.

**Cambios**:

1. Crear `signal-harvester.ts` con funcion principal:
   ```typescript
   type HarvestedSignals = {
     // Senales del nombre
     nameKeywords: string[];                   // tokens relevantes del nombre
     nameCategory: string | null;              // categoria inferida del nombre
     nameSubcategory: string | null;           // subcategoria inferida
     nameProductType: string | null;           // "aretes", "jean", "vestido"

     // Senales de la descripcion original
     descriptionMaterials: string[];           // ["95% algodon", "5% elastano"]
     descriptionCare: string[];                // ["lavar a mano", "no usar secadora"]
     descriptionMeasurements: string[];        // ["largo 65cm", "pecho 48cm"]
     descriptionFeatures: string[];            // ["proteccion UV", "impermeable"]
     descriptionProductType: string | null;    // tipo de prenda mencionado en descripcion
     descriptionCleanText: string;             // descripcion sin HTML, limpia y compacta

     // Senales de metadata del vendor/plataforma
     vendorCategory: string | null;            // Shopify product_type o equivalent
     vendorTags: string[];                     // Shopify tags o equivalent
     vendorPlatform: string | null;            // "shopify", "custom", "woocommerce"
     ogTitle: string | null;                   // og:title para sitios custom
     ogDescription: string | null;             // og:description para sitios custom

     // Senales agregadas (la conclusion)
     inferredCategory: string | null;          // mejor guess combinando todo
     inferredSubcategory: string | null;
     inferredGender: string | null;
     inferredMaterials: string[];              // materiales detectados en texto
     inferredPatterns: string[];               // patrones detectados en texto
     signalStrength: "strong" | "moderate" | "weak";  // que tan confiadas son las senales
     conflictingSignals: string[];             // senales que se contradicen
   };

   function harvestSignals(params: {
     name: string;
     description: string | null;
     brandName: string | null;
     metadata: Record<string, unknown> | null;
     sourceUrl: string | null;
   }): HarvestedSignals
   ```

2. **Parseo inteligente de la descripcion original** - el core de esta fase:

   ```typescript
   // Extraer composicion de materiales
   function extractMaterialComposition(description: string): string[] {
     // Patrones: "95% Algodon", "Material: Cuero", "Composicion: ...", "Fabric: ..."
     // Retorna: ["95% algodon", "5% elastano"]
   }

   // Extraer instrucciones de cuidado
   function extractCareInstructions(description: string): string[] {
     // Patrones: "Lavar a mano", "No usar secadora", "Care: ...", "Cuidado: ..."
   }

   // Extraer medidas/dimensiones
   function extractMeasurements(description: string): string[] {
     // Patrones: "Largo: 65cm", "Alto x Ancho", "Talla unica"
   }

   // Extraer features tecnicas
   function extractTechnicalFeatures(description: string): string[] {
     // Patrones: "Proteccion UV", "Impermeable", "Antibacterial", "Stretch"
   }

   // Limpiar descripcion a texto compacto util
   function cleanDescriptionForLLM(description: string): string {
     // 1. Quitar HTML tags
     // 2. Quitar bloques repetitivos (politicas de envio, FAQ, etc.)
     // 3. Quitar URLs y emails
     // 4. Quitar emojis
     // 5. Compactar espacios multiples
     // 6. Truncar a ~500 chars manteniendo oraciones completas
     // Retorna: texto limpio enfocado en la informacion del producto
   }
   ```

3. **Extraer senales de metadata por plataforma**:

   ```typescript
   function extractPlatformSignals(metadata: Record<string, unknown> | null): {
     vendorCategory: string | null;
     vendorTags: string[];
     ogTitle: string | null;
     ogDescription: string | null;
   } {
     if (!metadata) return { vendorCategory: null, vendorTags: [], ogTitle: null, ogDescription: null };

     // Shopify: product_type y tags
     const productType = metadata.product_type as string | null;
     const tags = Array.isArray(metadata.tags) ? metadata.tags : [];

     // Custom: meta tags
     const meta = metadata.meta as Record<string, string> | null;
     const ogTitle = meta?.["og:title"] ?? null;
     const ogDescription = meta?.["og:description"] ?? null;

     return { vendorCategory: productType, vendorTags: tags, ogTitle, ogDescription };
   }
   ```

4. **Reusar y extender los diccionarios del normalizer** (`normalizer.ts:246-507`):
   - Mover `CATEGORY_KEYWORDS`, `MATERIAL_RULES`, `PATTERN_RULES`, `GENDER_RULES` a un archivo compartido `keyword-dictionaries.ts`.
   - Agregar keywords adicionales que solo aplican al enrichment.
   - Ambos el normalizer y el signal-harvester importan del mismo diccionario.

5. **Inyectar senales estructuradas en el payload del LLM**:
   ```json
   {
     "product": { ... },
     "variants": [ ... ],
     "image_manifest": [ ... ],
     "signals": {
       "vendor_category": "Joyería",
       "vendor_tags": ["mujer", "aretes", "oro 18k"],
       "detected_product_type": "aretes",
       "detected_materials": ["oro 18k"],
       "detected_care": ["limpiar con pano suave"],
       "description_clean": "Aretes luna en oro 18k con piedra natural...",
       "signal_strength": "strong",
       "inferred_category": "joyeria_y_bisuteria",
       "conflicts": []
     }
   }
   ```

6. **Actualizar el prompt** para que use las senales explicitamente:
   ```
   En el campo "signals" del input encontraras senales pre-procesadas:
   - Si "vendor_category" existe, es la categoria asignada por el vendedor. Es una senal FUERTE.
   - Si "vendor_tags" existen, son tags del vendedor. Usarlos para reforzar clasificacion.
   - Si "detected_materials" tiene valores, son materiales extraidos de la descripcion original.
     Deben reflejarse en material_tags.
   - Si "description_clean" existe, usarlo como fuente primaria para la descripcion enriquecida.
   - Si "signal_strength" es "strong", confiar mas en las senales pre-procesadas.
   - Si "conflicts" no esta vacio, hay ambiguedad. Ser mas cauteloso y evaluar las imagenes.
   ```

**Archivos a crear/modificar**:
- Crear: `apps/web/src/lib/product-enrichment/signal-harvester.ts`
- Crear: `apps/web/src/lib/product-enrichment/description-parser.ts`
- Crear: `apps/web/src/lib/product-enrichment/keyword-dictionaries.ts` (extraido de normalizer.ts)
- Modificar: `openai.ts` - inyectar senales en el payload y actualizar prompt
- Modificar: `processor.ts` - invocar signal harvester antes de enrichment
- Modificar: `normalizer.ts` - importar diccionarios del archivo compartido

**Impacto**: Cero costo extra de LLM. Mejora inmediata porque el modelo recibe informacion estructurada en vez de tener que descubrirla solo. La llamada principal al LLM sigue siendo necesaria (genera descripcion, SEO, colores, fit, etc.), pero ahora recibe senales pre-procesadas que mejoran TODOS los outputs, no solo la clasificacion.

---

### Fase 1: Pre-clasificacion para seleccion de prompt (Route-to-Prompt)

**Objetivo**: Determinar la categoria probable del producto ANTES de la llamada principal al LLM, para poder seleccionar el prompt especializado (Fase 2). La llamada principal al LLM es SIEMPRE necesaria porque genera 13+ campos que no se pueden producir sin LLM.

**IMPORTANTE - Por que NO se puede saltar el LLM**:
El enrichment produce mucho mas que solo clasificacion. El LLM genera:
1. `description` - Descripcion nueva, limpia, en espanol neutro (texto generativo)
2. `category` + `subcategory` - Clasificacion
3. `style_tags` - EXACTAMENTE 10 tags de la taxonomia (seleccion inteligente)
4. `material_tags` (hasta 3), `pattern_tags` (hasta 2), `occasion_tags` (hasta 2)
5. `gender`, `season` - Clasificacion
6. `seo_title` - Max 70 chars, combina nombre + marca (texto generativo)
7. `seo_description` - 120-160 chars, espanol neutro, sin emojis (texto generativo)
8. `seo_tags` - 6-12 tags SEO en espanol (texto generativo)
9. Por cada variante: `color_hex` (1-3 #RRGGBB), `color_pantone` (1-3 TCX), `fit`

Estos campos requieren vision multimodal (colores de imagenes), generacion de texto (SEO), y comprension contextual (style tags). No se pueden producir con regex/keywords.

**Cambios**:
1. Crear funcion `routeToPromptGroup()` en `pre-classifier.ts`.
2. **Clasificacion deterministica** (sin LLM, solo para elegir prompt group):
   - Usa las senales de Fase 0 (signal harvester) para determinar el grupo de prompt.
   - Si `signals.signalStrength === "strong"` y `signals.inferredCategory` no es null:
     - Mapear categoria a prompt group directamente.
   - Si `signals.vendorCategory` (Shopify `product_type`) matchea la taxonomia:
     - Mapear a prompt group con alta confianza.
   - Si `signals.nameCategory` es clara (ej: "aretes" → joyeria):
     - Mapear a prompt group.
   - Si multiples senales coinciden (nombre + vendor + descripcion apuntan al mismo grupo):
     - `confidence = "high"`, usar prompt group directamente.

3. **Solo si deterministica es ambigua** (`signalStrength === "weak"` o conflictos):
   - Llamada LLM ligera (~100 tokens output) para clasificar.
   - Prompt minimalista con nombre + descripcion limpia + imagen cover.
   - Solo las 28 categorias con key y descripcion de 1 linea.
   ```
   Dado:
   - Nombre: "{name}"
   - Descripcion: "{description_clean}"
   - Vendor category: "{vendor_category}" (si existe)
   - Vendor tags: {vendor_tags}

   Clasifica en UNA categoria:
   { "category": "key", "confidence": 0.0-1.0, "candidates": ["key1", "key2"] }
   ```

4. **Logica de routing**:
   - `signalStrength === "strong"` → deterministic routing, sin LLM extra
   - `signalStrength === "moderate"` → deterministic routing, validar en post-procesamiento
   - `signalStrength === "weak"` → LLM pre-clasificacion, luego routing
   - Sin senales → fallback al prompt generico (como funciona hoy)

5. El resultado es SOLO el prompt group a usar. La llamada principal al LLM es siempre necesaria.

**Archivos a crear/modificar**:
- Crear: `apps/web/src/lib/product-enrichment/pre-classifier.ts`
- Modificar: `openai.ts` - usar prompt group para seleccionar prompt especializado
- Modificar: `processor.ts` - invocar routing antes de la llamada principal

**Impacto en costos**: La mayoria de productos se rutean sin LLM extra (deterministic routing). Solo los ambiguos (~20-30%) necesitan la llamada ligera de clasificacion (+~100 tokens). La llamada principal siempre ocurre pero con un prompt ~75% mas corto (menos tokens input = menos costo).

---

### Fase 2: Prompts especializados por grupo de categoria

**Objetivo**: Reemplazar el prompt unico con prompts especializados que solo incluyen la taxonomia y reglas relevantes para el grupo detectado.

**Cambios**:
1. Crear `prompt-templates.ts` con un mapa de category groups a prompt builders:

   | Grupo | Categorias incluidas | Enfasis del prompt | Descripcion: que buscar |
   |-------|---------------------|-------------------|------------------------|
   | `prendas_superiores` | camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres | Fit, silueta, material textil, manga | Composicion textil, tipo de manga, cuello |
   | `prendas_exteriores` | chaquetas_y_abrigos, blazers_y_sastreria | Estructura, forro, largo, formalidad | Tipo de forro, impermeabilidad, peso |
   | `prendas_inferiores` | pantalones_no_denim, jeans_y_denim, shorts_y_bermudas, faldas | Tiro, largo, denim vs no-denim | Composicion, tipo de tela, stretch |
   | `prendas_completas` | vestidos, enterizos_y_overoles, conjuntos_y_sets | Pieza unica vs multi-pieza, largo, ocasion | Tipo de cierre, forro, largo exacto |
   | `ropa_tecnica` | ropa_deportiva, ropa_interior, lenceria_y_fajas, pijamas, trajes_de_bano | Funcionalidad, performance, comodidad | Features tecnicas (UV, stretch, breathable) |
   | `ropa_especial` | ropa_de_bebe, uniformes_y_ropa_de_trabajo | Talla especial, regulaciones | Rango de edad, normativas, seguridad |
   | `calzado` | calzado | Tipo de suela, material, altura, horma | Material suela, tipo cierre, plantilla |
   | `accesorios_textiles` | accesorios_textiles_y_medias | Tipo de textil, uso, estacion | Composicion, talla (si aplica) |
   | `bolsos` | bolsos_y_marroquineria | Tamano, material (cuero/sintetico), compartimentos | Dimensiones, material, tipo cierre |
   | `joyeria` | joyeria_y_bisuteria | Metal, piedras, tipo de pieza, banado | Quilates, tipo de bano, piedra natural vs sintetica |
   | `gafas` | gafas_y_optica | Tipo de lente, forma, material montura | Proteccion UV, polarizado, material lente |
   | `hogar_lifestyle` | hogar_y_lifestyle, tarjeta_regalo | Funcion, material, uso domestico | Dimensiones, material, mantenimiento |

2. **Cada prompt especializado incluye instrucciones de como usar la descripcion original**:

   ```
   # Para grupo "joyeria":
   En la descripcion original busca:
   - Tipo de metal y quilates (ej: "oro 18k", "plata 925", "acero quirurgico")
   - Si es banado/chapado o macizo (ej: "banado en oro", "gold filled", "gold plated")
   - Tipo de piedra (ej: "circonia", "cristal Swarovski", "piedra natural", "cuarzo")
   - Tecnica (ej: "filigrana", "tejido", "artesanal", "hecho a mano")
   - Si es set o pieza individual
   Estos detalles del texto/descripcion son MAS confiables que la imagen para material.

   # Para grupo "prendas_superiores":
   En la descripcion original busca:
   - Composicion exacta (ej: "95% algodon, 5% elastano")
   - Tipo de manga (ej: "manga corta", "sin mangas", "manga 3/4")
   - Tipo de cuello (ej: "cuello V", "cuello redondo", "cuello alto")
   - Instrucciones de cuidado → pista de material (ej: "lavar en frio" = tela delicada)
   ```

3. Solo incluir taxonomia relevante al grupo (reduccion de ~75% del prompt).

4. Mantener `buildPrompt()` original como fallback cuando no hay pre-clasificacion.

**Archivos a crear/modificar**:
- Crear: `apps/web/src/lib/product-enrichment/prompt-templates.ts`
- Crear: `apps/web/src/lib/product-enrichment/category-groups.ts`
- Modificar: `openai.ts` - `buildPrompt` recibe grupo y filtra taxonomia
- Modificar: `constants.ts` - agregar metadata de grupo por categoria

---

### Fase 3: Extraccion inteligente de senales del nombre

**Objetivo**: Parsear el nombre del producto antes del LLM para extraer senales que guien la clasificacion.

**Nota**: Esta fase se fusiona parcialmente con la Fase 0 (signal harvester), pero aqui se detalla la logica especifica del nombre.

**Cambios**:
1. Dentro de `signal-harvester.ts`, la funcion `extractNameSignals()`:

   ```typescript
   type NameSignals = {
     detectedCategory: string | null;
     detectedSubcategory: string | null;
     detectedGender: string | null;
     detectedMaterial: string | null;
     productType: string | null;           // "aretes", "jean", "vestido"
     brandInName: boolean;
     keywords: string[];
   };
   ```

2. **Reusar los diccionarios del normalizer** (ya movidos a `keyword-dictionaries.ts` en Fase 0):
   - `CATEGORY_KEYWORDS` del normalizer.ts (lineas 246-507) con ~120 keywords.
   - Agregar keywords que el normalizer no tiene pero que aparecen en nombres de productos colombianos:
     - "top" → camisetas_y_tops
     - "jogger" → pantalones_no_denim
     - "croptop" (junto) → camisetas_y_tops
     - "palazzo" → pantalones_no_denim
     - "overall" → enterizos_y_overoles
     - "sneaker" → calzado
     - "loafer" → calzado

3. **Desambiguacion de falsos positivos conocidos**:
   - "collar" de camisa vs "collar" de joyeria → si contexto tiene "camisa"/"blusa", ignorar como joyeria.
   - "bota" de pantalon vs "bota" de calzado → reusar la logica `looksLikePantsBotaFit()` del normalizer (linea 558).
   - "body" como bodysuit vs "body" como body cream → si contexto tiene "crema"/"splash", no es prenda.

4. Inyectar senales al payload como parte de `signals` (definido en Fase 0).

**Archivos a crear/modificar**:
- Los mismos de Fase 0 (logica integrada en signal-harvester.ts)
- Modificar: `keyword-dictionaries.ts` - agregar keywords adicionales

---

### Fase 4: Uso inteligente de imagenes por categoria

**Objetivo**: Adaptar como se envian y como se interpretan las imagenes segun el tipo de producto pre-clasificado.

**Cambios**:
1. **Instrucciones de imagen especificas por grupo** (en `prompt-templates.ts`):

   | Grupo | Instrucciones de imagen | Que dice la descripcion que la imagen NO puede |
   |-------|------------------------|-----------------------------------------------|
   | `joyeria` | "Usa la imagen para: tipo de metal (color dorado=oro, plateado=plata), tipo de piedra, tecnica. La imagen es CRITICA para color y forma en joyeria." | "Quilates exactos, si es banado o macizo, tipo de piedra especifica" |
   | `calzado` | "Usa la imagen para: tipo de suela, altura tacon, forma punta, tipo cierre." | "Material exacto (cuero real vs sintetico), talla, plantilla" |
   | `prendas_superiores` | "Usa la imagen para: fit (ajustado/suelto/oversize), largo manga, tipo cuello, patron visible." | "Composicion exacta, instrucciones cuidado" |
   | `bolsos` | "Usa la imagen para: tamano relativo, tipo cierre, forma, material principal." | "Dimensiones exactas, compartimentos internos" |
   | `prendas_inferiores` | "Usa la imagen para: tiro (alto/medio/bajo), largo, ancho bota, lavado denim." | "Composicion, stretch %, tipo de cierre" |

2. **Regla diferenciada imagen vs texto por grupo**:
   ```
   # Para joyeria:
   - Color/forma: LA IMAGEN MANDA (el texto no siempre describe colores)
   - Material: EL TEXTO MANDA (la imagen no distingue oro 18k de banado)
   - Subcategoria: COMBINAR (imagen muestra tipo, texto confirma)

   # Para ropa:
   - Categoria/subcategoria: EL TEXTO MANDA (la imagen puede confundir top con vestido si solo se ve torso)
   - Fit: LA IMAGEN MANDA (la imagen muestra el calce real)
   - Color: LA IMAGEN MANDA
   - Material: EL TEXTO MANDA (la descripcion tiene composicion exacta)
   ```

3. **Ajustar cantidad de imagenes por grupo** via `selectImagesForCategory()`:
   - Joyeria: max 4 imagenes (close-ups son mas utiles)
   - Calzado: max 4 imagenes
   - Ropa: max 6 imagenes (frente, espalda, detalle)
   - Bolsos: max 4 imagenes

**Archivos a crear/modificar**:
- Modificar: `prompt-templates.ts` (de Fase 2) - instrucciones de imagen por grupo
- Crear: `apps/web/src/lib/product-enrichment/image-strategy.ts`
- Modificar: `openai.ts` - logica de seleccion de imagenes adaptativa

---

### Fase 5: Score de confianza y metricas

**Objetivo**: Agregar confianza a cada enrichment y rastrear accuracy.

**Cambios**:
1. Agregar campo `confidence` al schema de respuesta del LLM:
   ```json
   {
     "product": {
       "confidence": {
         "category": 0.95,
         "subcategory": 0.85,
         "overall": 0.90
       },
       ...
     }
   }
   ```

2. Agregar instruccion al prompt:
   ```
   Incluye un campo "confidence" con scores 0.0-1.0 para:
   - category: que tan seguro estas de la categoria
   - subcategory: que tan seguro estas de la subcategoria
   - overall: confianza general del enriquecimiento
   Baja el score si:
   - Las senales pre-procesadas se contradicen entre si
   - La imagen no corresponde claramente con el texto
   - El producto es ambiguo (ej: "set" podria ser conjunto o joyeria)
   - La descripcion no tiene informacion suficiente
   ```

3. Almacenar confianza en `metadata.enrichment.confidence` y en `metadata.enrichment.signals_used` (que senales se usaron para clasificar).

4. En el admin panel, mostrar:
   - Distribucion de confidence scores por run
   - Flag para productos con `confidence.overall < 0.7` para revision manual
   - Breakdown por `signal_strength` (strong/moderate/weak) vs accuracy

5. Agregar endpoint para "re-enriquecer productos de baja confianza".

**Archivos a crear/modificar**:
- Modificar: `openai.ts` - schema y prompt para confidence
- Modificar: `processor.ts` - almacenar confidence en metadata
- Modificar: `ProductEnrichmentPanel.tsx` - mostrar metricas de confianza

---

### Fase 6: Validacion cruzada y consistency check

**Objetivo**: Detectar y corregir inconsistencias entre nombre + descripcion + imagen + clasificacion LLM.

**Cambios**:
1. Crear `consistency-validator.ts` con validacion post-LLM:
   ```typescript
   function validateEnrichmentConsistency(
     signals: HarvestedSignals,
     enriched: EnrichedProduct,
     preClassification: PreClassificationResult | null
   ): {
     isConsistent: boolean;
     issues: Array<{
       field: string;
       severity: "error" | "warning";
       message: string;
       suggestion: string;
     }>;
     autoFixes: Array<{ field: string; from: string; to: string }>;
   }
   ```

2. **Reglas de consistencia basadas en descripcion + nombre + metadata**:

   | Regla | Ejemplo | Accion |
   |-------|---------|--------|
   | Nombre dice "aretes" pero LLM clasifico como "camiseta" | `nameSignals.nameCategory !== enriched.category` | Error: retry con senales reforzadas |
   | Descripcion dice "95% algodon" pero LLM puso material "cuero" | `descriptionMaterials` vs `materialTags` | Warning: autofix con material de descripcion |
   | Vendor tags dicen "joyeria" pero LLM dice "accesorios textiles" | `vendorCategory` vs `enriched.category` | Error: retry con vendor category como hint fuerte |
   | Descripcion dice "banado en oro" pero LLM puso material "oro" | Material ambiguedad banado vs macizo | Warning: flag para review |
   | Joyeria con material "algodon" | Category-material mismatch | Error: autofix |
   | Calzado con material "seda" | Category-material mismatch | Warning: flag |
   | Descripcion vacia + imagen confusa | Sin senales suficientes | Bajar confidence score |

3. **AutoFix logic**:
   - Si la descripcion tiene composicion de materiales explicita y el LLM dio materiales distintos, usar los de la descripcion.
   - Si el nombre tiene subcategoria clara ("Aretes argolla") y el LLM dio otra subcategoria de la misma categoria, usar la del nombre.
   - Si el vendor_category matchea una categoria de taxonomia y el LLM dio otra, re-evaluar.

4. Si hay inconsistencia grave:
   - Retry con prompt reforzado que incluya la inconsistencia detectada:
     ```
     ATENCION: En un intento previo clasificaste este producto como "{previous_category}"
     pero el nombre dice "{name}" y los tags del vendor dicen "{vendor_tags}".
     Re-evalua tu clasificacion considerando esta discrepancia.
     ```
   - Si persiste en 2 retries, marcar con `confidence.override_needed = true`.

**Archivos a crear/modificar**:
- Crear: `apps/web/src/lib/product-enrichment/consistency-validator.ts`
- Modificar: `openai.ts` - agregar paso de validacion post-LLM
- Modificar: `processor.ts` - retry logic basado en validacion

---

### Fase 7: Preservar descripcion original para re-enrichment

**Objetivo**: Almacenar la descripcion original sin procesar para que futuros re-enrichments tengan acceso a la informacion completa.

**Problema actual**: Cuando el enrichment sobreescribe `product.description` con la descripcion generada por el LLM (linea 201 en processor.ts), se pierde la descripcion original del scraping para siempre. Si re-enriquecemos, el LLM recibe su propia descripcion previa en vez de la original.

**Cambios**:
1. Al hacer enrichment, guardar la descripcion original en metadata:
   ```typescript
   // En processor.ts, antes de actualizar el producto:
   const originalDescription = item.product.description;
   const enrichmentMetadata = item.product.metadata?.enrichment;
   const isFirstEnrichment = !enrichmentMetadata?.completed_at;

   metadata: {
     enrichment: {
       ...existingEnrichment,
       original_description: isFirstEnrichment
         ? originalDescription
         : existingEnrichment.original_description ?? originalDescription,
     }
   }
   ```

2. Al enriquecer, si existe `metadata.enrichment.original_description`, usar esa en vez de `product.description` para las senales:
   ```typescript
   // En signal-harvester.ts:
   const descriptionForSignals =
     metadata?.enrichment?.original_description ?? product.description;
   ```

3. Tambien preservar la metadata original del scraping:
   ```typescript
   metadata: {
     enrichment: {
       original_description: "...",
       original_vendor_tags: ["mujer", "aretes", "oro 18k"],
       original_product_type: "Joyería",
     }
   }
   ```

**Archivos a modificar**:
- Modificar: `processor.ts` - preservar descripcion original en metadata
- Modificar: `signal-harvester.ts` - preferir descripcion original cuando exista
- Modificar: `openai.ts` - usar descripcion original para el payload

---

## Orden de Implementacion Recomendado

```
Fase 0 (Signal Harvesting)     ← Fundacion: parseo de descripcion + metadata + nombre
  |                               Sin costo LLM, impacto inmediato
  v
Fase 7 (Preservar desc.)       ← Protege datos para re-enrichment futuro
  |                               Cambio minimo, previene perdida de datos
  v
Fase 3 (Name Signals)          ← Integrado en Fase 0, detalla logica de nombre
  |                               Reusar keyword dicts del normalizer
  v
Fase 1 (Route-to-Prompt)       ← Routing deterministico + LLM ligero solo si ambiguo
  |                               Elige prompt group; LLM principal SIEMPRE se ejecuta
  v
Fase 2 (Prompts por grupo)     ← El cambio core, requiere Fases 0-1
  |                               Prompts 75% mas cortos y especificos
  v
Fase 4 (Imagenes por cat.)     ← Refina calidad, depende de Fase 2
  |
  v
Fase 5 (Confidence scores)     ← Metricas para medir impacto
  |
  v
Fase 6 (Validacion cruzada)    ← Polish final con autofix
```

### Por que este orden?
- **Fase 0 primero**: Es el fundamento. Parsear descripcion + metadata + nombre sin costo LLM extra. Da el mayor ROI inmediato porque convierte datos "sueltos" en senales estructuradas. El modelo ya no tiene que "adivinar" materiales que estan escritos en la descripcion.
- **Fase 7 temprano**: Minimo esfuerzo, maxima proteccion. Sin esto, cada re-enrichment pierde informacion.
- **Fase 3 integrada con 0**: La logica de nombre es parte del signal harvester.
- **Fase 1 despues**: Con senales harvested, la mayoria de productos se rutean al prompt group correcto sin LLM extra. La llamada principal al LLM siempre ocurre (genera descripcion, SEO, colores, fit, style_tags, etc.), pero recibe un prompt 75% mas corto.
- **Fase 2 es el core**: Prompts especializados son el cambio estructural, pero necesitan las fases anteriores.
- **Fases 4-6 son refinamiento**: Cada una mejora incrementalmente la calidad.

---

## Impacto en Versionado

- Prompt version actual: `v11`
  - Fase 0+7: `v12` (signal injection + metadata preservation)
  - Fase 1+2: `v13` (pre-classification + specialized prompts)
  - Fase 4: `v14` (category-aware images)
- Schema version actual: `v5`
  - Fase 5: `v6` (confidence scores)
  - Fase 6: `v7` (consistency metadata)
- Cada fase es backwards-compatible: productos enriquecidos con v11 siguen siendo validos

---

## Riesgos y Mitigaciones

| Riesgo | Mitigacion |
|--------|-----------|
| Descripcion original contiene HTML basura | `cleanDescriptionForLLM()` filtra agresivamente. Regex probados contra 1000+ descripciones reales |
| Shopify product_type es inconsistente entre marcas | Mapeo fuzzy con `normalizeEnumValue()`, nunca confiar ciegamente |
| Signal harvester tiene falsos positivos | El signal_strength field indica confianza. "weak" signals solo se usan como hint, no como verdad |
| Routing deterministico elige prompt group incorrecto | El LLM principal siempre valida/corrige. Peor caso: misma calidad que hoy (prompt generico como fallback). Fase 6 detecta inconsistencias post-LLM |
| Prompts especializados son mas prompts que mantener | Template base + overrides. Un solo `buildSpecializedPrompt()` con parametros por grupo |
| "collar" de camisa vs "collar" de joyeria | Desambiguacion por contexto: si el nombre tiene "camisa" o "blusa", no es joyeria |
| Re-enrichment pierde descripcion original | Fase 7 preserva en metadata.enrichment.original_description |
| Mayor complejidad en el pipeline | Cada fase es independiente y puede desactivarse con feature flags (env vars) |

---

## Metricas de Exito

1. **Accuracy de categoria**: >95% (actualmente estimado ~85-90%)
2. **Accuracy de subcategoria**: >90% (actualmente estimado ~75-80%)
3. **Tasa de retry por errores de clasificacion**: <3% (actualmente ~8-10%)
4. **Confidence score promedio**: >0.88 para >85% de productos
5. **Costo LLM por producto**: Debe REDUCIRSE ~20-30% porque prompts especializados son ~75% mas cortos (menos tokens input). Solo ~20-30% de productos ambiguos necesitan la llamada extra de pre-clasificacion (~100 tokens)
6. **Material accuracy**: >95% cuando la descripcion tiene composicion (actualmente no medido)
7. **Vendor signal utilization**: >90% de productos Shopify usan product_type en la clasificacion

---

## Ejemplo End-to-End: "Aretes Luna Oro 18K"

**Input**:
- `name`: "Aretes Luna Oro 18K"
- `description`: "<p>Hermosos aretes de luna en <b>oro 18K</b> con piedra de circonia. Ideales para regalar.</p><ul><li>Material: Oro 18 kilates</li><li>Piedra: Circonia cubica</li><li>Cierre: Push back</li><li>Peso: 2.1g por par</li></ul><p>Envio gratis a toda Colombia.</p>"
- `imageCoverUrl`: "https://cdn.../aretes-luna.jpg"
- `metadata`: `{ "platform": "shopify", "product_type": "Joyería", "tags": ["mujer", "aretes", "oro 18k", "regalo"] }`

**Fase 0 - Signal Harvesting**:
```json
{
  "nameKeywords": ["aretes", "luna", "oro", "18k"],
  "nameCategory": "joyeria_y_bisuteria",
  "nameSubcategory": "aretes_pendientes",
  "nameProductType": "aretes",
  "descriptionMaterials": ["oro 18 kilates", "circonia cubica"],
  "descriptionCare": [],
  "descriptionFeatures": ["cierre push back", "peso 2.1g"],
  "descriptionCleanText": "Hermosos aretes de luna en oro 18K con piedra de circonia. Ideales para regalar. Material: Oro 18 kilates. Piedra: Circonia cubica. Cierre: Push back. Peso: 2.1g por par.",
  "vendorCategory": "Joyería",
  "vendorTags": ["mujer", "aretes", "oro 18k", "regalo"],
  "inferredCategory": "joyeria_y_bisuteria",
  "inferredMaterials": ["oro"],
  "signalStrength": "strong",
  "conflictingSignals": []
}
```

**Fase 1 - Route-to-Prompt (deterministic, sin LLM extra)**:
- `signalStrength === "strong"` + `inferredCategory === "joyeria_y_bisuteria"` → Routing deterministico al grupo `joyeria`.
- No se necesita LLM de pre-clasificacion. Todas las senales apuntan a joyeria.

**Fase 2 - Prompt Especializado (grupo: joyeria) + llamada principal al LLM**:
- Prompt recortado: solo subcategorias de joyeria (10 vs 200+)
- Instrucciones especificas: "Busca quilates, tipo de bano, piedra en la descripcion"
- Solo materials relevantes: oro, plata, bronce, cobre, acero
- Solo 4 imagenes
- El LLM recibe las senales harvested y genera TODOS los campos:

**Resultado final del LLM (todos los campos, no solo clasificacion)**:
```json
{
  "product": {
    "description": "Aretes de luna en oro 18K con piedra de circonia cubica. Cierre push back. Peso 2.1g por par. Ideales como regalo.",
    "category": "joyeria_y_bisuteria",
    "subcategory": "aretes_pendientes",
    "style_tags": ["elegante", "minimalista", "femenino", "delicado", "romantico", "moderno", "sofisticado", "versatil", "clasico", "chic"],
    "material_tags": ["oro", "circonia"],
    "pattern_tags": ["liso"],
    "occasion_tags": ["regalo", "diario"],
    "gender": "femenino",
    "season": "todo_el_ano",
    "seo_title": "Aretes Luna Oro 18K con Circonia | MarcaXYZ",
    "seo_description": "Aretes de luna en oro 18 kilates con piedra de circonia cubica. Cierre push back, peso 2.1g. Envio gratis a toda Colombia.",
    "seo_tags": ["aretes oro 18k", "aretes luna", "joyeria colombiana", "aretes circonia", "regalo mujer", "aretes elegantes"],
    "variants": [
      {
        "variant_id": "abc123",
        "color_hex": "#FFD700",
        "color_pantone": "16-0836",
        "fit": "no_aplica"
      }
    ],
    "confidence": { "category": 0.99, "subcategory": 0.98, "overall": 0.97 }
  }
}
```

**Mejora vs. hoy**: Con el prompt generico actual, el modelo:
- Podria clasificar material como "otro" en vez de "oro" (no sabe que buscar en la descripcion)
- Genera seo_description generico sin los detalles de quilates y piedra
- Los style_tags serian genericos en vez de enfocados en joyeria
- La descripcion enriquecida podria perder "cierre push back" y "peso 2.1g" (datos que estaban en la descripcion original HTML)
- Ahora, con senales harvested, el LLM recibe `detected_materials: ["oro 18 kilates", "circonia cubica"]` y los refleja correctamente en TODOS los outputs.
