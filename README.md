# ODA Storefront

Plataforma headless para indexar ~500 marcas de moda colombiana, normalizar catálogos vía OpenAI GPT-5.1 (JSON mode), enriquecer productos vía OpenAI y servir búsqueda/recomendaciones en Next.js + Vue Storefront, con backend BFF, scrapers y workers como servicios Node. Despliegue objetivo: Vercel (web/BFF) + runners dedicados para scrapers/workers (sin Docker por ahora).

## Estructura
- `apps/web` – Front + BFF en Next.js (App Router, TS, Tailwind).
- `services/scraper` – Scraper stub (Node) listo para integrar descubrimiento de sitemap y parsers por marca.
- `services/worker` – Worker stub (BullMQ) para orquestar ingestión y pipeline IA.
- `apps/web/vercel.json` – Crons de Vercel (rootDirectory = apps/web).
- `AGENTS.md`, `BACKLOG.md`, `USER_STORIES.md`, `STATUS.md` – Documentación y control operativo.

## Requisitos
- Node 22.x, npm.
- Acceso a Neon/Redis remotos vía `.env`.

## Variables de entorno
Copiar `.env.example` a `.env`/`.env.local` y completar:
- Core: `OPENAI_API_KEY`, `OPENAI_MODEL` (opcional, default `gpt-5.1`), `OPENAI_WEB_SEARCH` (opcional), `NEXTAUTH_SECRET`, `VERCEL_TEAM_ID`, `VERCEL_TOKEN`.
- Vercel CLI: usar `VERCEL_TOKEN` desde `.env` (no solicitarlo de nuevo).
- Base de datos (Neon): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_DATABASE_URL`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`.
- Redis: `REDIS_URL`.
- Storage: `VERCEL_BLOB_READ_WRITE_TOKEN`, `BLOB_READ_WRITE_TOKEN`.
- Billing: `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`.
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
- Auth usuarios (Descope): `NEXT_PUBLIC_DESCOPE_PROJECT_ID`, `NEXT_PUBLIC_DESCOPE_BASE_URL`, `NEXT_PUBLIC_DESCOPE_SIGNIN_FLOW_ID`, `NEXT_PUBLIC_DESCOPE_LINK_FLOW_ID`, `DESCOPE_MANAGEMENT_KEY`.
- Scraper: `USER_AGENT`, `BRAND_SCRAPE_MAX_JOBS`, `BRAND_SCRAPE_MAX_RUNTIME_MS`.
- Scraper: `BRAND_SCRAPE_STALE_MINUTES` (re-encola jobs en `processing` con más de N minutos).
- Catalog extractor: `CATALOG_TRY_SITEMAP_FIRST` (true|false), `CATALOG_TRY_SITEMAP_VTEX` (true|false), `CATALOG_FORCE_SITEMAP` (true|false), `CATALOG_EXTRACT_SITEMAP_BUDGET_MS`, `CATALOG_EXTRACT_SITEMAP_LIMIT` (0 = sin límite), `CATALOG_EXTRACT_SITEMAP_MAX_FILES`, `CATALOG_EXTRACT_SITEMAP_SCAN_MAX_URLS` (0 = sin límite por sitemap), `CATALOG_EXTRACT_DISCOVERY_LIMIT`, `CATALOG_DISCOVERY_MULTIPLIER`, `CATALOG_DISCOVERY_MAX_LIMIT`, `CATALOG_SITEMAP_MAX_LIMIT`, `CATALOG_EXTRACT_MAX_RUNTIME_MS`, `CATALOG_EXTRACT_CONSECUTIVE_ERROR_LIMIT`, `CATALOG_AUTO_PAUSE_ON_ERRORS`, `CATALOG_MAX_ATTEMPTS`, `CATALOG_QUEUE_ENQUEUE_LIMIT`, `CATALOG_QUEUE_NAME`, `CATALOG_QUEUE_STALE_MINUTES`, `CATALOG_ITEM_STUCK_MINUTES`, `CATALOG_RESUME_STUCK_MINUTES`, `CATALOG_QUEUE_TIMEOUT_MS`, `CATALOG_QUEUE_DISABLED`, `CATALOG_QUEUE_ATTEMPTS`, `CATALOG_QUEUE_BACKOFF_MS`, `CATALOG_DRAIN_BATCH`, `CATALOG_DRAIN_MAX_RUNTIME_MS`, `CATALOG_DRAIN_CONCURRENCY`, `CATALOG_DRAIN_MAX_RUNS`, `CATALOG_DRAIN_ON_RUN`, `CATALOG_DRAIN_ON_RUN_BATCH`, `CATALOG_DRAIN_ON_RUN_MAX_RUNTIME_MS`, `CATALOG_DRAIN_ON_RUN_CONCURRENCY`, `CATALOG_DRAIN_DISABLED`, `CATALOG_WORKER_CONCURRENCY`, `CATALOG_WORKER_API_URL`, `CATALOG_WORKER_FETCH_TIMEOUT_MS`, `CATALOG_LLM_NORMALIZE_MODE` (auto|always|never), `CATALOG_LLM_NORMALIZE_DISABLE_MINUTES`, `CATALOG_LLM_NORMALIZE_MAX_DESC_CHARS`, `CATALOG_LLM_NORMALIZE_MAX_IMAGES`, `CATALOG_LLM_NORMALIZE_MAX_VARIANTS`, `CATALOG_LLM_NORMALIZE_MAX_OPTION_VALUES`.
- Catálogo público (precio): `CATALOG_PRICE_MAX_VALID` (default `100000000`) define el techo de precio válido para PLP/filtros/sort y saneamiento de ingestión (evita outliers corruptos).
- Catalog VTEX: `CATALOG_VTEX_MAX_PRODUCTS`, `CATALOG_VTEX_PAGE_SIZE`.
- Catalog refresh semanal: `CATALOG_REFRESH_INTERVAL_DAYS`, `CATALOG_REFRESH_JITTER_HOURS`, `CATALOG_REFRESH_MAX_BRANDS`, `CATALOG_REFRESH_BRAND_CONCURRENCY`, `CATALOG_REFRESH_MAX_RUNTIME_MS`, `CATALOG_REFRESH_MIN_GAP_HOURS`, `CATALOG_REFRESH_MAX_FAILED_ITEMS`, `CATALOG_REFRESH_MAX_FAILED_RATE`, `CATALOG_REFRESH_DISCOVERY_LIMIT` (0 = sin límite), `CATALOG_REFRESH_COVERAGE_ENABLED`, `CATALOG_REFRESH_AUTO_RECOVER`, `CATALOG_REFRESH_RECOVER_MAX_RUNS`, `CATALOG_REFRESH_RECOVER_STUCK_MINUTES`, `CATALOG_REFRESH_ENRICH_RECOVER_STUCK_MINUTES`, `CATALOG_REFRESH_FAILED_LOOKBACK_DAYS`, `CATALOG_REFRESH_FAILED_URL_LIMIT`, `CATALOG_REFRESH_ENRICH_LOOKBACK_DAYS`, `CATALOG_REFRESH_ENRICH_MAX_PRODUCTS`, `CATALOG_REFRESH_DRAIN_ON_RUN`, `CATALOG_ALERT_STUCK_MINUTES`, `PRODUCT_ENRICHMENT_ALERT_STUCK_MINUTES`.
- Catalog extractor (PDP LLM): `CATALOG_OPENAI_MODEL`, `CATALOG_OPENAI_TEMPERATURE`, `CATALOG_OPENAI_DISABLE_TEMPERATURE`, `CATALOG_PDP_LLM_ENABLED`, `CATALOG_PDP_LLM_CONFIDENCE_MIN`, `CATALOG_PDP_LLM_MAX_HTML_CHARS`, `CATALOG_PDP_LLM_MAX_TEXT_CHARS`, `CATALOG_PDP_LLM_MAX_IMAGES`.
- Product enrichment (switch OpenAI/Bedrock): `PRODUCT_ENRICHMENT_PROVIDER` (`openai|bedrock`), `PRODUCT_ENRICHMENT_MODEL`, `BEDROCK_INFERENCE_PROFILE_ID`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `PRODUCT_ENRICHMENT_MAX_TOKENS`, `PRODUCT_ENRICHMENT_MAX_RETRIES`, `PRODUCT_ENRICHMENT_MAX_ATTEMPTS`, `PRODUCT_ENRICHMENT_MAX_IMAGES`, `PRODUCT_ENRICHMENT_VARIANT_CHUNK_SIZE`, `PRODUCT_ENRICHMENT_REPAIR_MAX_CHARS`, `PRODUCT_ENRICHMENT_BEDROCK_MAX_IMAGES`, `PRODUCT_ENRICHMENT_BEDROCK_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_BEDROCK_INCLUDE_IMAGES`, `PRODUCT_ENRICHMENT_BEDROCK_IMAGE_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_BEDROCK_IMAGE_MAX_BYTES`, `PRODUCT_ENRICHMENT_BEDROCK_TOP_K`, `PRODUCT_ENRICHMENT_BEDROCK_TEMPERATURE`, `PRODUCT_ENRICHMENT_BEDROCK_LATENCY`, `PRODUCT_ENRICHMENT_BEDROCK_STOP_SEQUENCES`, `PRODUCT_ENRICHMENT_QUEUE_NAME`, `PRODUCT_ENRICHMENT_QUEUE_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_QUEUE_DISABLED`, `PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT`, `PRODUCT_ENRICHMENT_QUEUE_STALE_MINUTES`, `PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES`, `PRODUCT_ENRICHMENT_RESUME_STUCK_MINUTES`, `PRODUCT_ENRICHMENT_AUTO_PAUSE_ON_ERRORS`, `PRODUCT_ENRICHMENT_CONSECUTIVE_ERROR_LIMIT`, `PRODUCT_ENRICHMENT_DRAIN_ON_RUN`, `PRODUCT_ENRICHMENT_DRAIN_BATCH`, `PRODUCT_ENRICHMENT_DRAIN_MAX_RUNTIME_MS`, `PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY`, `PRODUCT_ENRICHMENT_DRAIN_MAX_RUNS`, `PRODUCT_ENRICHMENT_WORKER_CONCURRENCY`, `PRODUCT_ENRICHMENT_WORKER_API_URL`, `PRODUCT_ENRICHMENT_WORKER_FETCH_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_ALLOW_REENRICH`.
- PLP SEO (admin + Bedrock + cola): `PLP_SEO_BEDROCK_INFERENCE_PROFILE_ID` (fallback: `BEDROCK_INFERENCE_PROFILE_ID`), `PLP_SEO_BEDROCK_MAX_TOKENS`, `PLP_SEO_BEDROCK_TIMEOUT_MS`, `PLP_SEO_BEDROCK_TEMPERATURE`, `PLP_SEO_BEDROCK_TOP_K`, `PLP_SEO_MAX_RETRIES`, `PLP_SEO_SAMPLE_PRODUCTS`, `PLP_SEO_MAX_ATTEMPTS`, `PLP_SEO_QUEUE_NAME`, `PLP_SEO_QUEUE_DISABLED`, `PLP_SEO_QUEUE_TIMEOUT_MS`, `PLP_SEO_QUEUE_ENQUEUE_LIMIT`, `PLP_SEO_QUEUE_STALE_MINUTES`, `PLP_SEO_ITEM_STUCK_MINUTES`, `PLP_SEO_WORKER_CONCURRENCY`, `PLP_SEO_WORKER_API_URL`, `PLP_SEO_WORKER_FETCH_TIMEOUT_MS`, `WORKER_FETCH_TIMEOUT_MS`.
- Taxonomy remap (auto-reseed): `TAXONOMY_REMAP_AUTO_RESEED_ENABLED`, `TAXONOMY_REMAP_AUTO_RESEED_THRESHOLD`, `TAXONOMY_REMAP_AUTO_RESEED_LIMIT`, `TAXONOMY_REMAP_AUTO_RESEED_COOLDOWN_MINUTES`, `TAXONOMY_REMAP_AUTO_RESEED_RUNNING_STALE_MINUTES`, `TAXONOMY_REMAP_AUTO_RESEED_FORCE_RECOVER_MINUTES`.
- Sweep tech profiler: `TECH_PROFILE_SWEEP_LIMIT`, `TECH_PROFILE_SWEEP_PLATFORM` (all|unknown|null|shopify|...).
- Dry-run LLM: `UNKNOWN_LLM_DRY_RUN_LIMIT`, `UNKNOWN_LLM_DRY_RUN_CANDIDATES`.

Nota: el refresh de catálogo puede detectar productos nuevos sin `metadata.enrichment` y crear un `product_enrichment_run` (mode `new_products`). Por defecto queda en `paused` para evitar consumo inesperado de cuota; se reanuda manualmente con el Admin o con `POST /api/admin/product-enrichment/run` (brandId). Si quieres que se procese automáticamente (sin intervención), setea `CATALOG_REFRESH_ENRICH_AUTO_START=true` en Vercel. Hardening adicional: si existe una corrida heredada `catalog_refresh` con `auto_start=false`, el sistema puede reanudarla cuando el flag está activo; si el flag está apagado, la normaliza a `paused` (`auto_start_disabled`) para impedir ejecución automática.
Tip operativo: `GET /api/admin/catalog-refresh/cron` acepta overrides opcionales `maxBrands`, `brandConcurrency` y `maxRuntimeMs` para pruebas controladas de throughput (por ejemplo: `/api/admin/catalog-refresh/cron?force=true&maxBrands=12&brandConcurrency=4&maxRuntimeMs=90000`). Si no envías esos query params, el endpoint usa los valores de entorno (`CATALOG_REFRESH_*`) sin aplicar overrides.
Operación (BullMQ 24/7):
- `services/worker` publica heartbeats en Redis: `workers:catalog:alive` y `workers:enrich:alive` (TTL 60s, refresh cada 20s).
- `services/worker` incluye autopilot de recuperación: consulta `GET /api/admin/queue-health` y, si detecta `queueEmptyButDbRunnable` o `staleNoProgress`, dispara `POST /api/admin/catalog-extractor/drain` / `POST /api/admin/product-enrichment/drain` automáticamente.
- Los drains de Vercel se comportan como fallback: si el heartbeat existe y hay progreso del worker, responden `{ skipped: "worker_online" }` para evitar doble procesamiento. Si hay backlog (`waiting+delayed > 0`) pero `active=0` y sin progreso reciente, el drain entra automáticamente (sin `force`) para recuperar.
- Si Redis reporta cola vacía (`waiting=0`, `delayed=0`, `active=0`) pero DB aún tiene items runnable en corridas `processing`, el drain también entra automáticamente (`worker_queue_empty_db_runnable`) para reactivar avance.
- Umbral de recuperación automática por falta de progreso: `WORKER_NO_PROGRESS_SECONDS` (default `300`).
- Variables del autopilot: `WORKER_AUTONOMOUS_DISABLED`, `WORKER_AUTONOMOUS_INTERVAL_MS`, `WORKER_AUTONOMOUS_PROBE_TIMEOUT_MS`, `WORKER_AUTONOMOUS_DRAIN_TIMEOUT_MS`, `WORKER_AUTONOMOUS_CATALOG_LIMIT`, `WORKER_AUTONOMOUS_ENRICH_LIMIT`, `WORKER_QUEUE_HEALTH_URL`, `CATALOG_WORKER_DRAIN_URL`, `PRODUCT_ENRICHMENT_WORKER_DRAIN_URL`.
- Timeout HTTP del worker hacia `process-item`: `WORKER_FETCH_TIMEOUT_MS` (0 = sin abort del cliente worker, recomendado) y overrides por cola (`CATALOG_WORKER_FETCH_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_WORKER_FETCH_TIMEOUT_MS`, `PLP_SEO_WORKER_FETCH_TIMEOUT_MS`).
- Override manual: `POST /api/admin/catalog-extractor/drain?force=true` o `POST /api/admin/product-enrichment/drain?force=true`.
- Health: `GET /api/admin/queue-health` (jobCounts BullMQ + workerAlive).
- Ejemplo de `systemd`: `services/worker/systemd/oda-worker.service.example` + `services/worker/systemd/worker.env.example`.
No commitees credenciales reales.

## Comandos locales
```bash
# web
cd apps/web
npm install        # ya ejecutado en bootstrap
npm run dev        # http://localhost:3000
npm run lint
	npm run build
npm run db:import:brands   # importa Marcas colombianas.xlsx a Neon
npm run db:seed:users      # crea/actualiza usuario admin en Neon
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/smoke-catalog-adapters.ts  # smoke test por tecnología
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/smoke-product-enrichment.ts  # smoke test de enriquecimiento (según provider activo)
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/unknown-llm-dry-run.ts     # dry-run LLM PDP (unknown)
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/tech-profiler-sweep.ts     # perfila y elimina marcas no procesables
node scripts/build-style-assignments.mjs  # seed style_profiles + backfill estilos principal/secundario
node scripts/apply-catalog-filter-indexes.mjs  # aplica índices de performance del PLP `/catalogo` en Neon (CREATE INDEX CONCURRENTLY)
node scripts/backfill-product-price-rollups.mjs  # recalcula hasInStock/minPriceCop/maxPriceCop en `products`
node scripts/backfill-product-price-change-signals.mjs  # recalcula `priceChangeDirection/priceChangeAt` desde `price_history`
node scripts/seed-color-palette-200.mjs  # carga paleta 200 en color_combinations_colors (desde Excel)
node scripts/build-color-relations.mjs  # recalcula matches variante↔combinacion con colores estandarizados
	node scripts/diagnose-catalog-refresh.cjs > ../../reports/catalog_refresh_diagnostics/report.json  # métricas de refresh/fallas (Neon)
	node scripts/reschedule-catalog-refresh-nextdue.mjs --dry-run  # recalcula nextDueAt para scheduling con jitter (usa CATALOG_REFRESH_INTERVAL_DAYS/JITTER_HOURS)
	node scripts/recover-bullmq-queues.mjs --dry-run  # obliterate BullMQ + reset DB queued->pending + reseed coherente (requiere --yes)

	# worker (cola/enriquecimiento)
	cd ../../services/worker
	npm install
	npm run dev

# scraper
cd ../scraper
npm install
npm run dev
```
Servicios sin Docker: ejecutar `web`, `worker` y `scraper` como procesos Node locales. La base de datos es **Neon** y Redis es remoto.

## Base de datos y Prisma
- Esquema definido en `apps/web/prisma/schema.prisma`, cliente generado en `@prisma/client` (adapter `@prisma/adapter-pg`).
- Migración inicial (`20260115125012_init_schema`) crea tablas core y habilita `pgvector`.
- Tabla `style_profiles`: catálogo de estilos con tags; `products` guarda `stylePrimary/styleSecondary` + conteos.
- Tabla `taxonomy_snapshots`: snapshots versionados (draft/published) de la taxonomía editable usada por enrichment, filtros y curación humana.
- Comandos (contra Neon):
  ```bash
  cd apps/web
  DATABASE_URL=$DATABASE_URL npx prisma generate
  DATABASE_URL=$DATABASE_URL npx prisma migrate dev --name <nombre>
  ```

## Admin
- Ruta `/admin` con login embebido (correo/contraseña).
- Configura `ADMIN_EMAIL` y `ADMIN_PASSWORD` en envs. Al autenticarse se crea un token de sesión (cookie HttpOnly) guardado en Neon.
- `ADMIN_TOKEN` queda como bypass opcional para llamadas API (Bearer).
- Panel `/admin/brands` (directorio):
  - Cards 3×5 por página, modal con detalle completo, CRUD (crear/editar/eliminar).
  - El modal ahora muestra conteo de productos, precio promedio real (calculado desde variantes) y un preview de 10 productos con foto.
  - Logos y fotos del preview se sirven via `/api/image-proxy`, que cachea automaticamente en Vercel Blob/CDN.
  - La card de "Pendientes" ahora muestra desglose: en cola, sin job, fallidas, manual review y riesgo Cloudflare.
  - Al hacer click en un producto del preview, abre el detalle en `/admin/products?productId=<id>`.
  - Eliminar marca hace **hard delete** en cascada (marca + productos/variantes/historiales + runs/anuncios/eventos asociados).
  - Filtros nuevos: categorias (`brands.category`) en dropdown multi‑select con opcion "Todas" y orden por cantidad de productos (asc/desc).
  - Persistencia de navegación: la página y filtros se guardan en la URL (`page`, `filter`, `category`, `sort`, `order`) para mantener el punto exacto tras reload/acciones.
  - Acciones por marca: **Re‑enriquecer** (método 2 con 14 fuentes y 20k chars por fuente).
  - Check azul cuando una marca tiene revisión manual (guardado en `brands.manualReview`).
  - Al crear marca, el botón **Crear y enriquecer** dispara el onboarding completo:
    1) enriquecimiento de marca → 2) tech profiler → 3) extracción de catálogo → 4) enriquecimiento de productos.
    El modal muestra barra de progreso, estados por paso y bloqueos (si el catálogo o tech profiler quedan en `blocked`, el flujo se detiene y avisa).
    El estado vive en `brands.metadata.onboarding`.
- Los paneles de Scraping/Tech profiler/Catalog extractor se ocultaron del menú: el flujo vive en el modal de creación.
- Panel `/admin/catalog-refresh`:
  - Monitor semanal de frescura por marca (% actualizado).
  - Métricas globales: nuevos productos, cambios de precio, cambios de stock y cambios de estado.
  - Acciones de forzar refresh y reintentos por marca.
- Panel `/admin/products` (productos):
  - Directorio de productos scrapeados con cards (carrusel de imágenes si hay múltiples fotos), modal de detalle enriquecido (precio/stock, tallas y colores visibles con swatches, fit/material por variante) y filtros por marca.
- Panel `/admin/product-curation` (curación humana):
  - Experiencia similar a `/catalogo` pero en admin (mismos filtros/query params), sin paginación UI y con scroll infinito.
  - Universo de productos alineado con `/catalogo`: por defecto muestra solo productos enriquecidos y con inventario disponible (`enrichedOnly=true`, `inStock=true`).
  - Mobile: grilla 2-up (2 cards por fila) y cards compactas (menos detalle) para selección más rápida.
  - Filtro adicional: **SEO tags** (hasta 300 principales por frecuencia) dentro de la columna de filtros, para curación más rápida.
  - Curación programada: la modal ahora funciona como **composer de operaciones** y guarda cambios en una cola persistente compartida (no aplica dentro de la modal).
  - Cola lateral fija: lista de pendientes/aplicadas/fallidas, conflictos potenciales, acciones por item (aplicar, duplicar, eliminar) y acciones globales (aplicar pendientes / aplicar seleccionados).
  - Snapshot de alcance: cada operación congela los `productIds` al momento de crearla (máx 1200 por operación).
  - Acciones rápidas editoriales por card: `❤️ Favorito` y `👑 Top Pick` encolan operaciones de un producto (`source=quick_editorial`) sin aplicar instantáneamente.
  - Bulk edit/composer: soporta taxonomía, atributos, tags, notas y estado editorial (`editorialBadge` con `favorite|top_pick` o `clear`).
  - Integridad: al reemplazar `category` se limpia `subcategory` si deja de pertenecer; al reemplazar `subcategory` se valida contra la categoría.
  - Editorial: corazón/corona son excluyentes en DB y en motor de aplicación (nunca ambos ranks simultáneos).
  - No permite editar `description` ni campos SEO. Preserva `products.metadata.enrichment` y registra trazabilidad en `products.metadata.enrichment_human`.
- Panel `/admin/pricing` (precios/TRM):
  - Editar TRM USD→COP y reglas de auto-clasificación de marcas USD (umbral % + `COP <` sospechoso + incluir variantes ya en USD).
  - Botón para correr el auto-marcado bajo demanda (además del cron diario).
  - Tabla de marcas con override USD (promover a manual o limpiar override).
- Panel `/admin/taxonomy` (taxonomía):
  - Editor de categorías/subcategorías/materiales/patrones/ocasiones/style tags con workflow **draft → publish**.
  - Editor de perfiles de estilo (tabla `style_profiles`) + acción de backfill para recalcular `stylePrimary/styleSecondary`.
  - La taxonomía publicada alimenta: prompt/validación de enrichment, dropdowns de curación y labels de facets.
- Panel `/admin/taxonomy-remap-review` (revisión de remapeo):
  - Cola manual de propuestas para categoría/subcategoría/género con foto, razones y confianza.
  - El auto-reseed usa señales directas del producto enriquecido (nombre, descripción original y metadata/SEO) sin fase de aprendizaje histórico para priorizar estabilidad y tiempo de ejecución.
  - Cuando pendientes ≤ umbral (default 100), dispara auto-reseed de hasta 10.000 productos enriquecidos (nunca no-enriquecidos), sujeto a cooldown.
  - El panel muestra contador de faltantes de fase, faltantes para disparar auto-reseed y estado visual de ejecución en curso (running + última evaluación).
- El modal muestra estilo principal/secundario (derivado de `styleTags`) con labels humanos.
- Las imágenes de cards pasan por `/api/image-proxy` (cache a Blob) y se renderizan con `next/image`.
- `next.config.ts` incluye allowlist para dominios `*.public.blob.vercel-storage.com` usados por Vercel Blob.
- Las imágenes servidas por `/api/image-proxy` se muestran como `unoptimized` para evitar 400 en `_next/image` con URLs proxy.
- El cierre del modal limpia `productId` de la URL sin reabrirlo en bucle.
- Persistencia de navegación: la página y el filtro por marca viven en la URL (`page`, `brandId`) y el detalle se puede abrir por `productId`.

## Auth usuarios (public)
- Login en `/sign-in` con Descope (Google/Apple/Facebook).
- En `/sign-in` el flow de Descope usa `redirectUrl=<origin>/sign-in` para que los proveedores OAuth redirijan en la misma pestaña (evita popups bloqueados y “click que no hace nada” en algunos navegadores/in-app browsers).
- OAuth callback hardening: si Descope vuelve a `/sign-in` con `?code=` o `?err=`, la UI hace `sdk.oauth.exchange(code)` explícito, muestra feedback y permite reintentar limpiando la URL (evita estados pegados y dobles exchanges).
- Hardening de dominio no aprobado (`E108202`): `/sign-in` detecta errores del `CustomEvent` de Descope y muestra mensaje explícito cuando el host actual no está en `trustedDomains`.
- Perfil privado en `/perfil` (nombre, bio, favoritos + listas, borrado de cuenta). Botón "Guardar" en cards de `/catalogo` para agregar a favoritos.
- Tokens: persistimos el **session token** en storage del browser (evita límites de tamaño de cookie) y el **refresh token** en cookie (`refreshTokenViaCookie`) para que el SDK pueda auto‑refrescar la sesión.
- Backend: todas las rutas de usuario (`/api/user/*`) exigen `Authorization: Bearer <sessionToken>` y validan server‑side con Descope (`validateSession`). No dependen de la cookie `DS`.
- `/perfil` se protege en el cliente (si no hay sesión, redirige a `/sign-in?next=/perfil`).
- Eventos de experiencia UI viven en `experience_events` y se vinculan a `experience_subjects` usando cookie persistente `oda_anon_id`.

### Descope Approved Domains
- Cargar dominios en Descope sin protocolo (`https://`), separados por coma, en `project.json.trustedDomains` (Project Settings).
- Lista requerida para este repo:
  - `oda-moda.vercel.app`
  - `oda-storefront-6ee5-alejingutierrezs-projects.vercel.app`
  - `oda-storefront-6ee5-git-main-alejingutierrezs-projects.vercel.app`
  - `localhost`
  - `127.0.0.1`
- Regla operativa: QA de login en preview debe usar el alias estable `oda-storefront-6ee5-git-main-alejingutierrezs-projects.vercel.app` (no URLs efímeras de deployment hash).
- Antes de probar login en un host nuevo:
  1. Agregar el host en `trustedDomains` de Descope.
  2. Guardar cambios en Descope.
  3. Reintentar `/sign-in`; si falla con `E108202`, validar que el host exacto quedó incluido.

## Catalogo (public)
- Ruta `/catalogo` (y alias `/buscar`) con filtros, facets y scroll infinito.
- Sorts disponibles: `relevancia`, `new`, `price_asc`, `price_desc`, `top_picks`, `editorial_favorites`.
- Sort editorial:
  - `top_picks`: primero productos con `editorialTopPickRank` (asc), luego resto por `createdAt desc`.
  - `editorial_favorites`: primero productos con `editorialFavoriteRank` (asc), luego resto por `createdAt desc`.
  - No renderiza badges editoriales en cards públicas; solo afecta el orden.
- Rutas canónicas SEO de PLP: `/{femenino|masculino|unisex|infantil}/[categoria]/[subcategoria]` (redirect 308 permanente desde `/g/*`).
- El catálogo público fuerza `inStock=true` y `enrichedOnly=true` (no muestra productos sin `products.metadata.enrichment`).
- Facets contextuales: marcas/materiales/patrones vienen de `/api/catalog/facets-lite` según filtros efectivos de la PLP (marcas ordenadas por conteo desc). El contador “X marcas” es `count(distinct brandId)` del set filtrado.
- Hardening de estabilidad en pestañas inactivas:
  - Filtros (desktop/mobile): lock transitorio de interacción con timeout + liberación automática al volver (`focus`, `visibilitychange`, `pageshow`) para evitar estados “pegados” en `Aplicando/Actualizando`.
  - Infinite scroll: `loadMore` y prefetch con timeout/abort; reintento automático al recuperar foco/conectividad (`focus`, `online`, `pageshow`) y fallback por proximidad al sentinel.
  - Navegación defensiva: se evita `router.replace` cuando el query final no cambia (reduce transiciones no-op y estados pendientes innecesarios).
  - Prefetch defensivo de navegación: `next/link` del header/mega menu (desktop y mobile) usa `prefetch={false}` para evitar ráfagas de requests `_rsc` que compitan con la actualización de filtros (en especial precio).
- Filtro de precio:
  - Slider (rango continuo): `price_min` y `price_max`.
  - Rangos múltiples (unión disjunta real): `price_range=min:max` (parámetro repetible). Si existe al menos un `price_range`, tiene prioridad sobre `price_min/price_max` (la UI limpia `price_range` al interactuar con el slider).
  - Cambio de precio (30 días): filtro single-select `price_change=down|up` en sección Precio (`Bajó de precio` / `Subió de precio`), combinable con el resto de filtros.
  - Bounds/histograma: `/api/catalog/price-bounds` soporta `mode=lite|full`.
    - `mode=lite`: devuelve `{ bounds }` (rápido).
    - `mode=full` (default): devuelve `{ bounds, histogram, stats }` y usa un dominio robusto (percentiles p02/p98 cuando hay suficientes datos) para que outliers no dominen el rango.
    - La UI carga `lite` inmediatamente y `full` de forma lazy/idle para reducir lag percibido al combinar filtros.
  - Guardia anti-outliers: los cálculos de `min/max` y `price_asc/price_desc` ignoran variantes con `price > CATALOG_PRICE_MAX_VALID` para evitar rangos astronómicos por datos de origen defectuosos.
- Layout mobile:
  - Preferencia persistida en `localStorage` key `oda_catalog_mobile_layout_v1` (default = layout previo).
  - Formatos soportados en PLP: `3:4` y `1:1`.
- Imágenes en cards:
  - Si `products.imageCoverUrl` ya apunta a Vercel Blob (`*.public.blob.vercel-storage.com`), se sirve con `next/image` optimizado.
  - Si el cover aún no está en Blob, se sirve via `/api/image-proxy` (cachea en Blob/CDN). En este caso se renderiza como `unoptimized` para evitar el 400 `INVALID_IMAGE_OPTIMIZE_REQUEST` de Vercel cuando `next/image` intenta optimizar un `src` bajo `/api/*`.
- Backfill opcional de covers a Blob (recomendado cuando se detectan muchos covers remotos):
  ```bash
  IMAGE_BACKFILL_LIMIT=0 IMAGE_BACKFILL_CONCURRENCY=6 node apps/web/scripts/backfill-image-covers-to-blob.mjs
  ```
- Cards PLP:
  - Badge de cambio de precio junto al precio (`↓ Bajó de precio` / `↑ Subió de precio`) cuando `products.priceChangeDirection` existe y `priceChangeAt` está dentro de 30 días.
  - Sensibilidad de badge/filtro basada en **precio mínimo mostrado** (redondeo marketing `unit_cop`), para evitar ruido de cambios no visibles.
- Facets lite (`/api/catalog/facets-lite`):
  - Incluye `occasions` para renderizar la sección **Ocasión** en filtros desktop/mobile de PLP.

### Performance (filtros `/catalogo`)
- En Neon (prod/stg), los filtros del catálogo dependen de índices para evitar `seq scan` en queries de `products/variants` (subcategorías, bounds de precio, listados).
- El sort por precio (`price_asc`/`price_desc`) y `price-bounds` en modo lite usan rollups persistidos en `products` (`hasInStock`, `minPriceCop`, `maxPriceCop`, `priceRollupUpdatedAt`) para evitar agregaciones pesadas por request.
- El histograma de precio (`mode=full`) cuenta productos por bin (no variantes crudas): fast-path por rollups cuando no hay filtros `color/size/fit`, y deduplicación por `productId` dentro de cada bin cuando sí existen.
- SQL (re-aplicable): `apps/web/scripts/catalog-filter-indexes.sql`
- Script: `apps/web/scripts/apply-catalog-filter-indexes.sh` (usa `NEON_DATABASE_URL` desde `.env` y `CREATE INDEX CONCURRENTLY`).
- Backfill de rollups: `apps/web/scripts/backfill-product-price-rollups.mjs` (usar después de migrar/agregar columnas).
- Benchmark E2E (`warm/cold` por endpoint y por escenario):
  ```bash
  # Baseline (pre-cambio)
  BASE_URL=https://oda-moda.vercel.app node apps/web/scripts/benchmark-catalog-filters.mjs --limit 30 > reports/bench-catalog-pre.txt

  # Post-cambio
  BASE_URL=https://oda-moda.vercel.app node apps/web/scripts/benchmark-catalog-filters.mjs --limit 30 > reports/bench-catalog-post.txt

  # Opcional: sin price sorts para aislar costo de filtros
  BASE_URL=https://oda-moda.vercel.app node apps/web/scripts/benchmark-catalog-filters.mjs --limit 30 --no-price-sort > reports/bench-catalog-post-nopsort.txt
  ```
- Escenarios incluidos automáticamente por caso (`category + gender`):
  - `base` (sin filtro de precio explícito)
  - `price_min_max` (con `price_min/price_max`)
  - `price_range` (con `price_range` repetible)
- Lectura del reporte:
  - `Summary (endpoint + phase)` agrega latencias por endpoint separando `cold` y `warm`.
  - `Summary (endpoint + phase + scenario)` desglosa por escenario para comparar impacto directo de precio.
  - `SLO (p95)` valida objetivo por fase.
- SLO acordado para aplicar filtros de precio:
  - `warm`: p95 `< 1.2s`
  - `cold`: p95 `< 3s`

## Home (public)
- Ruta `/` con home editorial (estilo Farfetch) y grillas cuadradas.
- Mega menu por género con estructura completa basada en categorías reales y reglas `category + subcategory` (ver `HOME_PLAN.md`).
- Home inmersivo editorial (MC-134, 2026-02-20):
  - Estrategia `SSR + islas client`: `/src/app/page.tsx` mantiene fetch server-side (semilla determinista de 3 dias) y delega interactividad a componentes client en `src/components/home/*`.
  - Dependencias UI: `framer-motion` (reveal/parallax/transiciones) y `lucide-react` (controles de carrusel).
  - Módulos nuevos: `HomeHeroImmersive`, `ProductCarousel` (swipe/drag + keyboard), `CategoryGallery` (3:4), `CuratedStickyEdit`, `ColorSwatchPalette`, `BrandMarquee` y `RevealOnScroll`.
  - Tipos compartidos movidos a `src/lib/home-types.ts` para evitar acoplar componentes client al módulo `server-only` (`home-data.ts`).
  - Accesibilidad y motion: se respeta `prefers-reduced-motion` (desactiva marquee/parallax y reduce animación no esencial), foco visible y labels en controles de carrusel/marquee.
- Header + mega menu (actualización 2026-02-18):
  - Desktop: layout del header en grid (`auto | minmax(0,1fr) | auto`), input de búsqueda responsivo (`w-[clamp(12rem,18vw,20rem)]`) y panel de megamenu compartido a ancho completo del container.
  - Desktop (ajuste UX): menor densidad vertical en líneas del panel para una lectura más compacta.
  - Taxonomía/visibilidad: `ropa_deportiva_y_performance` deja de desglosarse por subcategorías en el menú, y cualquier subcategoría con `count=0` se oculta.
  - Interacción desktop: hover abre temporalmente, click fija/desfija (pin), cierre con `Esc` o click fuera.
  - Mobile: drawer jerárquico por niveles (`root/gender/section`) con barra sticky (atrás/título/cerrar), targets táctiles >=44px y cierre automático al navegar.
  - Telemetría de navegación: `menu_open`, `menu_pin_toggle`, `menu_item_click`, `menu_mobile_step` (endpoint `/api/experience/events`).
- Rotación automática cada 3 días para productos y marcas, sin intervención humana.
- Panel `/admin/color-combinations` (combinaciones de color):
  - Al hacer click en un color, lista productos asociados y filtra por rol del color con categorías permitidas:
    - Siempre descarta categorías fuera del set permitido global (si el rol viene inesperado).
    - Dominante: `blazers_y_sastreria`, `buzos_hoodies_y_sueteres`, `camisas_y_blusas`, `chaquetas_y_abrigos`, `enterizos_y_overoles`, `faldas`, `jeans_y_denim`, `pantalones_no_denim`, `vestidos`.
    - Secundario: `shorts_y_bermudas`, `pantalones_no_denim`, `jeans_y_denim`, `camisetas_y_tops`, `blazers_y_sastreria`.
    - Acento: `accesorios_textiles_y_medias`, `bolsos_y_marroquineria`, `calzado`, `gafas_y_optica`, `joyeria_y_bisuteria`.
  - Las combinaciones guardan colores en `color_combinations.colorsJson` (hex + role).
  - La paleta 200 vive en `color_combination_colors` (hex/pantone + Lab) y se carga con `node scripts/seed-color-palette-200.mjs`.
  - El matching usa colores estandarizados (`standard_colors` ≈60): `build-color-relations` mapea hex → standard y escribe `variant_color_vectors` con el hex/Lab estándar.
- Panel `/admin/product-enrichment` (enriquecimiento):
  - Enriquecimiento de atributos por OpenAI para categoría, subcategoría, tags, género, temporada, color hex, Pantone, fit, descripción (texto plano) y campos SEO (meta title/description + seoTags). Taxonomía incluye ropa + accesorios (joyería, calzado, bolsos, gafas).
  - Proveedor de enrichment configurable por env (`PRODUCT_ENRICHMENT_PROVIDER=openai|bedrock`). Default operativo recomendado: Bedrock Haiku 4.5 (`BEDROCK_INFERENCE_PROFILE_ID=arn:aws:bedrock:us-east-1:741448945431:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`).
  - Prompt `v12.5`: una sola llamada principal por producto, con harvesting de señales pre-LLM (nombre, descripción original, metadata vendor, og tags), routing determinístico a prompts por grupo de categoría y estrategia de imágenes por grupo.
  - Clasificador manual por reglas reforzado: diccionarios ampliados de categoría/subcategoría (cobertura de todas las subcategorías publicadas), sinónimos español/inglés y scoring por coincidencias para reducir falsos positivos por orden de reglas.
  - URLs de imagen se normalizan antes de llamar a OpenAI (`//cdn...` → `https://...`, relativas a absolutas por `sourceUrl`) y se descartan URLs inválidas para evitar errores `Invalid image_url`.
  - La descripción original se preserva en `products.metadata.enrichment.original_description` y se reutiliza en reintentos/reprocesos.
  - Materiales incluyen metales (oro/plata/bronce/cobre) **solo para joyería o accesorios**.
  - Style tags: **exactamente 10** por producto.
  - Colores: admite hasta 3 hex/pantone por variante; el color principal se guarda en `variants.color`/`variants.colorPantone` y el resto en `variants.metadata.enrichment.colors`.
  - Post-procesamiento determinístico: validador de consistencia + auto-fixes seguros; si persiste inconsistencia, se marca `review_required` con razones para curación humana.
  - Se guarda `confidence` local (`category/subcategory/overall`) y el panel expone conteos de baja confianza y revisión manual.
  - El panel incluye tabla operativa de revisión manual (manual + baja confianza), con razones y acceso directo al detalle de producto en admin.
  - Clasificación/remapeo de taxonomía con revisión humana: existe un panel dedicado `/admin/taxonomy-remap-review` para aprobar/rechazar propuestas de cambio de categoría/subcategoría/género con foto del producto, razones y nivel de confianza.
  - Regla operativa del remapeo: propuestas **SEO-only** (basadas solo en `seoTags`) no se auto-aplican; se encolan para aprobación manual.
  - Modos: batch (10/25/50/100/250/500/1000), todos por marca o global.
  - UX de ejecución: `Ejecutar batch` y `Ejecutar todos` siempre crean un run nuevo (fresh). La reanudación es explícita con botón `Reanudar corrida actual`.
  - Compatibilidad API: si `resume=false` y no se envía `startFresh`, el endpoint asume `startFresh=true` para evitar reutilizar runs activos por accidente.
  - Reanudación explícita de runs `catalog_refresh`: al reanudar manualmente (`resume=true`), el run se marca `auto_start=true` en metadata para habilitar drenado deliberado.
  - Por defecto omite productos ya enriquecidos por IA; el re-enrichment IA queda deshabilitado salvo override explícito (`PRODUCT_ENRICHMENT_ALLOW_REENRICH=true` + `forceReenrich`).
  - Controles de **pausa** y **detener**, y botón para **limpiar batches activos**; muestra progreso, errores, estado y cobertura (enriquecidos vs pendientes) con conteo de cola/en‑progreso. Auto‑refresco cada 5s cuando hay run activo.
  - Al finalizar, el progreso se calcula con conteos reales de items para evitar pendientes fantasma si cambió el catálogo.
  - En el panel, el run no se drena en la misma petición (respuesta rápida); el progreso se ve por polling y por el cron `/api/admin/product-enrichment/drain`.
  - Fallback serverless `/api/admin/product-enrichment/drain` con cron (cada 1 min) para evitar colas “pegadas”.
  - El drenado aplica concurrencia mínima 20 (clamp) vía `PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY`.
  - El worker BullMQ aplica concurrencia mínima 20 vía `PRODUCT_ENRICHMENT_WORKER_CONCURRENCY`.
  - El batch de drenado y el enqueue limit se elevan automáticamente al nivel de concurrencia para evitar cuellos por configuración baja.
  - Persistencia de estado: `scope`, `brandId` y `batch` viven en la URL para mantener el contexto tras recarga.
- Panel `/admin/plp-seo` (SEO PLP):
  - Genera meta title/description + subtítulo visible por PLP (`/{genderSlug}/[categoria]/[subcategoria]`) usando Bedrock (tool schema) y persiste en `plp_seo_pages`.
  - Operación por batches de 20 (items), usando muestra de 100 productos random por PLP + top brands/materials/patterns (facets-lite).
  - Cola BullMQ `plp-seo` con worker (`services/worker`) que llama `POST /api/admin/plp-seo/process-item`.

## API interna (MC-004)
- Endpoint: `POST /api/normalize` (runtime Node).
- Autorización: header `Authorization: Bearer <ADMIN_TOKEN>` (fallback a `NEXTAUTH_SECRET` si no se define). Middleware protege `/api/normalize`.
- Payload: `{ productHtml: string, images: string[], sourceUrl?: string }`.
- Respuesta: objeto `{ product, cost }` normalizado por GPT-5.1 (JSON mode).

## API interna (scraper de marcas)
- `GET /api/admin/brands/scrape`: estado de cola (requiere sesión admin o `ADMIN_TOKEN`).
- `POST /api/admin/brands/scrape`: encola N marcas (`count` = 1,5,10,25,50).
- `POST /api/admin/brands/scrape/next`: procesa el siguiente job (uno por request).
- `GET /api/admin/brands/scrape/cron`: procesa un batch corto para cron (usa `BRAND_SCRAPE_MAX_JOBS` y `BRAND_SCRAPE_MAX_RUNTIME_MS`).
- El enriquecimiento usa `web_search` + fetch HTML (sin Playwright) para extraer señales del sitio oficial y evidencia **textual limpia** de **mínimo 15 fuentes** (hasta 20k caracteres por fuente, guardado en `brands.metadata.brand_scrape`).

## API interna (brands CRUD)
- `GET /api/admin/brands`: listado paginado con filtros (`filter=processed|unprocessed|all`), categorias multi‑select (`category=...` repetible) y orden por productos (`sort=productCount&order=asc|desc`).
- `POST /api/admin/brands`: crear marca (slug autogenerado si no se envía). Soporta `skipTechProfile=true` para crear sin bloquear por tech profiler.
- `GET /api/admin/brands/:id`: detalle completo de marca + último job + `productStats` (conteo y avg real) + `previewProducts` (10 productos).
- `PATCH /api/admin/brands/:id`: editar campos de marca.
- `DELETE /api/admin/brands/:id`: elimina la marca en cascada (hard delete).
- `POST /api/admin/brands/:id/re-enrich`: re‑enriquecimiento individual con método 2 (14 fuentes, 20k chars).
- `POST /api/admin/brands/:id/onboard/start`: inicia onboarding completo (body opcional `{ force: true }`).
- `GET /api/admin/brands/:id/onboard/state`: consulta estado y avanza pasos cuando aplica.

## API interna (tech profiler)
- `GET /api/admin/brands/tech`: estado de marcas con sitio (total/procesadas/pendientes).
- `POST /api/admin/brands/tech/next`: procesa la siguiente marca pendiente y actualiza su tecnología.

## API interna (catalog extractor)
- `GET /api/admin/catalog-extractor/brands`: lista marcas con `ecommercePlatform` (`onlyNoRun=true` devuelve solo marcas sin runs; `platform=all` trae todas las tecnologías; `limit` hasta 2000).
- `POST /api/admin/catalog-extractor/run`: ejecuta extracción de catálogo para una marca (body: `{ brandId, limit }`).
- `POST /api/admin/catalog-extractor/finish`: marca marca como terminada y la saca de la cola (body: `{ brandId, reason? }`).
- `POST /api/admin/catalog-extractor/process-item`: procesa un item de catálogo desde worker (body: `{ itemId }`).

## API interna (productos)
- `GET /api/admin/products`: listado paginado de productos (query: `page`, `pageSize`, `brandId`).
- `GET /api/admin/products/brands`: listado de marcas con conteo de productos.
- `GET /api/admin/products/:id`: detalle de producto con variantes.

## API interna (pricing / TRM)
- `GET /api/admin/pricing/config`: retorna config resuelta (defaults + KV `standard_color_config:pricing_config`).
- `PATCH /api/admin/pricing/config`: actualiza TRM USD→COP y reglas de auto-marcado; invalida cache de catálogo.
- `GET /api/admin/pricing/auto-usd-brands`: dry-run de candidatas (pct > umbral).
- `POST /api/admin/pricing/auto-usd-brands`: aplica overrides USD (solo marca, no desmarca; no pisa manual) e invalida cache.
- `GET /api/admin/pricing/auto-usd-brands/cron`: misma lógica para cron (autoriza `x-vercel-cron` o `Authorization: Bearer ADMIN_TOKEN`).
- `GET /api/admin/pricing/brands`: lista marcas con override USD.
- `PATCH /api/admin/pricing/brands/:id/override`: set/clear override manual (body `{ currency_override: "USD" | null }`).

## API interna (curación de productos)
- `GET /api/admin/product-curation/products`: listado paginado (interno) para scroll infinito (query: filtros del catálogo + `page`, `pageSize`, `sort`).
- `GET /api/admin/product-curation/facets`: facets + subcategorías sin cache (se recalculan tras bulk edits).
- `GET /api/admin/product-curation/ids`: devuelve IDs de productos que cumplen los filtros (hasta `limit`, default 1200) para "Seleccionar todos".
- Endpoints de curación (`products`, `facets`, `ids`) fuerzan el mismo gating de catálogo público: `enrichedOnly=true` e `inStock=true`.
- `POST /api/admin/product-curation/selection-summary`: resumen de la selección actual (categorías) para guiar la modal y hacer preflight (body: `{ productIds[] }`, límite 1200).
- `POST /api/admin/product-curation/bulk`: bulk edit de características de productos. Body: `{ productIds, changes: [{ field, op, value }] }` (legacy: `{ field, op, value }`) (límite default: 1200 IDs).
  - No modifica `description` ni campos SEO.
  - Preserva `products.metadata.enrichment` y registra auditoría en `products.metadata.enrichment_human`.

## API interna (taxonomía + estilos)
- `GET /api/admin/taxonomy?stage=published|draft`: obtiene taxonomía publicada o borrador (si no existe draft, se crea).
- `PUT /api/admin/taxonomy`: guarda el borrador (body: `{ stage: \"draft\", data }`).
- `POST /api/admin/taxonomy/publish`: publica el draft (crea nueva versión published).
- `GET /api/admin/taxonomy/options`: snapshot publicado + mapas de labels (para UIs admin).
- `GET /api/admin/style-profiles`: lista perfiles de estilo (DB).
- `POST /api/admin/style-profiles`: crea perfil (body: `{ key, label, tags }`).
- `PATCH /api/admin/style-profiles/:key`: actualiza label/tags de un perfil.
- `POST /api/admin/style-profiles/recompute`: recalcula `stylePrimary/styleSecondary` en productos existentes.

## API interna (image proxy)
- `GET /api/image-proxy?url=<encoded>`: descarga la imagen remota, la cachea en Vercel Blob y redirige al asset cacheado.
- Query params opcionales: `productId` y `kind=cover|gallery` (si es `cover`, intenta persistir el cover en DB).
- URLs con formato Cloudflare `cdn-cgi/image/.../https://...` se normalizan al asset original para evitar errores de DNS.

## API interna (product enrichment)
- `GET /api/admin/product-enrichment/state`: estado de corrida (query: `scope=brand|all`, `brandId?`).
- `GET /api/admin/product-enrichment/review-items`: lista de productos para revisión manual y/o baja confianza (query: `scope`, `brandId?`, `limit?`, `onlyReviewRequired?`, `includeLowConfidence?`).
- `POST /api/admin/product-enrichment/run`: inicia corrida (body: `{ scope, brandId?, mode: \"batch\"|\"all\", limit?, resume?, includeEnriched?, forceReenrich? }`).
- `POST /api/admin/product-enrichment/pause`: pausa corrida (body: `{ runId }`).
- `POST /api/admin/product-enrichment/stop`: detiene corrida (body: `{ runId }`).
- `POST /api/admin/product-enrichment/process-item`: procesa item (body: `{ itemId }`).

## API interna (taxonomy remap review)
- `GET /api/admin/taxonomy-remap/reviews`: lista propuestas de remapeo (filtros: `status`, `brandId`, `search`, `page`, `limit`) y devuelve summary de conteos.
- `POST /api/admin/taxonomy-remap/reviews`: encola propuestas para revisión manual (estado `pending`) sin aplicar cambios al producto.
- `POST /api/admin/taxonomy-remap/reviews/:reviewId/accept`: aplica propuesta (`category`, `subcategory`, `gender`) al producto y marca la revisión como `accepted`.
- `POST /api/admin/taxonomy-remap/reviews/:reviewId/reject`: rechaza propuesta y la marca como `rejected` (nota opcional).
- `GET /api/admin/taxonomy-remap/auto-reseed`: estado del auto-reseed (umbral, pendientes, faltantes, último run y ejecución activa si existe).
- `POST /api/admin/taxonomy-remap/auto-reseed`: dispara auto-reseed manual (opcional `force`, `limit`).
- `GET /api/admin/taxonomy-remap/auto-reseed/cron`: ejecución automática (cron) del auto-reseed.

## Cron en Vercel
- Configurado en `vercel.json`.
- `/api/admin/brands/scrape/cron` cada 5 minutos.
- `/api/admin/catalog-extractor/drain` cada 1 minuto.
- `/api/admin/product-enrichment/drain` cada 1 minuto.
- `/api/admin/catalog-refresh/cron` cada 1 hora (`0 * * * *`).
- El endpoint acepta invocaciones de cron (User-Agent `vercel-cron`) o `ADMIN_TOKEN` en `Authorization`.

## CI/CD y Git
- Repositorio: git@github.com:alejingutierrez/oda_storefront.git
- Pendiente: configurar GitHub Actions y Vercel pipeline.

## Operativa de historias (resumen)
Al abordar una historia: (0) pedir credenciales/definiciones faltantes, (1) levantar servicios locales necesarios (web/scraper/worker) y revisar logs, (2) push a la rama, (3) esperar build Vercel y verificar, (4) actualizar README, (5) marcar done en `USER_STORIES.md`, `BACKLOG.md`, `STATUS.md`.

## Próximos pasos sugeridos
- MC-009–017 (F1): taxonomía, búsqueda+pgvector, observabilidad scraping v1, admin mínimo, anuncios básicos, 10–20 marcas, emails/plantillas, ISR/cache y gestión de secrets.
- Integrar VSF UI components y conectores de catálogo.
