# AGENTS · Plataforma ODA Storefront

Documento vivo para alinear a cualquier agente (humano o IA) sobre objetivos, alcance, arquitectura y operaciones del proyecto. Escríbelo en español neutro, prioriza precisión sobre brevedad. Mantenerlo sincronizado con decisiones reales.

## 1) Visión y propósito
- Construir el mejor agregador y recomendador de moda colombiana, indexando ~500 marcas locales y su catálogo completo (productos, variaciones, precios, stock, tallas, colores, fotos, descripciones, enlaces originales, datos de tienda física y digital).
- Mantener la información siempre actualizada mediante scraping continuo + enriquecimiento con modelos de OpenAI (modelo principal **GPT-5.1** en JSON mode) que devuelvan JSON determinista y estable.
- Entregar a los usuarios un descubrimiento guiado (recomendaciones proactivas), opciones de anuncios, y experiencias premium (try-on con IA y asesoría personalizada), llevando el tráfico a las tiendas oficiales.

## 2) Modelo de negocio
1) Ingresos por anuncios (catálogos patrocinados, placements en listados, banners contextuales).
2) Algoritmo plus/proactivo (suscripción que desbloquea recomendaciones adelantadas, alertas de stock/precio, estilos curados y filtros avanzados).
3) Try-on con IA + asesoría personalizada (upsell para usuarios pagos; prioridad en cola de procesamiento, outfits sugeridos, chat estilista asistido por IA).

## 3) Alcance funcional
- **Scraping & monitoreo**: rastrear catálogos y metadatos de tiendas (web, redes, datos de contacto, horarios, direcciones). Detectar cambios de stock/precio, nuevas colecciones, cierres temporales.
- **Descubrimiento de URLs**: leer `robots.txt`, localizar y priorizar sitemaps XML/JSON/Atom; si no existen, crawler controlado (BFS/priority) con heurísticas para identificar páginas de producto; cachear y versionar sitemaps.
- **Normalización asistida por IA**: extraer descripciones, materiales, patrones, siluetas, colores, estilo y ocasión; generar captions de imágenes; producir JSON estable para ingestión (GPT-5.1 JSON mode + validación de esquema).
- **Catálogo unificado**: productos, variantes, imágenes, histórico de precios/stock, taxonomía uniforme (categoría, fit, material, patrón, ocasión, temporada), enlaces al ítem original.
- **Recomendador**: modelos híbridos (contenido + comportamiento). Similaridad semántica de texto/imágenes y señales de clic/guardar/compra redirigida. Soporte para “proactividad” (alertas, drops, back-in-stock).
- **Búsqueda y filtrado**: texto libre, filtros por categoría, talla, color, material, precio, disponibilidad, ubicación de la tienda, estilo.
- **Admin**: gestión de marcas/tiendas, control de scrapers, revisión de calidad de datos, enriquecimiento de atributos de producto, entrenamiento/versión del recomendador, gestión de usuarios (gratis/pago), billing Wompi, plantillas de correo (SMTP/SendGrid), features flags, auditoría.
- **Try-on y asesoría**: pipeline para generar previews de outfits (API de tercero o modelo propio), guardar sesiones y recomendaciones resultantes.

## 4) Arquitectura de alto nivel
- **Front web**: Vue Storefront sobre Next.js (usando adaptadores de VSF; SSR/ISR en Vercel). UI pública + portal admin (rutas protegidas) + landing.
- **BFF/API**: Next.js (app router, API routes o server actions) actuando como backend principal: autenticación, orquestación de catálogos, endpoints de búsqueda y recomendaciones, billing, webhooks.
- **Middleware de orquestación**: capa de colas y workers (p.ej., Redis/Upstash + procesos Node en runners dedicados) para scraping, ingestión IA, enriquecimiento y tareas programadas.
- **Scraper service**: servicio Node con rotación de proxies, manejo de robots, parsers específicos por marca y fallback genérico; emite eventos de cambio (stock/precio/nuevos productos). Incluye módulo de descubrimiento de sitemap y crawler de respaldo.
- **Ingestión IA**: jobs que envían HTML/JSON crudo + imágenes a OpenAI GPT-5.1 (JSON mode) para obtener objetos normalizados, captions y clasificación semántica; refuerzo con pocas tomas a modelos de visión para atributos visuales finos.
- **Recomendador**: servicio que mantiene embeddings (texto/imágenes) y modelos colaborativos; expone API para similares, outfits sugeridos y re-rank personalizado.
- **Storage**: Neon Postgres (rama prod/stg) para datos transaccionales; extensiones recomendadas: `pgvector` para embeddings, `postgis` opcional para geodatos. Vercel Blob para imágenes generadas/derivadas y assets de correo.
- **CDN/Edge**: Vercel para caché de páginas y APIs con revalidación; headers de `stale-while-revalidate` para catálogo público.
- **Observabilidad**: logging estructurado, métricas, trazas; panel de salud de scrapers y colas.
- **Ejecución local**: servicios web/scraper/worker se corren como procesos Node (sin Docker por ahora). Deploy en Vercel para front/BFF; workers y scrapers pueden ir a runners dedicados con cron propio.

### Diagrama textual de flujos
1) Scheduler → Encola jobs de scraping por marca/endpoint (prioridad basada en frescura/rotación).
2) Worker Scraper → Descubre sitemap/URLs → Descarga HTML/JSON → Parser marca → Publica payload crudo.
3) Job Ingestión IA → Envía payload + imágenes a GPT-5.1 (JSON mode) → Recibe objeto normalizado + captions → Valida contra JSON Schema.
4) Upsert en Postgres (productos, variantes, precios, stock, medios, metadatos de tienda) + guarda assets derivados en Vercel Blob.
5) Indexación de embeddings (pgvector) → Recomendador/Búsqueda semántica.
6) Front/Apps consumen API → Revalidación de ISR/Cache.
7) Eventos de usuario (clic, guardar, redirección a tienda) → Feeds de entrenamiento del recomendador.
8) Billing Wompi y control de features para usuarios pagos.

## 5) Componentes y responsabilidades
- **UI pública (Vue Storefront + Next)**: home inspiracional, listados, ficha de producto con variantes, store locator, recomendaciones, anuncios. Optimizar Core Web Vitals.
- **Portal Admin**: CRUD marcas/tiendas, catálogos, reglas de scraping, aprobación de datos IA, enriquecimiento de productos, configuración de recomendador, gestión de anuncios, gestión de usuarios/planes, monitoreo de colas.
- **API/BFF**: autenticación JWT/NextAuth, límites de tasa, API de catálogo, búsqueda, recomendaciones, eventos de usuario, billing, webhooks (Wompi, email provider), endpoints para admin.
- **Scrapers**: por marca/plantilla; detección de cambios; respeto de robots/cookies; rotación de user-agent/proxy; tolerancia a bloqueos; diff de DOM para minimizar llamadas.
- **Ingestión IA**: prompts versionados; validación estricta de JSON; catálogos de taxonomías (categorías, materiales, patrones, fits); generación de captions y etiquetas de estilo; detección de stock-out por señales de texto/atributos y deltas históricos.
- **Recomendador**: embeddings de texto/imágenes; similitud kNN; reglas de negocio (stock disponible, tallas del usuario, clima/lugar opcional); experimentos A/B para ranking.
- **Datos de tienda**: teléfonos, sitio web, redes, horarios, direcciones; validación periódica; geocodificación opcional para store locator.
- **Try-on/Asesoría**: manejo de imágenes del usuario (upload seguro a Blob), procesamiento asíncrono, expiración y borrado bajo petición.

## 6) Datos y esquemas sugeridos
- `brands(id, name, slug, site_url, description, logo_url, contact_phone, contact_email, instagram, tiktok, facebook, whatsapp, address, city, lat, lng, opening_hours, metadata, is_active)`
- `stores(id, brand_id, name, address, lat, lng, phone, schedule, website, channel_links, metadata)`
- `products(id, brand_id, external_id, name, description, category, subcategory, style_tags[], material_tags[], pattern_tags[], occasion_tags[], gender, season, care, origin, status, seo_title, seo_description, seo_tags[], source_url, image_cover_url, metadata, created_at, updated_at)`
- `variants(id, product_id, sku, color, color_pantone, size, fit, material, price, currency, stock, stock_status, images[], metadata)`
- `price_history(id, variant_id, price, currency, captured_at)`
- `stock_history(id, variant_id, stock, captured_at)`
- `assets(id, owner_type, owner_id, url, blob_path, kind)`
- `taxonomy_tags(id, type, value, synonyms[])`
- `users(id, email, role, plan, preferences, created_at)`
- `sessions/events` para comportamiento (click, view, save, outbound to brand, purchase-intent), usados para el recomendador.
- `announcements/placements` para anuncios y su performance.
- `billing_payments` y `webhook_logs` (Wompi).
- `crawl_runs(id, brand_id, sitemap_url, depth, status, fetched_at, delta_hash, pages_seen, pages_changed)`
- `ai_normalizations(id, brand_id, product_external_id, prompt_version, model='gpt-5.1', input_hash, output_schema_version, status, cost, created_at)`
- `reco_models(id, version, type, metrics, activated_at, rollback_to)`

## 7) Scraping & frescura
- Frecuencia adaptativa: marcas con alta rotación → más polling; marcas estáticas → menos.
- Refresh semanal automatizado: cron `/api/admin/catalog-refresh/cron` selecciona marcas vencidas, dispara extracción de catálogo completa y encola enriquecimiento sólo para productos nuevos o pendientes. Estado y métricas se guardan en `brands.metadata.catalog_refresh`.
- Respetar robots y términos; backoff exponencial en 4xx/5xx; manejo de captchas. Registrar excepciones legales/comerciales por marca.
- Detección de deltas: hash de páginas/fragmentos para evitar reprocesar; sólo enviar cambios al pipeline IA. Priorizar sitemap `lastmod` si existe.
- Observabilidad: métricas por marca (éxito, latencia, bloqueos, cambios detectados) y alarmas de staleness.
- Lista de exclusión y límites diarios por dominio; rotación de proxies y user-agents.
- Preferir fuentes estructuradas (sitemaps, feeds, APIs públicas) antes que crawling profundo; fallback headless sólo cuando sea necesario.
- **VTEX**: priorizar `/api/catalog_system/pub/products/search` para discovery completo; sitemaps pueden venir truncados. Usar `CATALOG_TRY_SITEMAP_VTEX=true` sólo si se valida cobertura.

## 8) Ingestión IA (OpenAI)
- Modelo por defecto: **GPT-5.1** (JSON mode). Backups: 4.1/4.0 si hay degradación.
- Enriquecimiento de atributos (admin): **GPT-5 mini** (JSON mode) con catálogo cerrado de categorías/tags/gender/season y color hex + Pantone (formato 19‑4042, nunca null; usar el más cercano disponible).
- Usar JSON mode y esquemas versionados; validar con JSON Schema antes de persistir; rechazar y reintentar con prompt de reparación cuando falle.
- Prompts que exijan: categorías normalizadas, materiales, patrones, silueta/fit, ocasión, temporada, tono/estilo, calidad de estampado, cierres, bolsillos, forro, instrucciones de cuidado, título SEO y metadescripción.
- Captioning de imágenes (visión) para enriquecer búsqueda y recomendaciones; extracción de rasgos finos (texturas, acabados, tipo de cuello/tirante, largo, calce).
- Filtros de seguridad para datos no confiables; fallback a reglas manuales cuando IA falle.
- Guardar `prompt_version` y `schema_version`; comparar salidas para detectar drift de modelo; registrar costo por item.

## 9) Búsqueda y recomendaciones
- Índice de texto + embeddings (pgvector). Campos clave: nombre, categoría, tags, materiales, estilo, captions.
- Re-ranking con señales de comportamiento y disponibilidad en tiempo real.
- Features premium: alertas de back-in-stock, drop early access, “encuéntrame algo parecido”, “arma el outfit”.

## 10) Monetización y planes
- Gratis: navegación, búsqueda básica, lista de deseos; anuncios visibles.
- Pago (via Wompi): recomendaciones proactivas, alertas, filtros avanzados, try-on, menos/no anuncios. Control mediante flags en la API.
- Advertiser: panel para campañas, reporting de CTR/CPA, control de presupuesto.

## 11) Infra y despliegue
- **Front/BFF**: Vercel (Next.js + Vue Storefront). ISR para catálogo; API Routes para endpoints rápidos.
- **Workers/Scrapers**: procesos Node con scheduler propio (cron/Temporal/BullMQ). Separar de Vercel porque scrapers y procesamientos largos no caben en lambdas.
- **Workers (cola catálogo/enriquecimiento)**: asegurar que `CATALOG_WORKER_API_URL` y `PRODUCT_ENRICHMENT_WORKER_API_URL` apunten al deployment vigente; reiniciar workers tras cambios en `apps/web` para evitar versiones antiguas que sobrescriban enriquecimiento.
- **Base de datos**: Neon Postgres; ramas `main` (prod) y `stg`; usar pooling (Neon Serverless Driver) y pgvector.
- **Guardia de enriquecimiento (DB)**: trigger `preserve_product_enrichment` evita que actualizaciones de catálogo borren `metadata.enrichment` y campos enriquecidos. Para desactivar, `DROP TRIGGER preserve_product_enrichment ON "products";` y `DROP FUNCTION preserve_product_enrichment();`.
- **Storage**: Vercel Blob para imágenes procesadas y uploads de usuarios (try-on). Cache CDN con expiración corta + revalidación en background.
- **Mensajería**: Redis/Upstash para colas; opcional Kafka si crece el throughput.
- **CI/CD**: GitHub Actions para lint/tests/build, push a Vercel y al registro de contenedores.
- **Git**: trabajar siempre sobre `main`; no crear ramas nuevas salvo solicitud explícita.
- **Local**: correr `apps/web`, `services/scraper` y `services/worker` con npm. DB/Redis remotos; variables en `.env.local` no versionadas.
- **FinOps**: límites diarios de tokens OpenAI por ambiente; tableros de costo por marca y por etapa (scrape → IA → upsert); caché de inferencias si no hay cambios.

## 12) Seguridad y cumplimiento
- Respetar términos de uso de cada sitio; honrar robots.txt cuando aplique; no almacenar PII sensible de usuarios finales; ofrecer borrado de datos (GDPR-like) y retención acotada.
- Rate limiting por IP/token; WAF en endpoints públicos; sanitización de HTML; validación de entrada exhaustiva.
- Credenciales en secrets (Vercel env, vault); rotar llaves; logging sin datos sensibles.
- Control de acceso RBAC en admin; auditoría completa (quién editó qué y cuándo).
- Borrado/anonimización de datos de try-on a solicitud; expiración automática de uploads de usuario.

## 13) Observabilidad y calidad
- Logs estructurados por servicio; trazas distribuidas; métricas: éxito scraping, frescura de catálogo, latencia API, tasa de errores IA, precisión del recomendador (CTR, conversion a click-out), uptime.
- Alertas por staleness (>24h sin actualización por marca), picos de 4xx/5xx, fallas de webhooks Wompi.
- Panel de calidad de datos: campos faltantes, duplicados, desviaciones de precio/stock, tasa de parseo fallido. Dashboard de salud de prompts (error rate, tiempo, costo).

## 14) Roadmap sugerido
- Fase 0: bootstrap repos, esquema inicial Postgres, conexión a OpenAI, primer scraper (1 marca), flujo E2E hasta mostrar producto en front.
- Fase 1: taxonomía fija, pgvector, búsqueda básica, 10–20 marcas, admin mínimo, anuncios básicos, dashboards de scraping.
- Fase 2: recomendaciones proactivas, alertas, Wompi planes, try-on MVP, 100+ marcas, observabilidad completa, versionado de prompts en producción.
- Fase 3: 500 marcas, escalado de scraping, optimización de costos, experimentos A/B de ranking, segmentación por estilo/ocasión, acuerdos con marcas clave.

## 15) Riesgos y mitigaciones
- Bloqueos de scraping → rotación de proxies, backoff, acuerdos con marcas clave, prioridad a feeds/RSS/APIs si existen.
- Datos inconsistentes → validación de esquema, reglas de negocio, QA asistido en admin, pruebas de regresión sobre parsers.
- Costos de IA/infra → batching, deduplicación de cambios, límites diarios por marca, cache de inferencias, observabilidad de costos.
- Límite de funciones serverless (Vercel) para tareas largas → mover scraping y procesamiento pesado a workers dedicados.
- Cumplimiento legal → revisión de términos, respuesta a solicitudes de eliminación, transparencia sobre uso de datos y enlaces a tiendas originales.

## 16) Entorno y configuración
- Variables críticas: `OPENAI_API_KEY`, `NEON_DATABASE_URL`, `REDIS_URL`, `VERCEL_BLOB_READ_WRITE_TOKEN`, `WOMPI_PRIVATE_KEY`, `WOMPI_PUBLIC_KEY`, `SMTP_HOST/USER/PASS`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `S3_PROXY` si aplica.
- Feature flags para: try-on, anuncios, recomendaciones proactivas, scrapers experimentales, prompts IA versionados.
- Separar variables por ambiente (local/stg/prod); política de rotación trimestral de llaves sensibles; exportar configuración de prompts/versiones en Git.
 - **Vercel CLI**: el `VERCEL_TOKEN` ya está disponible en `.env`. No solicitarlo nuevamente; usar el valor de `.env` cuando se necesite operar Vercel desde CLI.

## 17) Notas de estilo y UX
- Enfocar en moda colombiana: lenguaje, imágenes y ejemplos locales.
- Catálogo rico en facetas: material, fit, ocasión, clima, región, estética.
- Admin con vista de salud por marca y panel de cola para reintentos manuales.

## 18) Qué no está en alcance (por ahora)
- Checkout propio (las compras se hacen en las tiendas originales).
- Apps móviles nativas; foco inicial web responsive.
- Moderación de UGC más allá de reseñas cortas (si se habilitan, moderar con OpenAI/filters).

## 19) KPIs iniciales
- Frescura de catálogo (<24h para top 100 marcas; <72h para el resto).
- Cobertura: % de SKUs con tallas, color, material, price/stock vigente, captions de imagen.
- CTR en recomendaciones y anuncios; tasa de click-out a tiendas; ratio de back-in-stock alert opt-ins satisfechos.
- Latencia P95 de búsqueda y ficha de producto (<400ms desde edge cache; <900ms sin cache).

## 20) Agrupación de colores ↔ productos (proceso actual)
Este proceso crea relaciones muchos‑a‑muchos entre variantes y combinaciones de color, y permite ver en el admin qué productos se asocian a cada color dentro de una combinación.

### Tablas involucradas
- `color_combinations`: combinaciones base; `colorsJson` guarda el array de colores `{ hex, role }` por combinación.
- `color_combination_colors`: **paleta 200** (hex/pantone + Lab). Ya no es tabla puente; cada fila es un color de la paleta.
- `standard_colors` + `standard_color_config` + `standard_color_aliases/*`: catálogo de colores estandarizados (≈60) y reglas de mapeo.
- `variant_color_vectors`: colores de variantes en espacio **estandarizado** (hex/Lab del `standard_color`).
- `variant_color_combination_matches`: top matches de variante → combinación con métricas de calidad.

### Cómo se construyen las relaciones (batch)
Script: `apps/web/scripts/build-color-relations.mjs`

1) **Sembrar paleta 200**
   - Fuente: `paleta_200_colores_pantone_y_mapeo_formateado.xlsx` (sheet `palette_200`).
   - Script: `node scripts/seed-color-palette-200.mjs`.
   - Cada color se normaliza, calcula Lab y se asocia a `standardColorId` usando `standard_color_best_match`.

2) **Colores de combinaciones**
   - Se leen desde `color_combinations.colorsJson`.
   - Cada `hex` se mapea a `standardColorId` (usando la paleta y/o heurística de `standard_color_config`).

3) **Colores de variantes**
   - Fuente principal: `variants.metadata.enrichment.colors.hex` (array o string).
   - Fallback: `variants.color`.
   - Si `variants.color` no es hex, se intenta mapear con `standard_color_aliases`.
   - Si aun no hay color, se intenta inferir desde `products.name` con `standard_color_aliases`.
   - Se normalizan hex y se mapean a `standardColorId`.
   - Si no hay hex válido, se usa `variants.standardColorId` como último fallback.

4) **Vectores estándar**
   - Se insertan en `variant_color_vectors` usando el **hex/Lab del `standard_color`** (source = `standard_color`).

5) **Matching variante → combinación**
   - Distancia **DeltaE2000** entre colores estándar de la combinación y de la variante.
   - Se calcula:
     - `avgDistance`, `maxDistance`
     - `coverage` = % de colores de la combinación dentro del umbral
     - `score` = `avgDistance + (1 - coverage) * penalty`
   - Se guardan los **Top‑K** matches en `variant_color_combination_matches`.
   - Si no hay matches que cumplan umbrales, se habilita fallback a los mejores scores (controlable por `COLOR_MATCH_ALLOW_FALLBACK`; default activo).

### Variables de control (re‑ejecución)
Se pueden ajustar por env al correr el script:
- `COLOR_MATCH_TOP_K` (default 20)
- `COLOR_MATCH_THRESHOLD` (default 24) → distancia para “coverage”
- `COLOR_MATCH_MIN_COVERAGE` (default 0.4)
- `COLOR_MATCH_MAX_AVG` (default 20)
- `COLOR_MATCH_MAX_DIST` (default 36)
- `COLOR_MATCH_PENALTY` (default 12)
- `COLOR_MATCH_BUCKET_SIZE` (default 6)
- `COLOR_MATCH_BUCKET_RADIUS` (default 2)
- `COLOR_MATCH_MIN_CANDIDATES` (default 40)
- `COLOR_MATCH_BATCH` (default 500)
- `COLOR_MATCH_LOG_EVERY` (default 2000)
- `COLOR_MATCH_MAX_HEXES` (0 = sin límite)

Ejemplo de ejecución (desde `apps/web`):
```
COLOR_MATCH_MIN_COVERAGE=0.5 COLOR_MATCH_MAX_AVG=14 COLOR_MATCH_MAX_DIST=24 node scripts/build-color-relations.mjs
```

### Cómo se agrupan productos por color (admin)
Endpoint: `GET /api/admin/color-combinations/[id]/products`

- Usa los matches de `variant_color_combination_matches` para acotar variantes.
- Para cada color de la combinación:
  - Calcula DeltaE con los **colores estándar** de la variante.
  - Si la distancia mínima ≤ `COLOR_MATCH_COLOR_THRESHOLD` (default 26), el producto entra en el grupo del color.
  - Se deduplica por producto; se conserva la variante con menor distancia.

Este endpoint alimenta el modal en el admin, mostrando una galería por color (con nombre Pantone, hex, conteos y cards de producto).

### Re‑correr tras cambios
- Si cambia la paleta 200: `node scripts/seed-color-palette-200.mjs` → `node scripts/build-color-relations.mjs`.
- Si cambia el enrichment de colores o el catálogo: `node scripts/build-color-relations.mjs`.

Mantener este archivo actualizado a medida que se decidan tecnologías, proveedores y políticas definitivas.

## 21) Protocolo obligatorio al trabajar historias de usuario
Para cada historia (nueva o en curso) se debe:
0) Pedir al solicitante requisitos previos: credenciales/API keys necesarias, definiciones o datos faltantes para contexto, accesos a Vercel/Neon/Wompi/Blob, y cualquier variable de entorno requerida.
1) Levantar servicios locales necesarios (web/scraper/worker) y revisar logs; corregir errores si aparecen.
2) Hacer push a la rama de trabajo.
3) Esperar y revisar el build en Vercel hasta su finalización; si falla, diagnosticar y corregir.
4) Revisar logs de Vercel del deploy resultante para confirmar que no hay errores en runtime.
5) Actualizar el README del proyecto con cualquier cambio relevante (instalación, variables, comandos, decisiones).
6) Marcar la historia como terminada en `USER_STORIES.md`, `BACKLOG.md` y registrarla también en `STATUS.md` (resumen global).

## 22) Integridad del repositorio (lecciones aprendidas)
- Antes de hacer push, verificar que el árbol de git no esté vacío: `git ls-files` debe devolver archivos, y `apps/web/package.json` debe existir en git.
- Si aparece el error de Vercel “Root Directory apps/web does not exist”, detener y restaurar el contenido del repo antes de continuar con despliegues.
- Evitar operaciones que dejen el índice vacío; si hay locks, limpiar `.git/index.lock` y reintentar con cuidado, sin borrar el repositorio.

## 22) Lecciones recientes (2026-02-03)
- El enriquecimiento de productos no debe ejecutarse con Bedrock en este proyecto. Forzar `OpenAI` como proveedor efectivo y registrar en cada run `provider/model/prompt_version/schema_version` evita confusiones y facilita auditoría.
- Los runs pueden quedar “processing” aunque sólo existan fallas terminales (intentos agotados). Debe auto-bloquearse el run y mostrar el conteo de fallas terminales para evitar la sensación de “loop”.
- En UI, distinguir entre “pendientes de cola” y “productos sin enrichment” reduce inconsistencias de lectura.

## 22) Lecciones operativas (evitar errores repetidos)
- **Hooks/TS en React**: no referenciar funciones `const` antes de su declaración. Si un `useEffect` depende de un handler, declarar el handler **antes** o usar `function` declarations.
- **Prisma JSON**: al persistir en columnas JSON (`brands.metadata`), usar tipos `Prisma.JsonValue` y serializar (`JSON.parse(JSON.stringify(obj))`) para garantizar `InputJsonValue` válido. Evitar `Record<string, unknown>` directo si contiene estructuras anidadas complejas.
- **Vercel logs**: `vercel logs` solo funciona para **runtime logs** de deployments **Ready**. Para errores de build usar **Vercel UI** o **API**:
  - Obtener `deploymentId` (p. ej. con `vercel inspect <url> --token $VERCEL_TOKEN`).
  - Consultar eventos de build: `curl -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v2/deployments/<deploymentId>/events"`.
- **.env no shell‑safe**: no usar `source .env` si contiene caracteres especiales (`&`, espacios o rutas). En su lugar, leer variables puntuales con un script (`python3`) y exportarlas al comando.
- **Lint/build colgados**: si `npm run lint` o `npm run build` no responde, esperar un tiempo razonable y cortar el proceso; registrar en `STATUS.md` y reintentar con comandos más específicos (`npx next build`, `npx eslint <paths>`).
