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

### Problemas identificados
1. **Prompt bloat**: ~100 lineas de instrucciones + toda la taxonomia. El modelo tiene que procesar informacion irrelevante (ej: reglas de calzado cuando procesa joyeria).
2. **Sin especializacion por categoria**: Un collar y un jean reciben las mismas instrucciones de enriquecimiento.
3. **Nombre del producto sub-utilizado**: El nombre es la senal mas fuerte, pero no hay extraccion de senales previas ni patron matching.
4. **Imagen sin contexto categorico**: Para joyeria, la imagen es critica (material, tipo de pieza). Para ropa, importa mas el fit y silhouette. Actualmente se tratan igual.
5. **Sin score de confianza**: No hay forma de saber si el modelo esta "seguro" de su clasificacion vs. adivinando.
6. **Subcategoria erronea frecuente**: Al presentar todas las subcategorias juntas, el modelo puede confundir subcategorias entre categorias.

---

## Plan de Implementacion

### Fase 1: Pre-clasificacion ligera (Two-Stage Enrichment)

**Objetivo**: Antes de enriquecer, determinar la categoria probable del producto usando senales rapidas.

**Cambios**:
1. Crear funcion `preClassifyProduct(name, imageCoverUrl, description?)` en un nuevo archivo `pre-classifier.ts`.
2. Esta funcion hace una llamada ligera al LLM (modelo rapido, `gpt-5-mini` con max_tokens ~100) con un prompt minimalista:
   ```
   Dado el nombre de producto "{name}" y la imagen adjunta,
   clasifica en UNA de estas categorias: [lista compacta de las 28 categorias con key y descripcion corta].
   Devuelve JSON: { "category": "key", "confidence": 0.0-1.0, "candidates": ["key1", "key2"] }
   ```
3. Incluir la imagen de cover como input visual.
4. La respuesta incluye:
   - `category`: categoria principal predicha
   - `confidence`: score 0-1
   - `candidates`: top 2-3 categorias alternativas (para el prompt especializado)
5. Si `confidence < 0.7`, pasar las `candidates` al prompt de enriquecimiento para que considere multiples opciones.

**Archivos a modificar/crear**:
- Crear: `apps/web/src/lib/product-enrichment/pre-classifier.ts`
- Modificar: `openai.ts` - invocar pre-clasificador antes del enriquecimiento principal
- Modificar: `processor.ts` - pasar resultado de pre-clasificacion al enrichment

**Impacto en costos**: +1 llamada LLM ligera por producto (~100 tokens output). Se compensa con prompts principales mas cortos y menos retries por errores de clasificacion.

---

### Fase 2: Prompts especializados por grupo de categoria

**Objetivo**: Reemplazar el prompt unico con prompts especializados que solo incluyen la taxonomia y reglas relevantes.

**Cambios**:
1. Crear archivo `prompt-templates.ts` con un mapa de category groups a prompt builders:

   | Grupo | Categorias incluidas | Enfasis del prompt |
   |-------|---------------------|-------------------|
   | `prendas_superiores` | camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres | Fit, silueta, material textil, manga |
   | `prendas_exteriores` | chaquetas_y_abrigos, blazers_y_sastreria | Estructura, forro, largo, formalidad |
   | `prendas_inferiores` | pantalones_no_denim, jeans_y_denim, shorts_y_bermudas, faldas | Tiro, largo, denim vs no-denim |
   | `prendas_completas` | vestidos, enterizos_y_overoles, conjuntos_y_sets | Pieza unica vs multi-pieza, largo, ocasion |
   | `ropa_tecnica` | ropa_deportiva, ropa_interior, lenceria_y_fajas, pijamas_y_loungewear, trajes_de_bano | Funcionalidad, performance, comodidad |
   | `ropa_especial` | ropa_de_bebe, uniformes_y_ropa_de_trabajo | Talla especial, regulaciones, seguridad |
   | `calzado` | calzado | Tipo de suela, material, altura, horma |
   | `accesorios_textiles` | accesorios_textiles_y_medias | Tipo de textil, uso, estacion |
   | `bolsos` | bolsos_y_marroquineria | Tamano, material (cuero/sintetico), compartimentos |
   | `joyeria` | joyeria_y_bisuteria | Metal, piedras, tipo de pieza, banado |
   | `gafas` | gafas_y_optica | Tipo de lente, forma, material montura |
   | `hogar_lifestyle` | hogar_y_lifestyle, tarjeta_regalo | Funcion, material, uso domestico |

2. Cada grupo tiene su propio `buildSpecializedPrompt(category, taxonomy)` que:
   - Solo lista las subcategorias de las categorias del grupo
   - Solo lista style_tags, material_tags, pattern_tags relevantes al grupo
   - Incluye reglas de clasificacion especificas (ej: para joyeria, reglas de "si dice aretes -> aretes/pendientes")
   - Incluye instrucciones de imagen especificas al grupo

3. Mantener `buildPrompt()` como fallback para cuando no hay pre-clasificacion o confidence es muy baja.

4. Estructura del prompt especializado:
   ```
   [Contexto general - mas corto, ~10 lineas]
   [Reglas especificas del grupo - ~15-20 lineas]
   [Taxonomia filtrada - solo categorias/subs del grupo]
   [Style tags filtrados - solo los relevantes]
   [Material/Pattern/Occasion filtrados]
   [Instrucciones de imagen especificas del grupo]
   [Schema JSON - igual que hoy]
   ```

**Archivos a modificar/crear**:
- Crear: `apps/web/src/lib/product-enrichment/prompt-templates.ts`
- Crear: `apps/web/src/lib/product-enrichment/category-groups.ts` (mapeo de categorias a grupos)
- Modificar: `openai.ts` - `buildPrompt` recibe grupo y filtra taxonomia
- Modificar: `constants.ts` - agregar metadata de grupo por categoria

---

### Fase 3: Extraccion inteligente de senales del nombre de producto

**Objetivo**: Parsear el nombre del producto antes del LLM para extraer senales que guien la clasificacion.

**Cambios**:
1. Crear `name-signals.ts` con funciones de extraccion:
   ```typescript
   type NameSignals = {
     detectedCategory: string | null;      // "joyeria_y_bisuteria"
     detectedSubcategory: string | null;   // "aretes_pendientes"
     detectedGender: string | null;        // "femenino"
     detectedMaterial: string | null;       // "oro"
     productType: string | null;           // "aretes"
     brandInName: boolean;                 // si se detecta marca en el nombre
     keywords: string[];                   // tokens relevantes extraidos
   };

   function extractNameSignals(name: string, brandName?: string): NameSignals
   ```

2. Crear diccionarios de senales:
   ```typescript
   const CATEGORY_KEYWORDS: Record<string, { category: string; subcategory?: string }[]> = {
     "arete": [{ category: "joyeria_y_bisuteria", subcategory: "aretes_pendientes" }],
     "pendiente": [{ category: "joyeria_y_bisuteria", subcategory: "aretes_pendientes" }],
     "collar": [{ category: "joyeria_y_bisuteria", subcategory: "collares" }],
     "tenis": [{ category: "calzado", subcategory: "tenis_sneakers" }],
     "jean": [{ category: "jeans_y_denim" }],
     "bikini": [{ category: "trajes_de_bano_y_playa", subcategory: "bikini" }],
     "bolso": [{ category: "bolsos_y_marroquineria" }],
     "vestido": [{ category: "vestidos" }],
     // ... ~100+ entradas cubriendo los nombres comunes en espanol colombiano
   };
   ```

3. Estas senales se inyectan al prompt como contexto adicional:
   ```
   Senales detectadas del nombre:
   - Tipo de producto: "aretes"
   - Categoria probable: "joyeria_y_bisuteria"
   - Material detectado: "oro"
   Usa estas senales como REFUERZO, no como verdad absoluta.
   ```

4. Las senales tambien alimentan la seleccion del grupo de prompt (Fase 2) y el pre-clasificador (Fase 1).

**Archivos a modificar/crear**:
- Crear: `apps/web/src/lib/product-enrichment/name-signals.ts`
- Modificar: `openai.ts` - inyectar senales en el payload del usuario
- Modificar: `processor.ts` - extraer senales antes de llamar a enrichment

---

### Fase 4: Uso inteligente de imagenes por categoria

**Objetivo**: Adaptar como se envian y como se interpretan las imagenes segun el tipo de producto.

**Cambios**:
1. Modificar instrucciones de imagen en cada prompt especializado:

   | Grupo | Instrucciones de imagen |
   |-------|------------------------|
   | `joyeria` | "Usa la imagen para determinar: tipo de metal (dorado=oro, plateado=plata), tipo de piedra, tecnica (filigrana, engaste). La imagen es CRITICA para material en joyeria." |
   | `calzado` | "Usa la imagen para determinar: tipo de suela, altura del tacon, material (cuero vs sintetico), tipo de cierre. Prioriza la forma general del zapato." |
   | `prendas_superiores` | "Usa la imagen para determinar: fit (ajustado/suelto/oversize), largo de manga, tipo de cuello, patron/estampado." |
   | `bolsos` | "Usa la imagen para determinar: tamano relativo, tipo de cierre, material principal, tipo de correa." |
   | `prendas_inferiores` | "Usa la imagen para determinar: tiro (alto/medio/bajo), largo, ancho de bota, tipo de lavado (si es denim)." |

2. Ajustar seleccion de imagenes por grupo:
   - **Joyeria**: Priorizar imagenes de close-up, max 4 imagenes
   - **Calzado**: Priorizar vista lateral y frontal, max 4 imagenes
   - **Ropa**: Priorizar imagen con modelo, max 6 imagenes
   - **Bolsos**: Priorizar imagen frontal y abierta, max 4 imagenes

3. Crear funcion `selectImagesForCategory(images, category)` que priorice imagenes segun el grupo.

4. Permitir que la imagen MANDE sobre el texto en casos especificos:
   - **Color**: La imagen siempre manda (ya funciona asi)
   - **Joyeria - material**: Si la imagen muestra claramente oro/plata, usar eso aunque el nombre no lo diga
   - **Calzado - tipo**: Si la imagen muestra claramente un tacon, reforzar clasificacion

**Archivos a modificar/crear**:
- Modificar: `prompt-templates.ts` (de Fase 2) - instrucciones de imagen por grupo
- Modificar: `openai.ts` - logica de seleccion de imagenes adaptativa
- Crear: `apps/web/src/lib/product-enrichment/image-strategy.ts`

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
   Si hay ambiguedad o senales contradictorias, baja el score.
   ```

3. Almacenar confianza en `metadata.enrichment.confidence`.

4. En el admin panel, mostrar:
   - Distribucion de confidence scores por run
   - Flag para productos con `confidence.overall < 0.7` para revision manual
   - Metricas de accuracy comparando pre-clasificacion vs clasificacion final

5. Agregar endpoint para "re-enriquecer productos de baja confianza".

**Archivos a modificar/crear**:
- Modificar: `openai.ts` - schema y prompt para confidence
- Modificar: `processor.ts` - almacenar confidence en metadata
- Modificar: `ProductEnrichmentPanel.tsx` - mostrar metricas de confianza
- Modificar: Prisma schema o metadata JSON para almacenar confidence

---

### Fase 6: Validacion cruzada nombre-imagen-clasificacion

**Objetivo**: Detectar y corregir inconsistencias entre lo que dice el nombre, lo que muestra la imagen y lo que clasifica el modelo.

**Cambios**:
1. Post-procesamiento de validacion despues de recibir la respuesta del LLM:
   ```typescript
   function validateEnrichmentConsistency(
     nameSignals: NameSignals,
     enriched: EnrichedProduct,
     preClassification: PreClassificationResult
   ): ValidationResult {
     // Verificar que la categoria del enrichment coincide con name signals
     // Verificar que subcategoria pertenece a la categoria
     // Verificar que materials hacen sentido para la categoria
     // Flag inconsistencias
   }
   ```

2. Si hay inconsistencia grave (ej: nombre dice "aretes" pero modelo clasifica como "camiseta"):
   - Retry con prompt reforzado que incluya la inconsistencia detectada
   - Si persiste, marcar con `confidence.override_needed = true`

3. Reglas de consistencia:
   - `joyeria`: material debe ser metal/piedra, no algodon/poliester
   - `calzado`: material debe ser cuero/sintetico/textil, no seda/tul
   - `denim`: material debe incluir denim, no lino/seda
   - Si name signal tiene subcategoria y el modelo da otra de la MISMA categoria, preferir la del name signal

**Archivos a modificar/crear**:
- Crear: `apps/web/src/lib/product-enrichment/consistency-validator.ts`
- Modificar: `openai.ts` - agregar paso de validacion post-LLM
- Modificar: `processor.ts` - retry logic basado en validacion

---

## Orden de Implementacion Recomendado

```
Fase 3 (Name Signals)         ← Bajo riesgo, impacto inmediato en clasificacion
  |
  v
Fase 1 (Pre-clasificacion)    ← Habilita la seleccion de prompts especializados
  |
  v
Fase 2 (Prompts por grupo)    ← El cambio mas grande, requiere fases 1 y 3
  |
  v
Fase 4 (Imagenes por cat.)    ← Refina la calidad, depende de fase 2
  |
  v
Fase 5 (Confidence scores)    ← Metricas para medir el impacto
  |
  v
Fase 6 (Validacion cruzada)   ← Polish final, depende de todas las anteriores
```

### Por que este orden?
- **Fase 3 primero**: Es el cambio mas simple y de mayor ROI. Parsear el nombre para extraer senales no requiere llamadas extra al LLM y mejora inmediatamente la clasificacion.
- **Fase 1 despues**: Una vez tenemos name signals, el pre-clasificador puede usarlas para ser mas preciso.
- **Fase 2 es el core**: Los prompts especializados son el cambio estructural mas importante, pero necesitan las fases anteriores para saber que prompt usar.
- **Fases 4-6 son refinamiento**: Cada una mejora incrementalmente la calidad.

---

## Impacto en Versionado

- Prompt version actual: `v11` → La Fase 3 seria `v12`, Fase 1+2 seria `v13`
- Schema version actual: `v5` → La Fase 5 (confidence) seria `v6`
- Cada fase debe ser backwards-compatible: productos enriquecidos con v11 siguen siendo validos

---

## Riesgos y Mitigaciones

| Riesgo | Mitigacion |
|--------|-----------|
| Pre-clasificacion agrega latencia | Usar modelo rapido, cache de name signals, paralelizar donde sea posible |
| Prompts especializados son mas prompts que mantener | Usar template base + overrides, tests automatizados por grupo |
| Name signals con falsos positivos (ej: "collar" de camisa vs. "collar" de joyeria) | Contexto con palabras adyacentes, combinar con imagen, nunca confiar solo en name signal |
| Cambio de schema rompe enrichments anteriores | Migracion incremental, metadata backward-compatible |
| Mayor costo por 2 llamadas LLM | Pre-clasificacion es ~10% del costo de enrichment principal. Menos retries lo compensan |

---

## Metricas de Exito

1. **Accuracy de categoria**: % de productos correctamente categorizados (medir con muestra manual de 200 productos)
2. **Accuracy de subcategoria**: % correcto dado que la categoria es correcta
3. **Tasa de retry**: Debe bajar de X% actual a <5%
4. **Confidence score promedio**: Debe estar >0.85 para >80% de productos
5. **Tiempo de enrichment**: No debe aumentar >30% con el pre-clasificador
