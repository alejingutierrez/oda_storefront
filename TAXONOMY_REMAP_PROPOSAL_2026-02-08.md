# Propuesta de Re-mapeo de Categorias y Subcategorias (Diseno, sin ejecucion)

Fecha: 2026-02-08

## 1) Objetivo

Disenar un re-mapeo completo y determinista de `products.category` y `products.subcategory` para:

- Eliminar duplicados/legacy como `Outerwear`, `Deportivo`, `Accesorios`, `Ropa interior` vs `Ropa interior (basica)`.
- Reducir inconsistencias (especialmente en `accesorios_textiles_y_medias`, donde `panuelos_bandanas` actua como "catch-all").
- Evitar que futuros enriquecimientos (LLM) vuelvan a introducir llaves no canonicas.
- Preparar reglas explicables para auto-reclasificar (primero **solo enriquecidos** por politica operativa).

Nota: este documento **no ejecuta** cambios en BD. Solo define el diseno del remapeo, reglas y cambios sugeridos a la taxonomia.

## 1.1 Principio clave: preservar detalle (sin "matar" subcategorias)

Dos verdades al mismo tiempo:

1) Necesitamos **una taxonomia canonica** (llaves estables) para filtros, UI y enrichment.
2) No debemos perder informacion util del origen (subcategorias legacy, breadcrumbs del sitio, etiquetas internas), porque ayuda a curar y a entrenar reglas.

Por eso, el diseno propone:

- Canonizar `category/subcategory` a llaves canonicas.
- Preservar el origen (cuando exista) en `products.metadata`, por ejemplo:
  - `metadata.taxonomy_source = { category, subcategory, breadcrumb, collection, ... }`
- Cuando una subcategoria legacy aporte detalle pero no exista como subcategoria canonica, no se guarda como `subcategory` (para no romper el arbol), pero se guarda como:
  - `metadata.taxonomy_source.subcategory_raw` y/o
  - `synonyms[]` del termino canonico (en snapshots), para mejorar matching y auditabilidad.

Esto evita "matar" detalle sin contaminar la taxonomia.

## 2) Fuente de verdad (taxonomia canonica)

La taxonomia canonica (categorias, subcategorias y llaves slug) vive en:

- `apps/web/src/lib/product-enrichment/constants.ts`

Regla de oro:

- `products.category` debe ser una de las llaves canonicas (slugify de los labels).
- `products.subcategory` debe ser una subcategoria valida **del arbol de esa categoria**.

## 3) Diagnostico (evidencia en BD)

### 3.1 Duplicados y legacy (conteos actuales)

Estos valores existen hoy en BD y explican los duplicados en UI/filtros:

| category (BD) | total | enriched | not_enriched | tipo | accion objetivo |
|---|---:|---:|---:|---|---|
| `tops` | 5737 | 234 | 5503 | legacy | repartir en `camisetas_y_tops` / `camisas_y_blusas` |
| `bottoms` | 4092 | 201 | 3891 | legacy | repartir en `pantalones_no_denim` / `jeans_y_denim` / `shorts_y_bermudas` / `faldas` |
| `outerwear` | 819 | 7 | 812 | legacy | repartir en `chaquetas_y_abrigos` / `buzos_hoodies_y_sueteres` / `blazers_y_sastreria` |
| `ropa_interior` | 3554 | 132 | 3422 | legacy | mapear a `ropa_interior_basica` o `lenceria_y_fajas_shapewear` segun titulo |
| `trajes_de_bano` | 781 | 89 | 692 | legacy | mapear a `trajes_de_bano_y_playa` |
| `deportivo` | 153 | 10 | 143 | legacy | mapear a `ropa_deportiva_y_performance` |
| `enterizos` | 121 | 6 | 115 | legacy | mapear a `enterizos_y_overoles` |
| `knitwear` | 75 | 1 | 74 | legacy | mapear a `buzos_hoodies_y_sueteres` (tejidos) |
| `accesorios` | 3402 | 164 | 3238 | legacy/catch-all | **no** es categoria canonica; repartir por reglas (joyeria/bolsos/textil/gafas/calzado/lifestyle) |
| `belleza` | 1 | 0 | 1 | one-off | absorber (ver seccion 6) |
| `chalecos` | 1 | 0 | 1 | one-off | absorber (ver seccion 4.7) |
| `ropa` | 1 | 0 | 1 | one-off | absorber (ver seccion 4.8) |
| `ropa interior` | 1 | 0 | 1 | one-off | absorber (ver seccion 4.9) |
| `__NULL__` | 3127 | 149 | 2978 | inconsistencia | inferir categoria/subcategoria por reglas |

### 3.2 Subcategorias desconocidas (top)

Hoy existen `subcategory` no canonicas como `blusas`, `camisetas`, `pantalones`, `bolsos`, etc. Esto no debe existir en el estado final:

- Deben mapearse a categorias/subcategorias canonicas o quedar en NULL si no hay confianza.

### 3.3 Hallazgo clave: `accesorios_textiles_y_medias` esta contaminada por no-moda (perfumes, etc.)

Hay productos enriquecidos con tokens `perfume/fragancia/colonia/splash` clasificados como:

- `accesorios_textiles_y_medias` (muchos en `panuelos_bandanas`)

Ejemplos reales:

- Perfumes de Scalpers/Bosi/Elduque y "Body Splash" terminan como `panuelos_bandanas`.

Esto indica una necesidad de:

1) reglas de remapeo (post-proceso) para moverlos a una categoria correcta, y
2) ampliar la taxonomia/prompt para que el modelo NO los vuelva a mandar a textil.

## 4) Re-mapeo canonico: categorias (reglas por llave actual)

Este es el contrato del remapeo. En ejecucion, debe aplicarse en dos fases:

1) **Canonizacion por categoria legacy** (alta confianza).
2) **Inferencia por titulo/URL** (cuando falta categoria/subcategoria o cuando `accesorios`/`__NULL__` no aportan señal).

### 4.1 `tops` -> (`camisetas_y_tops` o `camisas_y_blusas`)

Regla primaria (alta confianza): usar `subcategory` legacy.

- Si `subcategory = camisetas` -> `category = camisetas_y_tops`
- Si `subcategory = camisas` o `blusas` -> `category = camisas_y_blusas`

Subcategoria canonica: inferir por titulo (ver seccion 5).

### 4.2 `bottoms` -> inferiores canonicos

- Si `subcategory = jeans` -> `category = jeans_y_denim`
- Si `subcategory = pantalones` -> `category = pantalones_no_denim` (excepto si el titulo trae `jean/denim`, en cuyo caso `jeans_y_denim`)
- Si `subcategory = shorts` -> `category = shorts_y_bermudas`
- Si `subcategory = faldas` -> `category = faldas`

Subcategoria canonica: inferir por titulo (fit/tipo).

### 4.3 `outerwear` -> (`chaquetas_y_abrigos` | `buzos_hoodies_y_sueteres` | `blazers_y_sastreria`)

- Si `subcategory = buzos` -> `category = buzos_hoodies_y_sueteres`
- Si `subcategory = blazers` -> `category = blazers_y_sastreria`
- Si `subcategory = chaquetas` o `abrigos` -> `category = chaquetas_y_abrigos`

Subcategoria canonica: inferir por titulo (bomber, parka, hoodie, blazer oversize, etc.).

### 4.4 `knitwear` -> `buzos_hoodies_y_sueteres`

- `category = buzos_hoodies_y_sueteres`
- Si `subcategory = sweaters` -> subcategoria sugerida `sueter_tejido` (si no hay mejor match).

### 4.5 `enterizos` -> `enterizos_y_overoles`

- `category = enterizos_y_overoles`
- Subcategoria sugerida por titulo: `jumpsuit_largo` / `romper_jumpsuit_corto` / `overol_denim` / etc.

### 4.6 `deportivo` -> `ropa_deportiva_y_performance`

- `category = ropa_deportiva_y_performance`
- Subcategoria por titulo: running / ciclismo / compresion / leggings / top deportivo, etc.

### 4.7 `trajes_de_bano` -> `trajes_de_bano_y_playa`

- `category = trajes_de_bano_y_playa`
- Subcategoria por titulo: `bikini`, `trikini`, `vestido_de_bano_entero`, `pareo`, `rashguard_licra_uv`, etc.

### 4.8 `chalecos` (one-off) -> regla por tipo de chaleco

El termino "chaleco" existe en varios arboles canonicos:

- `buzos_hoodies_y_sueteres` -> `chaleco_tejido`
- `chaquetas_y_abrigos` -> `chaleco_acolchado`
- `blazers_y_sastreria` -> `chaleco_de_vestir`

Regla propuesta:

1) Si titulo incluye `tejido/knit/sweater` -> `buzos_hoodies_y_sueteres/ chaleco_tejido`
2) Si incluye `acolchado/puffer/quilting` -> `chaquetas_y_abrigos/ chaleco_acolchado`
3) Si incluye `sastre/vestir/formal` -> `blazers_y_sastreria/ chaleco_de_vestir`
4) Si no hay señal: **no auto-aplicar** (dejar para curation) o crear subcategoria nueva (ver seccion 6.3).

### 4.9 `ropa` (one-off) -> inferencia directa

Ejemplo real: `subcategory = camisilla` => mapear a:

- `camisetas_y_tops / camisilla_esqueleto_sin_mangas`

### 4.10 `ropa_interior` y `ropa interior` (legacy/one-off) -> underwear canonico

Regla propuesta:

1) Si titulo indica shapewear/lenceria (encaje, corset, liguero, faja, babydoll, body lencero) -> `lenceria_y_fajas_shapewear`
2) Si titulo indica pijama/bata/camison -> `pijamas_y_ropa_de_descanso_loungewear`
3) Si titulo indica pantimedias/tights/veladas -> `accesorios_textiles_y_medias / pantimedias_medias_veladas`
4) En otro caso -> `ropa_interior_basica`

Adicional: `cubre pezon` no cabe bien hoy; ver propuesta de taxonomia (seccion 6.2).

### 4.11 `belleza` (one-off) y productos de `perfume/fragancia/colonia/splash`

Propuestas (ver seccion 6.1):

- Opcion A (minima): mapear a `hogar_y_lifestyle` con subcategoria `cuidado_personal_y_belleza`.
- Opcion B (semantica): crear categoria canonica `belleza_y_cuidado_personal` con subcategorias (perfumes, corporal, etc.).

Decision (por ahora): **Opcion A**, por ser de alto retorno y bajo riesgo. Se integra como subcategoria canonica en:

- `apps/web/src/lib/product-enrichment/constants.ts` (Hogar y lifestyle -> Cuidado personal y belleza)

En ambos casos, el remapeo por reglas debe detectar:

- `perfume`, `eau de parfum`, `eau de toilette`, `fragancia`, `colonia`, `body splash`, `splash corporal`.

### 4.12 `accesorios` (legacy catch-all) -> inferir desde el titulo/URL (ignorar el category)

`accesorios` contiene joyeria, bolsos, corbatas, ropa interior, perfumes, etc. Por lo tanto:

- Tratar `category=accesorios` como si fuera `category=NULL` y ejecutar inferencia por reglas.

Orden de prioridad para inferir categoria desde titulo/URL:

1) Tarjeta regalo (gift card, voucher, bono regalo) -> `tarjeta_regalo/gift_card`
2) Belleza (perfume/fragancia/colonia/splash) -> ver seccion 4.11
3) Joyeria (aretes, collar, pulsera, anillo, tobillera sin contexto de medias, topo/topito, piercing, reloj) -> `joyeria_y_bisuteria`
4) Gafas/optica -> `gafas_y_optica`
5) Calzado -> `calzado`
6) Bolsos/marroquineria (bolso, cartera, mochila, morral, rinonera, billetera, tarjetero, cartuchera/estuche/neceser, lonchera/lunchbox, llavero, maleta, tula/duffel) -> `bolsos_y_marroquineria`
7) Hogar y lifestyle (papeleria/libros, posters/arte, velas/aromas, botilito/termo/botella de agua, portacomidas) -> `hogar_y_lifestyle`
8) Textil (medias, cinturon, gorra, sombrero, bufanda, guantes, panuelo/bandana, corbata/pajarita, tirantes, chales, accesorios cabello, gorros) -> `accesorios_textiles_y_medias`
9) Si sigue ambiguo: no auto-aplicar (salida a cola de curation).

### 4.13 Subcategorias canónicas actuales: conservar (no colapsar)

Tu punto es correcto: el valor de la taxonomia esta en llegar a **subcategorias sensibles** (ej: `polo` vs `camisilla_esqueleto_sin_mangas`), no solo en arreglar el nivel "categoria".

Decision de diseno:

- **No eliminar** subcategorias canónicas actuales de ropa. La reclasificacion debe intentar mapear a ellas.
- Solo se proponen subcategorias nuevas cuando:
  - hay "hueco real" (productos que hoy terminan en un cajon como `__NULL__` o `panuelos_bandanas` sin senal), y
  - hay senal fuerte en titulo/descripcion para automatizar con reglas/LLM.

Evidencia (conteos actuales en BD para categorias canónicas; 2026-02-08):

- `camisetas_y_tops`:
  - `polo`: 2539
  - `camisilla_esqueleto_sin_mangas`: 898
  - `crop_top`: 1449
  - `top_basico_strap_top_tiras`: 2318
  - `henley_camiseta_con_botones`: 23
  - Nota: `tank_top` existe en la base, pero actualmente tiene uso ~0; ver regla propuesta en 5.1 para reactivarla sin perder detalle.

- `camisas_y_blusas`:
  - `camisa_formal` vs `camisa_casual` vs `camisa_de_lino` vs `camisa_denim` (todas con volumen).

- `buzos_hoodies_y_sueteres`:
  - `hoodie_canguro` vs `hoodie_con_cremallera` vs `sueter_tejido` vs `cardigan` vs `chaleco_tejido`.

Tambien (para confirmar que esto no solo aplica a tops):

- `jeans_y_denim`: separa por fit real (`jean_skinny`, `jean_wide_leg`, `jean_straight`, etc.).
- `pantalones_no_denim`: separa por tipo (`pantalon_chino`, `pantalon_cargo`, `palazzo`, `jogger_casual`, etc.).

Esto confirma que la sensibilidad de subcategoria **ya existe** y es usada; el remapeo debe preservarla.

## 5) Reglas de subcategoria canonica (por titulo) - resumen operativo

Estas reglas atacan dos fuentes:

1) subcategorias legacy (ej: `camisetas`, `buzos`, `bolsos`)
2) subcategoria NULL en categoria canonica

Regla: si hay match unico fuerte -> asignar. Si hay multiples matches -> aplicar precedencia (mas especifico gana). Si no hay match -> dejar NULL.

### 5.1 `camisetas_y_tops`

Precedencia sugerida:

1) `body` (body, bodysuit)
2) `polo`
3) `henley`
4) `top_basico_strap_top_tiras`
   - Tokens: `strap`, `tiras`, `spaghetti`, `tiritas`, `strap top`
5) `tank_top`
   - Solo si el titulo trae **literal** `tank top`/`tank` (ingles) o un patron equivalente muy explicito.
   - Objetivo: que "tank top" no se coma "camisilla" y viceversa.
6) `camisilla_esqueleto_sin_mangas`
   - Tokens: `camisilla`, `esqueleto`, `sisa`, `sin mangas`, `sleeveless` (si no disparo `tank_top`)
7) `crop top`
8) `cuello tortuga/cuello alto/turtleneck`
9) `manga larga`
10) default: `camiseta_manga_corta` (si nada mas aplica)

### 5.2 `camisas_y_blusas`

Heuristica:

- `guayabera` -> `guayabera`
- `denim` + `camisa` -> `camisa_denim`
- `lino` + `camisa` -> `camisa_de_lino`
- `formal`/`office` -> `camisa_formal`
- `tunika/tunica` -> `blusa_tipo_tunica`
- `off shoulder` -> `blusa_off_shoulder`
- por manga: `blusa_manga_larga` / `blusa_manga_corta`
- fallback: `camisa_casual` o `blusa_manga_larga` segun token `camisa/blusa`

### 5.3 `buzos_hoodies_y_sueteres`

- `hoodie`/`canguro` (+ `zip/cremallera` => `hoodie_con_cremallera`)
- `polar` -> `buzo_polar`
- `half zip/1/2 zip` -> `buzo_cuello_alto_half_zip`
- `cardigan` -> `cardigan`
- `ruana/poncho` -> `ruana_poncho`
- `chaleco tejido` -> `chaleco_tejido`
- `sueter/sweater/tejido/knit` -> `sueter_tejido`
- si no: `buzo_cuello_redondo`

### 5.4 `chaquetas_y_abrigos`

- `trench/gabardina` -> `trench_gabardina`
- `impermeable` -> `impermeable`
- `rompevientos/windbreaker` -> `rompevientos`
- `parka` -> `parka`
- `bomber` -> `bomber`
- `puffer/acolchada` -> `puffer_acolchada`
- `cuero/leather` -> `chaqueta_tipo_cuero`
- `denim` -> `chaqueta_denim`
- `chaleco` + `acolchado` -> `chaleco_acolchado`
- `abrigo` -> `abrigo_largo`

### 5.5 `bolsos_y_marroquineria` (clave para cartucheras)

Reglas minimas (alta precision):

- `cartuchera/estuche/neceser/cosmetiquera/pouch/lapicera` -> `estuches_cartucheras_neceseres`
- `lonchera/lunchbox/lunch bag` -> `loncheras`
- `maleta/trolley/luggage/suitcase/equipaje` -> `maletas_y_equipaje`
- `llavero/keychain` -> `llaveros`
- `billetera/monedero/tarjetero/wallet` -> `billetera`
- `mochila` -> `mochila`
- `morral` -> `morral`
- `rinonera/canguro` -> `rinonera_canguro`
- `clutch/sobre` -> `clutch_sobre`
- `tote` -> `bolso_tote`
- `bandolera/crossbody/manos libres` -> `bolso_bandolera_crossbody`
- `tula/duffel/bolso de viaje` -> `bolso_de_viaje_duffel`
- fallback: `cartera_bolso_de_mano`

### 5.6 `accesorios_textiles_y_medias` (reglas y guardrails)

Hallazgo: `panuelos_bandanas` tiene baja "senal propia"; se usa como cubeta de error.

Guardrails propuestos:

- Solo asignar `panuelos_bandanas` si hay tokens explicitos: `panuelo/panoleta/bandana/headscarf/turbante`.
- `mono/moño` es ambiguo:
  - Si hay senal de **cabello** (scrunchie/gancho/pinza/diadema/balaca/hair) -> `accesorios_para_cabello`
  - Si hay senal de **cuello formal** (corbatin/bow tie/pajarita) -> `pajaritas_monos`
  - Si no hay senal, no auto-aplicar.
- Evitar falso positivo de `tie` por `tie dye`: la palabra `tie` solo debe contar si aparece como `neck tie/necktie` o hay senal de corbata/pajarita.

Adicional:

- `balaclava/pasamontanas` -> `gorros_beanies` (no `corbatas`)

### 5.7 `ropa_interior_basica` y `lenceria_y_fajas_shapewear`

Regla para evitar errores:

- `panty` es ambiguo:
  - `panty media/pantimedias/tights/veladas/denier` => `accesorios_textiles_y_medias/pantimedias_medias_veladas`
  - en otro caso: `ropa_interior_basica/panty_trusa` (si es ropa interior)

Agregar soporte para `cubre pezon` (seccion 6.2).

## 6) Cambios sugeridos a la taxonomia (para evitar errores futuros)

Estos son cambios **propuestos**, no aplicados aun.

### 6.1 Belleza / perfumes (recomendacion: definir explicitamente)

Problema: hoy perfumes y splashes se clasifican como textiles (panuelos) por ausencia de categoria/subcategoria adecuada y reglas.

Dos opciones:

Opcion A (minima, menor impacto UI):

- Agregar subcategoria a `hogar_y_lifestyle`:
  - Label: `Cuidado personal y belleza`
  - Key sugerida (slugify): `cuidado_personal_y_belleza`
- Remapear `belleza` + `perfume/fragancia/colonia/splash` hacia `hogar_y_lifestyle/cuidado_personal_y_belleza`.

Opcion B (mas semantica, categoria nueva):

- Agregar categoria nueva:
  - Label: `Belleza y cuidado personal`
  - Key sugerida: `belleza_y_cuidado_personal`
- Subcategorias minimas:
  - `perfumes_y_fragancias`
  - `cuidado_corporal`
  - `cuidado_capilar`
  - `cuidado_facial`
  - `maquillaje`
  - `belleza_otros`

Recomendacion: **Opcion B** si vamos a indexar catalogos completos (muchas marcas venden perfumes); reduce ambiguedad y evita contaminar lifestyle.

### 6.1.1 Subcategorias nuevas de alto retorno (para no perder detalle)

El feedback principal es valido: si solo "arreglamos categorias" pero dejamos subcategorias demasiado generales, la curacion humana sigue siendo costosa.

Propuesta: agregar pocas subcategorias nuevas, pero que sean:

- alta senal (se detectan por titulo/descripcion)
- volumen real (aparecen en auditorias)
- mejoran curation (permiten filtrar por tipo)

#### A) Accesorios para cabello: dividir el catch-all

Hoy existe `accesorios_para_cabello` (catch-all). Se propone dividir en 4 subcategorias **mutuamente utiles** y de alta senal:

1) `scrunchies_y_coleteros`
   - Keywords: `scrunchie`, `coletero`, `caucho`, `liga`, `elastico`, `liguita`
2) `diademas_balacas_y_tiaras`
   - Keywords: `diadema`, `balaca`, `tiara`, `vincha`, `headband`
3) `pinzas_ganchos_y_pasadores`
   - Keywords: `pinza`, `gancho`, `pasador`, `hebilla` (en contexto cabello)
4) `lazos_y_monos_cabello`
   - Keywords: `lazo`, `moño` (con contexto cabello), `ribbon`, `bow`

Y dejar `accesorios_para_cabello` como fallback (para compatibilidad) pero con regla:

- solo usarlo cuando hay contexto cabello pero no se puede clasificar en las 4 subcategorias anteriores.

Impacto: elimina el principal "cajon" dentro de `accesorios_textiles_y_medias` y reduce la tentacion de mandar "moños" a `panuelos_bandanas` o a `pajaritas_monos`.

#### B) Pajaritas vs moños (cuello vs cabello)

Hoy la subcategoria `pajaritas_monos` mezcla dos cosas distintas:

- pajarita/corbatin (cuello formal)
- moño (cabello) en muchas marcas

Recomendacion de taxonomia:

- Renombrar label de `pajaritas_monos` a **"Pajaritas / corbatines"** (manteniendo la key para no romper historico).
- Mover cualquier "moño" con contexto de cabello a `lazos_y_monos_cabello` (nueva subcategoria).

#### C) Balaclava/pasamontanas

Caso real: `balaclava` fue mal leido como `tie` por "tie dye".

Opcion conservadora (sin nuevas subcats):

- Regla: `balaclava/pasamontanas` => `gorros_beanies`

Opcion si aparece volumen:

- Nueva subcategoria: `balaclavas_pasamontanas`

#### D) Bolsos: tarjeteros/porta tarjetas (si hay volumen)

Hoy `billetera` puede absorber `tarjetero/porta tarjetas/portacards`. Si aparece volumen alto y se quiere detalle para curation:

- Nueva subcategoria: `tarjeteros_y_porta_tarjetas`

Esto es opcional; no es tan critico como cabello/belleza.

#### E) Hogar: cocina y vajilla (alto retorno)

Hallazgo recurrente: items de **mesa/cocina** (platos, vasos, copas, tablas para servir, utensilios) terminan en `accesorios_textiles_y_medias/panuelos_bandanas` por ausencia de un bucket explicito y por ruido en enrichment.

Propuesta (taxonomia minima, alta señal):

- En `hogar_y_lifestyle`, agregar subcategoria:
  - Label: `Cocina y vajilla`
  - Key sugerida: `cocina_y_vajilla`
- Reglas:
  - `plate/plato/platos/dinner plate/dessert plate`
  - `vaso/vasos/copa/copas/tumbler`
  - `utensilio(s)/cuchara(s)/tenedor(es)/cuchillo(s)`
  - `tabla para servir/tabla de madera`

Esto reduce el ruido en accesorios textiles y mejora la curacion de hogar.

### 6.2 Ropa interior: "cubre pezon" y accesorios intimos

Caso real: `Cubre pezon de silicona` no encaja bien en subcategorias actuales.

Propuesta:

- Agregar subcategoria a `ropa_interior_basica`:
  - Label: `Cubre pezón y accesorios íntimos`
  - Key sugerida: `cubre_pezon_y_accesorios_intimos`

Reglas:

- `cubre pezon/nipple cover/pezonera/adhesivo` -> esta subcategoria.

### 6.3 Chalecos (no tejido, no acolchado)

Si se detecta volumen real de "chaleco en dril/utility" (ej: `chaleco en dril`), proponer nueva subcategoria (para evitar meterlo a acolchados o tejido):

- Categoria sugerida: `chaquetas_y_abrigos`
- Label: `Chaleco (no acolchado)`
- Key sugerida: `chaleco_no_acolchado`

Solo si aparece volumen suficiente. Si es marginal, dejar a curation.

### 6.4 Mascotas (out-of-scope moda humana)

Ejemplo real: `DOG'S RAINCOAT` y `Dog Collar` aparecen en accesorios/cinturones.

Propuesta minima:

- Agregar subcategoria a `hogar_y_lifestyle`:
  - Label: `Mascotas`
  - Key sugerida: `mascotas`

Reglas:

- `dog/cat/mascota/perro/gato` + (collar/raincoat/abrigo) -> `hogar_y_lifestyle/mascotas`

## 7) Integracion (cuando se decida ejecutar)

Checklist tecnico para que el remapeo impacte el enrichment y no rompa UI:

1) Actualizar taxonomia base (si se aprueban nuevas categorias/subcategorias): `apps/web/src/lib/product-enrichment/constants.ts`.
2) Publicar snapshot de taxonomia (admin) para que `getPublishedTaxonomyMeta()` lo use en enrichment.
3) Actualizar prompt de enrichment (reglas explicitas) para:
   - perfumes/belleza
   - mascotas/out-of-scope
   - cubre pezon
4) Ejecutar un **dry-run** de remapeo (solo enriched) con reporte:
   - conteos before/after por categoria/subcategoria
   - lista de "low confidence" para curation
5) Ejecutar apply (solo enriched) si el dry-run es consistente.
6) Verificar UI:
   - facets de categoria no muestran legacy (`tops`, `bottoms`, `outerwear`, `accesorios`, `deportivo`, etc.)
   - mega menu y filtros funcionan
7) Actualizar docs: README/AGENTS/STATUS segun protocolo.

## 8) Nota puntual: Totto "Cartuchera escolar Mickey Azul"

En BD existe una cartuchera Totto enriquecida correctamente como:

- `bolsos_y_marroquineria / estuches_cartucheras_neceseres`

Pero tambien hay multiples cartucheras Totto **no enriquecidas** en `accesorios`, `ropa_interior` o `category NULL`, y algunas enriquecidas con subcategoria de bolso incorrecta (ej: `cartera_bolso_de_mano`).

Por eso el remapeo debe incluir la regla fuerte:

- si el titulo contiene `cartuchera/estuche/neceser/cosmetiquera/pouch/lapicera` => subcategoria `estuches_cartucheras_neceseres`.
