# Historias de Usuario · ODA Storefront

Basadas en `AGENTS.md` y `BACKLOG.md`. Estructuradas por fase (F0–F3), stack: Next.js + Vue Storefront en Vercel, BFF/API en Next, scrapers/workers dockerizados, Neon+pgvector, Vercel Blob, OpenAI GPT-5.2 JSON mode, Wompi, Redis/colas.

Formato por historia: contexto/rol, alcance/flujo, criterios de aceptación (CA), datos, no funcionales (NF), riesgos/mitigación, métricas/telemetría.

## F0 – Now (bootstrap E2E mínimo)

### MC-001 Estructura base repo y convenciones
- Historia: Como dev del equipo, quiero un esqueleto monorepo con módulos front, BFF, scraper y workers, para escalar sin deuda desde el día 1.
- Alcance: Setup de carpetas, alias/tsconfig paths, lint/format (eslint, prettier), scripts npm, README de arranque, VSF adaptado a Next, husky/commitlint opcional.
- CA: `npm run lint` y `npm run build` pasan; estructura documentada; convenciones de nombres y imports definidas; VSF arranca en modo dev.
- Datos: N/A.
- NF: Coherencia de estilo, DX rápida (<2 min para levantar dev).
- Riesgos: Sobrecarga de tooling; mitigar con plantilla mínima.
- Métricas: Tiempo de onboard (minutos para correr dev), ratio de PRs sin lint errores.
- Estado: **done (2026-01-15)**.

### MC-002 Docker compose local
- Historia: Como dev, quiero un `docker-compose` que levante web/BFF, scraper, worker, Postgres (pgvector) y Redis, para replicar el stack en local con un solo comando.
- Alcance: Servicios web (Next start), scraper/worker stubs, Postgres con pgvector, Redis, healthchecks; mapeo de puertos accesible; `.env.example` alineado con Vercel.
- CA: `docker-compose up -d` levanta todos los contenedores; healthchecks verdes; web accesible en host `http://localhost:3080`; DB en 5432, Redis en 6379; `.env.example` refleja todas las variables usadas.
- Datos: URLs de conexión a Neon (pooler/unpooled) en env; tokens de Blob/Wompi/SMTP placeholders; OpenAI key requerida si se usa ingestión.
- NF: Arranque <2 min en laptop típica; comandos reproducibles sin pasos manuales.
- Riesgos: Puertos ocupados; mitigado cambiando host a 3080 y healthchecks para detectar caídas.
- Métricas: Éxito de `docker-compose up`, tiempo de arranque, health status de servicios.
- Estado: **done (2026-01-15)**.

### MC-003 Esquema Neon + migraciones
- Historia: Como ingeniero de datos, quiero un esquema base y migraciones reproducibles para Postgres/Neon con pgvector, para persistir el catálogo unificado y eventos.
- Alcance: Modelos brands, stores, products, variants, price_history, stock_history, assets con enlaces a product/variant/brand/store/user, taxonomy_tags, users, events, announcements; índices y FKs; extensión pgvector habilitada.
- CA: `prisma generate` exitoso; migración `20260115125012_init_schema` aplica sin errores; pgvector creada; constraints e índices según plan; columnas monetarias Decimal(12,2); arrays para tags/imagenes.
- Datos: URL de conexión en env; sin seeds todavía.
- NF: Migraciones reproducibles en local y listas para Neon; compatibilidad con Next/Vercel (Prisma 7).
- Riesgos: Cliente Prisma en edge requiere pooler; mitigado usando pooler URL y dejando unpooled para cargas específicas.
- Métricas: Migración aplica en <30s; verificación `\dt` y health de DB.
- Estado: **done (2026-01-15)**.

### MC-004 Conexión OpenAI GPT-5.2 JSON mode
- Historia: Como ingeniero de ingestión, quiero enviar HTML/imágenes y recibir JSON validado, para normalizar productos.
- Alcance: Cliente con retries/backoff, prompt v0 versionado, JSON Schema, validación Zod, manejo de errores, logging de costo/latencia, endpoint `/api/normalize`, middleware Bearer (ADMIN_TOKEN/NEXTAUTH_SECRET), carpeta `/admin` base.
- CA: Llamada de prueba devuelve JSON válido; validación pasa; se reintenta y registra error; tiempo medio <8s; endpoint protegido por token; build y lint verdes.
- Datos: Esquema de producto/variante/tags según AGENTS.
- NF: Idempotencia de requests; timeouts configurados.
- Riesgos: Cambios de modelo; mitigación: versionado de prompt y schema.
- Métricas: Tasa de éxito, costo por item, latencia P95.
- Estado: **done (2026-01-15)**.

### MC-005 Primer scraper E2E
- Historia: Como operador, quiero scrapear 1 marca desde su sitemap y ver el producto en el front, para validar el pipeline completo.
- Alcance: Descubrimiento de sitemap/robots, parser mínimo, publicación de payload crudo, llamada a GPT-5.2, upsert en DB, render en VSF con ISR.
- CA: Al menos 1 producto visible en ficha VSF con datos y foto; stock/precio guardados; logs del pipeline accesibles.
- Datos: URL original, imágenes, variantes (color/talla), price/stock.
- NF: Ciclo E2E <15 min; reintento en fallas de red.
- Riesgos: Anti-bot; mitigar con user-agent y backoff.
- Métricas: Tasa de éxito scrape→DB, frescura horas.

### MC-054 Sitemap scan completo + fallbacks Woo/VTEX
- Historia: Como operador, quiero que el extractor lea sitemaps completos (index/gz) y tenga fallback HTML, para no perder productos en Woo/VTEX/custom.
- Alcance: Descubrimiento product-aware con sitemap index/gz, límite de sitemaps por corrida, heurísticas de URL producto y fallback HTML cuando API falla.
- CA: Sitemaps index/gz se procesan; product URLs detectadas aunque no tengan tokens; Woo/VTEX devuelven raw desde HTML si la API falla; smoke test por tecnología sin escribir en DB.
- Datos: Variables `CATALOG_EXTRACT_SITEMAP_LIMIT` y `CATALOG_EXTRACT_SITEMAP_MAX_FILES`.
- NF: Discovery con tiempo controlado; no bloquea el extractor.
- Riesgos: Sitemaps masivos; mitigación con límite de archivos y límites de tiempo.
- Métricas: % product URLs detectadas y tasa de fetch ok por tecnología.
- Estado: **done (2026-01-21)**.

### MC-055 Fallback a API si sitemap no trae productos
- Historia: Como operador, quiero que si el sitemap no contiene URLs de producto, el extractor use el discovery del adapter, para evitar fallas en VTEX.
- Alcance: Filtrar URLs de producto en sitemap; si quedan 0, pasar a discovery por plataforma (API) en vez de intentar páginas no‑producto.
- CA: En VTEX con sitemaps genéricos no se intenta scrapear URLs de categoría/home; usa API `/api/catalog_system/pub/products/search` y reduce errores “raw vacío”.
- Datos: metadata de `catalog_extract` con errores claros por URL.
- NF: Sin degradar performance de discovery.
- Riesgos: Custom con URLs no estándar; mitigación: fallback al discovery del adapter.
- Métricas: Disminución de errores “No se pudo obtener producto (vtex)”.
- Estado: **done (2026-01-22)**.

### MC-056 Filtrar sitemap a mismo dominio
- Historia: Como operador, quiero descartar URLs externas en sitemaps para no intentar scrapear productos fuera del sitio.
- Alcance: Filtrar URLs del sitemap por mismo `origin` del sitio antes de procesar productos.
- CA: Sitemaps con URLs externas no generan refs inválidos; VTEX no intenta scrapear dominios ajenos.
- Datos: Sin cambios de esquema.
- NF: Filtro simple sin impacto notable.
- Riesgos: Sitemaps con subdominios legítimos; mitigar ajustando `siteUrl` a dominio correcto.
- Métricas: Menos errores de “raw vacío” por URLs externas.
- Estado: **done (2026-01-22)**.

### MC-057 Marcar manualReview cuando no hay productos
- Historia: Como operador, quiero marcar marcas sin productos detectables como “manual review”, para revisarlas o deshabilitarlas.
- Alcance: Cuando no se descubren productos (sitemap + adapter), bloquear el run, guardar reason en metadata y activar `manualReview`.
- CA: Estado `blocked` con `blockReason` y `lastError`, y `brands.manualReview = true` cuando no hay productos.
- Datos: `metadata.catalog_extract_review` con razón/fecha/plataforma.
- NF: Sin cambios de esquema.
- Riesgos: Falsos positivos en sitios con productos ocultos; mitigación: revisión manual.
- Métricas: Conteo de marcas con manual review por catálogo.
- Estado: **done (2026-01-22)**.

### MC-058 Mejoras de detección en plataformas unknown
- Historia: Como operador, quiero identificar mejor tecnologías desconocidas (Tiendanube/Wix) y marcar dominios inválidos, para reducir fallos en scraping y priorizar revisión manual.
- Alcance: Heurísticas nuevas en tech profiler (Tiendanube/Wix), detección de dominios parked/unreachable, manualReview automático para casos inválidos, patrones de URLs de producto adicionales (`/product-page/`, `/product-`) y scan ampliado de sitemaps.
- CA: Marcas Tiendanube/Wix se clasifican sin quedar en unknown; dominios “parked” o inalcanzables quedan en manualReview; discovery identifica URLs de producto de Wix/Derek; sitemaps grandes no pierden productos tempranos.
- Datos: `brands.ecommercePlatform`, `brands.metadata.tech_profile`, `brands.manualReview`, variables `CATALOG_EXTRACT_SITEMAP_SCAN_MAX_URLS`.
- NF: Heurísticas determinísticas sin llamadas extra a LLM.
- Riesgos: Falsos positivos por hosts similares; mitigación: reglas específicas por host y meta generator.
- Métricas: Reducción de “unknown” en tech profiler y tasa de descubrimiento de productos en custom.
- Estado: **done (2026-01-22)**.

### MC-059 Custom adapter: omitir listados y detectar producto por pistas
- Historia: Como operador, quiero evitar que páginas de listado se traten como producto y aun así reconocer PDPs sin JSON-LD, para aumentar la tasa de éxito en unknown.
- Alcance: Heurísticas más estrictas para `/tienda/` y `/shop/` (requiere slug), y validación por “pistas” (precio + imagen + título o add‑to‑cart) cuando no hay JSON‑LD.
- CA: URLs de listados no pasan el filtro; PDPs sin JSON‑LD pero con pistas básicas sí se procesan; páginas sin evidencia quedan omitidas.
- Datos: N/A.
- NF: Lógica ligera sin headless.
- Riesgos: Falsos positivos en páginas con precios promocionales; mitigación con combinación de señales.
- Métricas: % de PDPs válidos en unknown y reducción de errores “raw vacío”.
- Estado: **done (2026-01-22)**.

### MC-060 Custom adapter: excluir listados por og:type/rutas
- Historia: Como operador, quiero filtrar páginas editoriales/listados aunque tengan CTAs, para no contaminar el catálogo con contenido no‑producto.
- Alcance: Exclusiones por rutas no‑producto (blog/collections/etc.) y regla adicional: si `og:type` es `website`/`article` y no hay price meta, se omite la URL.
- CA: Páginas de contenido quedan fuera; PDPs reales mantienen extracción (si hay price meta o JSON‑LD).
- Datos: N/A.
- NF: Sin headless, solo heurísticas ligeras.
- Riesgos: Falsos negativos en sitios con og:type genérico; mitigación con price meta.
- Métricas: Menos listados marcados como producto en unknown.
- Estado: **done (2026-01-22)**.

### MC-061 Unknown: sitemaps extra + inferencia rápida de plataforma
- Historia: Como operador, quiero mejorar la detección de productos en marcas unknown con mejores sitemaps y una inferencia rápida de plataforma sin LLM, para aumentar cobertura sin subir costos.
- Alcance: Ampliar candidatos de sitemap (WP/Products/Store), inferir plataforma desde señales de home (scripts/meta/headers) y guardar resultado en metadata; aceptar microdata de precio como pista en custom.
- CA: Se prueban sitemaps adicionales (incluye `wp-sitemap.xml` y variantes de products); cuando se infiere plataforma con alta confianza se registra en `brands.metadata.catalog_extract_inferred_platform`; PDPs con `itemprop=price` cuentan como producto.
- Datos: `brands.metadata.catalog_extract_inferred_platform`.
- NF: Detección ligera sin llamadas a OpenAI.
- Riesgos: Falsos positivos de plataforma; mitigación con umbral de confianza y evidencia mínima.
- Métricas: Mayor tasa de descubrimiento de URLs producto en unknown; reducción de runs bloqueados por “no products”.
- Estado: **done (2026-01-22)**.

### MC-062 Custom: evitar URLs no‑producto desde sitemap
- Historia: Como operador, quiero evitar que páginas de portafolio/listado se traten como productos cuando el sitemap no tiene PDPs, para reducir errores y ruido en unknown.
- Alcance: Excluir `/portafolio`/`/portfolio` en heurística y no usar URLs no‑producto como fallback del sitemap en adapter custom.
- CA: Si no hay URLs de producto detectables en sitemap, el custom adapter no procesa páginas genéricas; se marca manual review en lugar de fallar PDPs.
- Datos: N/A.
- NF: No aumenta tiempos de discovery.
- Riesgos: Sitios con URLs de producto no estándar quedarán en manual review hasta crear recipe.
- Métricas: Reducción de errores “No se pudo obtener producto (custom)”.
- Estado: **done (2026-01-22)**.

### MC-063 Blob: retry con referer/UA
- Historia: Como operador, quiero reducir fallos al subir imágenes que bloquean hotlinking, para que el catálogo avance aunque los CDN restrinjan requests.
- Alcance: Reintento de fetch de imagen con `referer` y `user-agent` antes de fallar el upload; mensaje de error incluye sample de URLs fallidas.
- CA: URLs de Wix/static/CDN que requieren referer se suben sin error; cuando falla se reporta muestra de URLs.
- Datos: N/A.
- NF: Reintento ligero, sin aumentar demasiado el tiempo.
- Riesgos: Sitios que bloquean por rate limit; mitigación con timeout y concurrencia existente.
- Métricas: Disminución de errores “Blob upload failed”.
- Estado: **done (2026-01-22)**.

### MC-064 Normalizar ImageObject antes de subir a Blob
- Historia: Como operador, quiero que el extractor convierta objetos `ImageObject` a URLs antes de subir, para evitar fallos por tipos no válidos.
- Alcance: Normalización de `raw.images` y `variant.images` para extraer `contentUrl`/`thumbnail` y convertir a strings.
- CA: No aparecen errores `startsWith is not a function`; upload falla sólo por red/tamaño.
- Datos: N/A.
- NF: Conversión ligera y determinística.
- Riesgos: URLs faltantes en JSON-LD; mitigación: fallback a arrays existentes.
- Métricas: Reducción de “Blob upload failed” por objetos.
- Estado: **done (2026-01-22)**.

### MC-065 LLM PDP fallback + autolimpieza de marcas no procesables
- Historia: Como operador, quiero clasificar PDPs con LLM y extraer productos cuando el extractor tradicional falla, y eliminar marcas que no sean procesables (social/bot/unreachable/sin PDP), para mantener el catálogo limpio.
- Alcance: Clasificador PDP LLM (JSON) y extractor RawProduct LLM; fallback en unknown/custom; tech profiler elimina marcas no procesables y persiste riesgos.
- CA: Si el adapter no extrae en unknown/custom, LLM clasifica PDP; si es PDP, extrae RawProduct y se normaliza; marcas con riesgos críticos se eliminan automáticamente.
- Datos: Persistencia de decisión LLM en `product.metadata.llm`.
- NF: Límite de caracteres configurable para HTML/texto y batchs controlados.
- Riesgos: Costos de LLM; mitigar con umbral de confianza y límite de candidatos.
- Métricas: % de PDPs rescatados; reducción de marcas “unknown” no procesables.
- Estado: **done (2026-01-23)**.

### MC-066 Finalizar marca en catalog extractor
- Historia: Como operador, quiero marcar una marca como terminada desde el extractor, para sacarla de la cola cuando ya fue revisada o no requiere más extracción.
- Alcance: Acción “Finalizar” en `/admin/catalog-extractor` con confirmación; endpoint `POST /api/admin/catalog-extractor/finish`; persistencia en `brands.metadata.catalog_extract_finished`; la marca deja de aparecer en la lista/cola.
- CA: Tras confirmar, la marca sale de la lista y no se auto‑selecciona; se guarda `finishedAt` y `reason` en metadata.
- Datos: `brands.metadata.catalog_extract_finished`.
- NF: Acción idempotente y sin impacto en productos ya guardados.
- Riesgos: Eliminación accidental; mitigación con confirmación explícita.
- Métricas: N/A.
- Estado: **done (2026-01-23)**.

### MC-067 Detener extractor conserva estado
- Historia: Como operador, quiero detener el extractor sin perder el progreso, para reanudar desde el último producto procesado.
- Alcance: Acción “Detener” guarda el estado (`catalog_extract`) con status `stopped` y cursor actual; al volver a Play, retoma sin reiniciar refs.
- CA: Tras detener y volver a Play, no se reprocesan productos ya completados.
- Datos: `brands.metadata.catalog_extract`.
- NF: Sin impacto en tiempos ni en lógica de errores.
- Riesgos: Confusión con “reset”; mitigación: texto en README/panel.
- Métricas: N/A.
- Estado: **done (2026-01-23)**.

### MC-068 Resume UI + barrido de URLs + GPT-5 mini en productos
- Historia: Como operador, quiero ver “Resume” cuando una marca ya pausó/detuvo, y asegurar que el extractor retome desde el último punto sin re‑scrapear URLs completadas; además reducir costo con GPT‑5 mini en el scraper de productos.
- Alcance: Label “Resume” en botón Play cuando status es `paused/stopped`; barrido de `refs/items` para encontrar el siguiente pendiente; modelo `CATALOG_OPENAI_MODEL=gpt-5-mini` para PDP LLM + normalización de catálogo.
- CA: Al pausar/detener, el botón cambia a Resume y al reanudar no se reprocesan URLs completadas; el pipeline de productos usa GPT‑5 mini sin cambiar el output.
- Datos: `brands.metadata.catalog_extract`, env `CATALOG_OPENAI_MODEL`.
- NF: Sin cambios en esquema de salida.
- Riesgos: Desalineación de cursor si refs cambian; mitigado con sincronización de items.
- Métricas: % de reprocesos evitados; costo por producto.
- Estado: **done (2026-01-23)**.

### MC-069 Robustez extractor: telemetría y pausa por errores consecutivos
- Historia: Como operador, quiero contexto de fallas y protección contra errores repetitivos, para entender por qué un sitio falla y evitar loops infinitos.
- Alcance: Guardar `lastUrl`, `lastStage`, `errorSamples` y `consecutiveErrors` en `catalog_extract`; pausar automáticamente cuando se exceda `CATALOG_EXTRACT_CONSECUTIVE_ERROR_LIMIT`.
- CA: Cuando un sitio falla repetidamente, el run queda en pausa con `blockReason=consecutive_errors:N` y deja evidencia del último URL/etapa.
- Datos: `brands.metadata.catalog_extract`.
- NF: Sin cambios en extracción de datos; solo telemetría y control.
- Riesgos: Pausa prematura por errores transitorios; mitigación con umbral configurable.
- Métricas: Tiempo de diagnóstico, tasa de pausas por errores.
- Estado: **done (2026-01-23)**.

### MC-006 Autenticación y roles base
- Historia: Como admin, quiero iniciar sesión y proteger rutas, para operar seguro.
- Alcance: NextAuth/JWT, seed usuario admin, middleware RBAC (admin vs user), expiración de sesión, protección de rutas admin/API.
- CA: Login funcionando; rutas públicas no requieren auth; rutas admin bloquean sin token; refresh/expiración probados.
- Datos: tabla users con roles; sesiones si aplica.
- NF: Latencia login <400ms; tokens firmados con secreto rotado.
- Riesgos: Config errónea de callback URLs en Vercel; mitigar con env por ambiente.
- Métricas: Intentos fallidos de login; tiempo de sesión.
- Estado: **done (2026-01-19)**.

### MC-007 CI lint/test smoke
- Historia: Como equipo, quiero checks automáticos en PR, para evitar regresiones básicas.
- Alcance: GitHub Actions (lint, type-check, unit smoke), build contenedores base, gating opcional.
- CA: Workflow pasa en rama main/stg; falla si lint/test falla; artefacto de build opcional.
- Datos: N/A.
- NF: Duración pipeline <8 min.
- Riesgos: Dependencias nativas en runner; mitigar con cache npm.
- Métricas: % PR con CI verde a la primera; duración media.

### MC-008 Observabilidad mínima
- Historia: Como operador, quiero healthchecks y logs estructurados, para detectar caídas rápido.
- Alcance: /health para API/scraper/worker; logger JSON; traces básicos; dashboard inicial (logs+metrics) con contadores de errores.
- CA: Health devuelve 200; logs incluyen trace_id; panel muestra tasa de error por servicio.
- Datos: N/A.
- NF: Overhead de logging <5%.
- Riesgos: Ruido de logs; mitigar con niveles por ambiente.
- Métricas: MTTR inicial; tasa de errores 5xx.

## F1 – Next (primeras capacidades)

### MC-009 Taxonomía fija y catálogos
- Historia: Como curador de datos, quiero catálogos cerrados (categorías, materiales, patrones, fits, estilo/ocasión), para clasificar de forma consistente.
- Alcance: Definición y versionado; publicación a IA (prompt) y front (endpoint); validación server-side; mapeo de sinónimos.
- CA: Listas accesibles vía API; prompts consumen la versión; intento de valor fuera de catálogo devuelve error claro.
- Datos: Tabla taxonomy_tags con synonyms; version field.
- NF: Respuesta API <200ms.
- Riesgos: Falta de cobertura de términos; mitigar con backlog de sinónimos.
- Métricas: % productos con categoría/material válidos; tasa de errores de validación.

### MC-010 Búsqueda básica + pgvector
- Historia: Como usuario, quiero buscar y filtrar prendas relevantes, para encontrar rápido lo que me gusta.
- Alcance: Índice texto+embeddings (pgvector), endpoint search, facetas básicas, UI de listados VSF, orden por relevancia/stock.
- CA: Queries devuelven resultados en <600ms; facetas filtran correctamente; sin resultados muestra sugerencias.
- Datos: Embeddings de nombre/desc/captions; filtros por categoría, talla, color, precio.
- NF: P95 <900ms sin cache; P50 <400ms con cache/ISR.
- Riesgos: Falta de embeddings para imágenes; mitigar con fallback texto.
- Métricas: CTR de resultados, tiempo a primer resultado, tasa de “no results”.

### MC-011 Observabilidad scraping v1
- Historia: Como operador, quiero ver éxito/error por marca y frescura, para reintentar antes de que caduque información.
- Alcance: Métricas de éxito, latencia, staleness; alertas básicas; dashboard scraping.
- CA: Cada marca muestra última ejecución, estado, latencia; alerta cuando >24h sin update en top marcas.
- Datos: Tabla crawl_runs; hashes/deltas.
- NF: Recolección de métricas ligera (<3% overhead).
- Riesgos: Alertas ruidosas; mitigar con umbrales por categoría de marca.
- Métricas: Staleness promedio; tasa de bloqueos; reintentos.

### MC-012 Admin mínimo
- Historia: Como admin, quiero gestionar marcas/tiendas y aprobar normalizaciones IA, para asegurar calidad.
- Alcance: CRUD brands/stores; vista salud scraper; lista de normalizaciones pendientes con aprobar/rechazar; auth en todas las vistas.
- CA: Crear/editar/eliminar marca/tienda; aprobar item impacta DB; auditoría registra quién y cuándo.
- Datos: Campos de contacto, redes, horarios; estado de scraper por marca.
- NF: Respuesta vistas <700ms; tabla paginada.
- Riesgos: Ediciones destructivas; mitigar con confirmaciones y soft-delete.
- Métricas: Tiempo de aprobación, % items aprobados/rechazados.

### MC-036 Directorio de marcas admin (grid + CRUD)
- Historia: Como admin, quiero revisar la calidad de datos de marcas en un directorio visual y poder crear/editar/eliminar, para asegurar catálogo confiable.
- Alcance: `/admin/brands` con grid 3×5 por página, filtros procesadas/pendientes, modal con detalle completo, formulario de creación/edición y eliminación con soft-delete; endpoints CRUD `/api/admin/brands` y `/api/admin/brands/:id`.
- CA: Ver 15 marcas por página en cards; botón “Ver más” abre modal con toda la data; crear marca queda como pendiente de scraping; editar persiste cambios; eliminar desactiva (`isActive=false`).
- Datos: `brands`, `brand_scrape_jobs`, `products`.
- NF: Paginación estable y respuesta <700ms para listados.
- Riesgos: `metadata` muy grande; mitigación: visor con scroll en modal.
- Métricas: Completitud de campos clave y tiempo de revisión por marca.
- Estado: **done (2026-01-20)**.

### MC-037 Resiliencia scraping admin + separación de vistas
- Historia: Como admin, quiero que el scraping no se pierda al recargar y que las vistas estén separadas, para operar sin interrupciones.
- Alcance: Re-encolar jobs atascados (processing > N minutos), auto‑resume de batch tras recarga, mover scraping a `/admin/brands/scrape`, dejar directorio en `/admin/brands`, navegación lateral.
- CA: Jobs atascados vuelven a `queued`; al recargar, se reanuda el batch si estaba activo; menú lateral muestra entradas separadas; scraping y directorio en páginas distintas.
- Datos: `brand_scrape_jobs`.
- NF: Operación segura sin duplicar jobs; límite de re‑encolado configurable por env.
- Riesgos: Concurrencia de ejecuciones paralelas; mitigación con espera si hay job `processing`.
- Métricas: tiempo medio de recuperación de cola, cantidad de jobs re‑encolados.
- Estado: **done (2026-01-20)**.

### MC-038 Layout admin con sidebar anclado
- Historia: Como admin, quiero un menú lateral fijo a la izquierda para maximizar el espacio de trabajo.
- Alcance: Sidebar anclado en desktop, layout full‑width en admin, navegación intacta.
- CA: Sidebar permanece a la izquierda; el contenido principal usa mayor ancho; comportamiento responsivo mantiene acceso a navegación.
- Datos: N/A.
- NF: Sin saltos de layout; scroll independiente del contenido.
- Riesgos: Menú demasiado ancho en pantallas pequeñas; mitigación con layout responsivo.
- Métricas: Tiempo de navegación y visibilidad de paneles.
- Estado: **done (2026-01-20)**.

### MC-039 Mejoras cards marcas (logo + URLs clicables)
- Historia: Como admin, quiero ver el logo de la marca en el card y poder abrir URLs desde el modal para validar datos rápidamente.
- Alcance: Render de logo en cards si existe; campos URL en modal como enlaces clicables.
- CA: Cards muestran logo cuando existe; URLs (sitio, redes, logo) abren en nueva pestaña.
- Datos: `brands.logoUrl`, `siteUrl`, `instagram`, `tiktok`, `facebook`, `whatsapp`.
- NF: Fallback a iniciales si el logo falla.
- Riesgos: URLs sin esquema; mitigación con normalización `https://`.
- Métricas: Tiempo de verificación por marca.
- Estado: **done (2026-01-20)**.

### MC-040 Re‑enriquecimiento por marca (método 2)
- Historia: Como admin, quiero re‑enriquecer una marca con un método más potente desde la card, para mejorar calidad puntual.
- Alcance: Botón “Re‑enriquecer” por marca, endpoint dedicado, método 2 con 14 fuentes y 20k chars, mini‑progreso en card.
- CA: Ejecuta solo para una marca; no modifica el método base; muestra estado en la card.
- Datos: `brand_scrape_jobs`, `brands`.
- NF: Sin bloquear otros jobs; valida conflicto si hay job en cola.
- Riesgos: Requests largos; mitigación: registro en jobs y estado visible.
- Métricas: % re‑enriquecimientos exitosos, tiempo medio por marca.
- Estado: **done (2026-01-20)**.

### MC-041 Tech profiler de marcas
- Historia: Como admin, quiero identificar la tecnologia ecommerce de cada marca para mejorar el scraping y la calidad de datos.
- Alcance: Campo `brands.ecommercePlatform`, perfilador con señales (headers/cookies/scripts/paths), probes por plataforma (Shopify/Woo/Magento/VTEX) y fallback OpenAI; panel `/admin/brands/tech` con lotes 5/10/25/50/100; detalle visible en modal de marca.
- CA: Ejecutar un lote actualiza `ecommercePlatform` y guarda evidencia en `brands.metadata.tech_profile`; modal de marca muestra tecnologia; endpoints admin protegidos.
- Datos: `brands.ecommercePlatform`, `brands.metadata.tech_profile`.
- NF: Ejecucion en serie para evitar bloqueos; timeouts razonables.
- Riesgos: Sitios con anti‑bot o JS pesado; mitigacion con probes y fallback HTML.
- Métricas: % marcas con tecnologia detectada, tasa de fallos por lote, tiempo medio por marca.
- Estado: **done (2026-01-20)**.

### MC-042 Revisión manual de marcas
- Historia: Como admin, quiero marcar una marca como revisada manualmente desde el modal, para dejar trazabilidad de QA.
- Alcance: Campo `brands.manualReview` (boolean), check azul en la card, toggle en modal de marca, persistido en DB.
- CA: El toggle cambia el estado en UI y DB; las cards muestran el check azul cuando la marca fue revisada.
- Datos: `brands.manualReview`.
- NF: Cambios inmediatos sin recargar la pagina.
- Riesgos: Estados inconsistentes si falla la API; mitigacion con mensajes de error.
- Métricas: % de marcas revisadas manualmente, tiempo promedio de revisión por marca.
- Estado: **done (2026-01-20)**.

### MC-043 Catalog extractor por tecnología
- Historia: Como admin, quiero extraer el catálogo de productos por tecnología (Shopify/Woo/Magento/VTEX/Custom) para poblar productos/variantes con precios, tallas, colores y disponibilidad.
- Alcance: Adaptadores por plataforma con discovery + fetch; normalización con OpenAI (JSON schema) a modelo canónico; subida de imágenes a Vercel Blob; upsert en `products` y `variants`; panel `/admin/catalog-extractor` para pruebas con límite de productos.
- CA: Seleccionar marca con `ecommercePlatform` y ejecutar extracción guarda productos/variantes; URLs externas de producto se guardan; imágenes quedan en Blob y se registran en DB; errores se muestran en el panel.
- Datos: `products`, `variants`, `assets` (opcional), `brands.ecommercePlatform`.
- NF: Ejecución secuencial y límite configurable por run; logging de errores por producto.
- Riesgos: Catálogos grandes o endpoints bloqueados; mitigación con límites y fallback genérico.
- Métricas: productos extraídos por run, tasa de error por producto, % variantes con stock_status.
- Estado: **done (2026-01-20)**.

### MC-044 Directorio de productos admin
- Historia: Como admin, quiero ver los productos scrapeados en un grid con filtros por marca y detalle completo para auditar calidad.
- Alcance: Panel `/admin/products` con cards, modal de detalle y paginación; filtro por marca; endpoints para listado, marcas y detalle.
- CA: Cards muestran imagen, nombre, rango de precios, variantes y stock; modal muestra atributos, tags y variantes; filtro por marca funciona.
- Datos: `products`, `variants`, `brands`.
- NF: Paginación 3x5 (15 por página), orden por `updatedAt`.
- Riesgos: Muchos productos; mitigación con paginación y agregados.
- Métricas: productos visualizados por sesión, tiempo de carga de página.
- Estado: **done (2026-01-20)**.

### MC-045 Progreso extractor de productos
- Historia: Como admin, quiero una barra de progreso informativa al correr el extractor para saber cuánto falta y detectar fallos.
- Alcance: Barra de progreso con completados/fallidos/pendientes, estado de run; resumen más informativo en `/admin/catalog-extractor`.
- CA: La UI muestra % completado, conteos y estado; si falla OpenAI, el sistema no marca el producto como completo.
- Datos: `brands.metadata.catalog_extract`.
- NF: No afecta el throughput; actualiza al finalizar cada batch.
- Riesgos: Runs largos; mitigación con `max_runtime_ms` y reanudación.
- Métricas: % completado por batch, tasa de fallos OpenAI/Blob.
- Estado: **done (2026-01-20)**.

### MC-046 Reglas de moneda y reset de catálogo
- Historia: Como admin, necesito que el extractor interprete precios correctamente (USD vs COP) y reiniciar catálogo para evitar datos inconsistentes.
- Alcance: Parseo de precios con miles (`160.000` → `160000`), inferencia de moneda (<=999 USD, >=10000 COP), campo `currency` en productos y variantes; truncate de productos/variantes.
- CA: El extractor asigna moneda coherente; productos y variantes nuevos tienen moneda definida; catálogo anterior eliminado.
- Datos: `products.currency`, `variants.currency`.
- NF: Sin impacto en performance de scraping.
- Riesgos: Precios con formatos mixtos; mitigación con parsing robusto y fallback a moneda explícita.
- Métricas: % productos con moneda definida, % precios parseados correctamente.
- Estado: **done (2026-01-20)**.

### MC-047 Cambiar modelo OpenAI a gpt-5-mini
- Historia: Como operador, quiero bajar costos de inferencia cambiando el modelo por defecto a gpt-5-mini.
- Alcance: Actualizar default de `OPENAI_MODEL` en scrapers (marcas, tech, catálogo) y docs.
- CA: En ausencia de `OPENAI_MODEL`, se usa `gpt-5-mini`.
- Datos: Configuración de entorno.
- NF: Sin cambios funcionales en flujos.
- Riesgos: Posible degradación leve de calidad; mitigación con validación JSON estricta.
- Métricas: Costo promedio por run.
- Estado: **done (2026-01-20)**.

### MC-048 Evidencia textual limpia en scraper de marcas
- Historia: Como admin, quiero que la evidencia enviada a OpenAI sea texto limpio y no HTML ruidoso, para mejorar consistencia y reducir ruido.
- Alcance: Limpieza HTML→texto con preservación de saltos, filtrado de líneas cortas, priorización por señales (contacto/redes/ubicación) y deduplicación.
- CA: `evidence_texts` no contiene HTML; líneas relevantes aparecen primero; se mantiene mínimo de fuentes configurado.
- Datos: `brands.metadata.brand_scrape.evidence_sources`.
- NF: No aumentar latencia de scraping; comportamiento determinístico.
- Riesgos: Filtrar demasiado contenido útil; mitigación con fallback a líneas no prioritarias.
- Métricas: Tasa de validación de OpenAI y % campos completos por marca.
- Estado: **done (2026-01-21)**.

### MC-049 Volver a modelo OpenAI gpt-5.2
- Historia: Como operador, quiero volver al modelo gpt-5.2 para maximizar calidad del enriquecimiento y normalización.
- Alcance: Default `OPENAI_MODEL` a `gpt-5.2` en scrapers/normalizer, `.env.example` y documentación.
- CA: Si no se define `OPENAI_MODEL`, se usa `gpt-5.2` en marcas, tech profiler y catálogo.
- Datos: Variables de entorno.
- NF: Sin cambios funcionales en flujos; impacto solo en costo/calidad.
- Riesgos: Costo mayor; mitigación con límites de fuentes y evidencia limpia.
- Métricas: Tasa de validación y completitud por marca/producto.
- Estado: **done (2026-01-21)**.

### MC-050 Fix Unicode en tech profiler
- Historia: Como admin, quiero que el profiler de tecnología no falle por caracteres Unicode inválidos para poder procesar todas las marcas.
- Alcance: Sanitizar Unicode en perfiles/evidencia, y parseo JSON tolerante para respuestas OpenAI.
- CA: `/api/admin/brands/tech/next` no responde 500 por "unsupported Unicode escape sequence"; metadata se guarda sin errores.
- Datos: `brands.metadata.tech_profile`.
- NF: Sin pérdida crítica de evidencia; procesamiento estable.
- Riesgos: Sanitizado excesivo de strings; mitigación con reemplazo mínimo de surrogates inválidos.
- Métricas: % tech profiler exitoso y tasa de errores 500.
- Estado: **done (2026-01-21)**.

### MC-051 Catalog extractor por tecnologia (play/pause/stop + resume)
- Historia: Como admin, quiero ejecutar el extractor por tecnologia con controles de play/pausa/detener y reanudación automática para revisar catálogos sin perder progreso.
- Alcance: Selección por plataforma, auto‑selección de marca siguiente, sitemap‑first, pausa/stop vía API, reanudación por cursor guardado en metadata.
- CA: El panel permite elegir tecnología; el extractor procesa marca actual producto a producto; pausar/detener funciona; tras fallo o recarga reanuda desde el cursor.
- Datos: `brands.metadata.catalog_extract`.
- NF: Sin duplicar productos; reanudación determinística.
- Riesgos: Sitemaps incompletos; mitigación con fallback a discovery adapter.
- Métricas: % runs reanudables, tiempo medio por producto.
- Estado: **done (2026-01-21)**.

### MC-052 Errores visibles en catalog extractor
- Historia: Como admin, quiero ver claramente por qué falló el extractor para poder corregirlo rápido.
- Alcance: Mostrar último error, bloqueos y errores recientes en el panel `/admin/catalog-extractor`.
- CA: Al fallar, el panel muestra mensaje y URL/razón; bloqueos por Blob aparecen como “Proceso bloqueado”.
- Datos: `brands.metadata.catalog_extract`, `summary.errors`.
- NF: UI ligera, sin afectar performance.
- Riesgos: Mensajes muy largos; mitigación con truncado/últimos 5.
- Métricas: Tiempo de diagnóstico y tasa de resolución.
- Estado: **done (2026-01-21)**.

### MC-053 Fix VTEX linkText en sitemap + error claro
- Historia: Como admin, quiero que el extractor VTEX funcione con URLs de sitemap para no fallar con `raw vacío`.
- Alcance: Derivar `linkText` desde URL (`/slug/p`) y mejorar mensaje de error cuando `fetchProduct` devuelve null.
- CA: VTEX procesa productos desde sitemap; si falla, el error incluye plataforma y URL.
- Datos: `brands.metadata.catalog_extract`.
- NF: Sin cambios en otras plataformas.
- Riesgos: URLs VTEX no estándar; mitigación con fallback a handle existente.
- Métricas: % productos VTEX procesados exitosamente.
- Estado: **done (2026-01-21)**.

### MC-035 Scraper de marcas (enriquecimiento OpenAI)
- Historia: Como admin, quiero enriquecer datos de marcas con búsqueda web y actualizar Neon, para mantener redes/website/contacto consistentes.
- Alcance: Panel `/admin/brands` con selección 1/5/10/25/50; cola secuencial; endpoints `/api/admin/brands/scrape`, `/api/admin/brands/scrape/next` y `/api/admin/brands/scrape/cron`; OpenAI GPT‑5.2 JSON mode con `web_search`; fallback HTML fetch sin Playwright; actualización de tabla `brands` y metadata de scraping; cron en Vercel cada 5 minutos.
- CA: Encolar marcas crea jobs; procesamiento secuencial actualiza campos estándar (city/category/market/scale/style) con valores válidos; logs visibles en admin; jobs con diff de cambios; job queda en estado completed/failed.
- Datos: `brand_scrape_jobs` para cola e histórico; metadata `brand_scrape` en `brands`; resultado con diff before/after.
- NF: Un job por request; batch en cron limitado por tiempo; retries en OpenAI; timeout razonable por ejecución.
- Riesgos: Respuesta inválida de IA o falta de evidencia; mitigar con validación Zod + fallback HTML; mantener valores existentes si no hay evidencia nueva.
- Métricas: Tiempo por marca, tasa de éxito, campos actualizados por corrida.
- Estado: **done (2026-01-19)**.

### MC-013 Anuncios básicos
- Historia: Como advertiser, quiero colocar placements simples y medir clics, para validar el modelo de anuncios.
- Alcance: Modelo placements; inventario de slots (home/listado/ficha); carga creativa (imagen/copy/link); tracking impresiones/clicks; reglas básicas (fechas, presupuesto).
- CA: Anuncio se muestra en slots configurados; clics/imps se registran; puede pausar/reanudar.
- Datos: Tabla placements/creatives; logs de eventos.
- NF: Latencia extra <50ms por render; no afecta Core Web Vitals.
- Riesgos: Colisiones de slots; mitigar con prioridad y fallback.
- Métricas: CTR por slot, gasto vs presupuesto, fill rate.

### MC-014 10–20 marcas integradas
- Historia: Como negocio, quiero cobertura inicial de mercado, para ofrecer variedad a usuarios.
- Alcance: Parsers templated por tipo de sitio; scheduler adaptativo; onboarding de 10–20 marcas; QA de datos.
- CA: ≥10 marcas con catálogo visible; frescura <72h; errores críticos <5% por marca.
- Datos: Catalogo completo (productos, variantes, imágenes, precios).
- NF: Throughput estable; colas sin backlog >24h.
- Riesgos: Bloqueos anti-bot; mitigar con rotación UA/proxy y delta hashing.
- Métricas: Marcas activas, frescura promedio, tasa de parse fallido.

### MC-015 Emails y plantillas
- Historia: Como operador, quiero enviar correos transaccionales con plantillas, para comunicar eventos (alta, alertas, restock).
- Alcance: SMTP/SendGrid; plantillas versionadas; opt-in/opt-out; logs de envío; variables dinámicas.
- CA: Envío exitoso en sandbox y prod; opt-out persiste; preview de plantilla en admin.
- Datos: Tabla templates/logs; preferencia de usuario.
- NF: Entrega <2 min; SPF/DKIM/DMARC configurados.
- Riesgos: Spam; mitigar con reputación y throttling.
- Métricas: Tasa de entrega, apertura, rebotes, quejas.

### MC-016 ISR/Cache y performance
- Historia: Como usuario, quiero que la página cargue rápido, para navegar sin fricción.
- Alcance: ISR en páginas de catálogo/ficha; cache headers; optimización de imágenes; budgets CWV; revalidación on-demand tras upserts.
- CA: CWV objetivos: LCP <2.5s, CLS <0.1, INP <200ms en P75; revalidación tras cambios de producto.
- Datos: Control de `last_modified` y `etag`.
- NF: Edge caché Vercel; fallback estático si API falla.
- Riesgos: Cache staleness; mitigar con revalidate tags y SWR.
- Métricas: CWV, tasa de revalidaciones, hit ratio CDN.

### MC-017 Gestión de secrets/entornos
- Historia: Como DevOps, quiero secretos por ambiente y rotables, para mantener seguridad y trazabilidad.
- Alcance: Matriz env (local/stg/prod); checklist de variables; rotación documentada; validación en CI; storage seguro (Vercel env/ vault).
- CA: CI falla si falta secreto; docs indican cómo rotar; secretos no se filtran en logs.
- Datos: OPENAI, NEON, REDIS, BLOB, Wompi, SMTP, NEXTAUTH, etc.
- NF: Rotación trimestral; acceso mínimo.
- Riesgos: Fuga de secretos; mitigar con escaneo y políticas.
- Métricas: Incidentes de secretos; tiempo de rotación.

## F2 – Later (escalado y premium inicial)

### MC-018 Recomendador híbrido v1
- Historia: Como usuario, quiero ver productos similares a mis intereses, para descubrir más opciones relevantes.
- Alcance: Embeddings texto/imagen; kNN con filtros stock/talla; endpoint `/recommend/similar`; slot en ficha/listados.
- CA: Respuestas <700ms; respetan stock/talla; mínimo 5 ítems; fallback a popular si no hay vecinos.
- Datos: Embeddings almacenados en pgvector; señales básicas de comportamiento.
- NF: P95 <900ms; job de refresco diario de embeddings.
- Riesgos: Sesgo por marcas grandes; mitigar con diversificación.
- Métricas: CTR recomendaciones, diversidad de marcas, cobertura por categoría.

### MC-019 Recomendaciones proactivas + alertas
- Historia: Como usuario pago, quiero alertas de drops y back-in-stock, para no perder lanzamientos.
- Alcance: Suscripción a alertas; jobs que detectan cambios; canales email/push; preferencias por categoría/talla/color; control por plan.
- CA: Usuario configura alerta; recibe notificación oportuna (<2h del cambio); respeta opt-out.
- Datos: Tabla alertas; historico de envíos y cumplimiento.
- NF: Entrega confiable; deduplicación por usuario-evento.
- Riesgos: Bombardeo de correos; mitigar con rate limit y digest.
- Métricas: Tasa de conversión post-alerta, tiempo de entrega, unsub rate.

### MC-020 Planes pagos Wompi
- Historia: Como negocio, quiero cobrar suscripciones y habilitar features premium, para monetizar la plataforma.
- Alcance: Checkout Wompi, webhooks, asignación de plan, flags de features (proactivo, try-on, menos anuncios), recibos básicos.
- CA: Pago prueba exitoso en sandbox y prod; webhooks idempotentes; plan reflejado en cuenta; downgrade/upgrade soportados.
- Datos: Tabla billing_payments, webhooks logs, plan en users.
- NF: Disponibilidad de billing 99.5%; P95 webhook handling <1s.
- Riesgos: Webhooks duplicados; mitigar con idempotency keys.
- Métricas: MRR, churn, fallo de cobros.

### MC-021 Try-on IA MVP
- Historia: Como usuario, quiero previsualizar cómo me queda una prenda, para decidir mejor antes de ir a la tienda.
- Alcance: Upload seguro a Blob; pipeline async (cola + worker); expiración/borrado; vista de resultado; disclaimers de precisión.
- CA: Upload autenticado; resultado en <5 min; botón de borrar; expiración automática; tamaños/formatos validados.
- Datos: Assets asociados a sesión/usuario; metadatos de expiración.
- NF: Protección de privacidad; cifrado en tránsito; retención limitada.
- Riesgos: Abuso de contenido; mitigar con moderación (OpenAI filters).
- Métricas: Tasa de completado, tiempo de procesamiento, solicitudes de borrado.

### MC-022 Panel advertiser
- Historia: Como advertiser, quiero crear campañas con presupuesto y ver CTR/CPA, para optimizar gasto.
- Alcance: CRUD campañas, targeting simple (categoría/estilo), presupuesto diario, reporte de impresiones/clics/conversion a click-out, pausar/reanudar.
- CA: Campaña activa muestra anuncios; budget cap respeta límite; reportes diarios exportables.
- Datos: Campaigns, placements, spend logs.
- NF: Cálculo de métricas en batch diario; UI responde <800ms.
- Riesgos: Fraude de clics; mitigar con filtros/IP/device heuristics.
- Métricas: CTR, CPA (click-out), gasto vs budget, fill rate.

### MC-023 Versionado de prompts + FinOps IA
- Historia: Como operador IA, quiero versionar prompts y medir costos, para optimizar calidad y gasto.
- Alcance: Tabla prompts/version; registro de costo por llamada; límites diarios por marca; dashboard de drift/error rate.
- CA: Cada llamada almacena prompt_version/model/cost; alertas si se supera budget diario; rollback a versión previa posible.
- Datos: ai_normalizations, costos agregados.
- NF: Sobrecarga de logging mínima.
- Riesgos: Falta de disciplina en releases; mitigar con checklist y approvals.
- Métricas: Costo por item, error rate IA, tiempo de inferencia.

### MC-024 Escalado a 100+ marcas
- Historia: Como negocio, quiero cubrir 100+ marcas sin perder frescura, para crecer tráfico y valor.
- Alcance: Pool de proxies, crawler de respaldo, priorización por rotación/frescura, tuning de colas, paralelismo controlado.
- CA: ≥100 marcas activas; frescura top 100 <24h; error rate scraping <5%; consumo de tokens dentro de budget.
- Datos: crawler metrics, staleness.
- NF: Workers horizontales; tolerancia a fallas de proxies.
- Riesgos: Bloqueos masivos; mitigar con rotación y acuerdos con marcas.
- Métricas: Frescura media, throughput (páginas/h), bloqueos por 4xx/5xx.

### MC-025 Data quality & drift dashboard
- Historia: Como data steward, quiero ver completitud, duplicados y drift, para corregir rápido.
- Alcance: Métricas por marca/categoría; alerta por campos faltantes, duplicados, outliers de precio/stock; drift en salidas IA.
- CA: Dashboard con filtros; alertas configurables; export de casos a CSV; enlaces a registros para corregir.
- Datos: quality snapshots, drift logs.
- NF: Actualización diaria; consultas <1s.
- Riesgos: Métricas ruidosas; mitigar con umbrales y smoothing.
- Métricas: % completitud, duplicados, outliers detectados/corregidos.

### MC-026 Gestión de colas y reintentos
- Historia: Como operador, quiero reintentos con prioridad y DLQ, para resiliencia del pipeline.
- Alcance: Retries exponenciales; DLQ; priorización por marca/frescura; botones de requeue en admin; métricas de colas.
- CA: Mensajes fallidos llegan a DLQ; requeue funciona; SLA de procesamiento cumplido.
- Datos: Cola principal, DLQ, metadatos de intento.
- NF: Garantía al menos una vez; visibilidad de estado.
- Riesgos: Reprocesamiento duplicado; mitigar con idempotency keys.
- Métricas: Retries, tasa de DLQ, tiempo en cola.

## F3 – Later (madurez y hardening)

### MC-027 Segmentación estilo/ocasión + A/B ranking
- Historia: Como usuario, quiero resultados alineados a mi estilo/ocasión, para recibir sugerencias más relevantes.
- Alcance: Perfiles de estilo/ocasión; cohortes; motor de ranking con variantes; experimentos A/B; reporting por variante.
- CA: Usuario puede elegir/derivar su estilo; experimento asigna cohortes; métricas se registran; rollback posible.
- Datos: Perfil usuario, señales de comportamiento, variantes de ranking.
- NF: No degradar P95 de búsqueda; aislamiento de cohortes.
- Riesgos: Sesgos; mitigar con límites de exposición y evaluación offline.
- Métricas: CTR por cohorte, lift vs control, retención.

### MC-028 Store locator enriquecido
- Historia: Como usuario, quiero ubicar tiendas con horarios, teléfonos y redes, para visitar o contactar fácilmente.
- Alcance: Geocodificación; datos de contacto/redes; filtros por ciudad; mapa y lista; integración con datos frescos del scraper.
- CA: Buscar por ciudad muestra tiendas correctas; horarios/phones actualizados; enlace a redes funciona; mapa carga rápido.
- Datos: stores con lat/lng, horarios, phones, socials.
- NF: P95 <800ms; caching geocoding; accesible móvil.
- Riesgos: Datos desactualizados; mitigar con staleness checks y alertas.
- Métricas: Clicks en “cómo llegar”, llamadas iniciadas, frescura de datos tienda.

### MC-029 Seguridad y privacidad reforzada
- Historia: Como negocio, quiero proteger datos y cumplir políticas, para reducir riesgos legales y de reputación.
- Alcance: WAF/rate limit afinado; auditoría completa; borrado/anonimización try-on; revisión de permisos; políticas de retención.
- CA: Tests de penetración básicos; logs de auditoría por acción; endpoint de borrado de datos personales funcional; rate limit configurado.
- Datos: Auditoría en tabla dedicada; flags de retención.
- NF: Disponibilidad >99.5%; impacto mínimo en latencia.
- Riesgos: Falsos positivos en WAF; mitigar con listas permitidas.
- Métricas: Incidentes de seguridad, tasas de 429, tiempo de cumplimiento de borrado.

### MC-030 Optimización de costos infra
- Historia: Como FinOps, quiero reducir costos sin perder frescura, para mantener margen.
- Alcance: Cache de inferencias sin cambios; compresión/derivados de assets; tuning de colas/batch; reportes de ahorro.
- CA: Tokens/día por marca bajo objetivo; tamaño medio de imagen reducido; informes mensuales de costo.
- Datos: Cost logs, tamaños de assets.
- NF: Sin degradar KPIs de frescura ni CWV.
- Riesgos: Cache obsoleta; mitigar con invalidación por delta hash.
- Métricas: Costo OpenAI/brand, costo CDN/GB, ahorro mensual.

### MC-031 Despliegue prod Vercel + contenedores workers
- Historia: Como equipo, quiero releases seguras con stg/prod y monitoreo, para operar con confianza.
- Alcance: Ramas stg/prod; CI/CD completo; previews; despliegue de workers/scrapers en contenedores; monitoreo post-deploy; rollback.
- CA: Pipeline despliega a stg y prod con approvals; workers reciben nueva imagen; alarmas post-deploy; rollback <10 min.
- Datos: Versiones de imagen, changelog.
- NF: Disponibilidad 99.5%; deployments sin downtime perceptible.
- Riesgos: Drift de config entre envs; mitigar con IaC y checks.
- Métricas: Éxito de deploys, tiempo de rollback, incidentes post-release.

### MC-032 Cobertura 500 marcas
- Historia: Como negocio, quiero indexar 500 marcas con SLAs de frescura, para ser el catálogo líder.
- Alcance: Escalado de scraping; acuerdos con marcas; tuning de priorización; capacidad de proxies; monitoreo de SLAs.
- CA: 500 marcas activas; frescura top 100 <24h, resto <72h; error rate <5%; costos dentro de budget.
- Datos: Listado de marcas y SLAs; staleness per brand.
- NF: Throughput sostenido; auto-escalado de workers.
- Riesgos: Costos de proxy/IA; mitigar con batching y feeds oficiales cuando existan.
- Métricas: Cobertura, frescura, costo por marca, bloqueos.

### MC-033 Legal/compliance y políticas
- Historia: Como negocio, quiero operar en regla (robots/takedown/privacidad), para evitar riesgos legales.
- Alcance: Términos y Privacidad publicados; procesos de takedown; manejo de robots y opt-outs; retención y borrado; registro de consentimientos.
- CA: Páginas legales accesibles; formulario de takedown operativo; robots honored; log de solicitudes y tiempos de respuesta.
- Datos: Registro de consentimientos, solicitudes de borrado.
- NF: SLA de respuesta a solicitudes; trazabilidad completa.
- Riesgos: Inconsistencia entre mercados; mitigar con revisión legal periódica.
- Métricas: Solicitudes atendidas, tiempo de respuesta, incidentes legales.

### MC-034 Performance & resiliencia front
- Historia: Como usuario, quiero que la app siga usable aun con fallas parciales, para confiar en el servicio.
- Alcance: Budgets CWV; fallbacks cuando catálogo falla (mensajes, reintentos); manejo de timeouts; pruebas de resiliencia; prefetch inteligente.
- CA: CWV en objetivos; simulación de fallo de API muestra fallback; sin pantallas en blanco; errores trazados.
- Datos: Telemetría de errores front.
- NF: P95 navigation <1s cache hit; sin saltos visuales (CLS).
- Riesgos: Fallbacks que ocultan fallas reales; mitigar con alertas y circuit breakers.
- Métricas: CWV, error rate front, tiempo de recuperación de fallos simulados.

---
**Protocolo al desarrollar cualquier historia**  
0) Pedir al solicitante requisitos previos: credenciales/API keys, definiciones o datos faltantes, accesos (Vercel, Neon, Wompi, Blob), variables de entorno.  
1) Rebuild de contenedores/docker tras los cambios.  
2) Escuchar la salida del rebuild y corregir errores.  
3) Hacer push a la rama de trabajo.  
4) Esperar y revisar el build en Vercel hasta que termine correctamente (si falla, diagnosticar y corregir).  
5) Actualizar el README con cambios relevantes.  
6) Marcar la historia como terminada en `USER_STORIES.md`, `BACKLOG.md` y `STATUS.md` (resumen).
