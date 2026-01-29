# ODA Storefront

Plataforma headless para indexar ~500 marcas de moda colombiana, normalizar catálogos vía OpenAI GPT-5.1 (JSON mode), enriquecer productos vía Bedrock y servir búsqueda/recomendaciones en Next.js + Vue Storefront, con backend BFF, scrapers y workers dockerizados. Despliegue objetivo: Vercel (web/BFF) + contenedores para scrapers/workers.

## Estructura
- `apps/web` – Front + BFF en Next.js (App Router, TS, Tailwind).
- `services/scraper` – Scraper stub (Node) listo para integrar descubrimiento de sitemap y parsers por marca.
- `services/worker` – Worker stub (BullMQ) para orquestar ingestión y pipeline IA.
- `docker-compose.yml` – Web, scraper, worker, Postgres (pgvector), Redis.
- `AGENTS.md`, `BACKLOG.md`, `USER_STORIES.md`, `STATUS.md` – Documentación y control operativo.

## Requisitos
- Node 22.x, npm.
- Docker + Docker Compose (para entorno local).

## Variables de entorno
Copiar `.env.example` a `.env`/`.env.local` y completar:
- Core: `OPENAI_API_KEY`, `OPENAI_MODEL` (opcional, default `gpt-5.1`), `OPENAI_WEB_SEARCH` (opcional), `NEXTAUTH_SECRET`, `VERCEL_TEAM_ID`, `VERCEL_TOKEN`.
- Base de datos (Neon): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_DATABASE_URL`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`.
- Redis: `REDIS_URL`.
- Storage: `VERCEL_BLOB_READ_WRITE_TOKEN`, `BLOB_READ_WRITE_TOKEN`.
- Billing: `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`.
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
- Scraper: `USER_AGENT`, `BRAND_SCRAPE_MAX_JOBS`, `BRAND_SCRAPE_MAX_RUNTIME_MS`.
- Scraper: `BRAND_SCRAPE_STALE_MINUTES` (re-encola jobs en `processing` con más de N minutos).
- Catalog extractor: `CATALOG_TRY_SITEMAP_FIRST` (true|false), `CATALOG_FORCE_SITEMAP` (true|false), `CATALOG_EXTRACT_SITEMAP_BUDGET_MS`, `CATALOG_EXTRACT_SITEMAP_LIMIT` (0 = sin límite), `CATALOG_EXTRACT_SITEMAP_MAX_FILES`, `CATALOG_EXTRACT_SITEMAP_SCAN_MAX_URLS` (0 = sin límite por sitemap), `CATALOG_EXTRACT_DISCOVERY_LIMIT`, `CATALOG_EXTRACT_MAX_RUNTIME_MS`, `CATALOG_EXTRACT_CONSECUTIVE_ERROR_LIMIT`, `CATALOG_AUTO_PAUSE_ON_ERRORS`, `CATALOG_QUEUE_ENQUEUE_LIMIT`, `CATALOG_QUEUE_NAME`, `CATALOG_QUEUE_STALE_MINUTES`, `CATALOG_ITEM_STUCK_MINUTES`, `CATALOG_RESUME_STUCK_MINUTES`, `CATALOG_QUEUE_TIMEOUT_MS`, `CATALOG_QUEUE_DISABLED`, `CATALOG_QUEUE_ATTEMPTS`, `CATALOG_QUEUE_BACKOFF_MS`, `CATALOG_DRAIN_BATCH`, `CATALOG_DRAIN_MAX_RUNTIME_MS`, `CATALOG_DRAIN_CONCURRENCY`, `CATALOG_DRAIN_ON_RUN`, `CATALOG_DRAIN_ON_RUN_BATCH`, `CATALOG_DRAIN_ON_RUN_MAX_RUNTIME_MS`, `CATALOG_DRAIN_ON_RUN_CONCURRENCY`, `CATALOG_DRAIN_DISABLED`, `CATALOG_WORKER_CONCURRENCY`, `CATALOG_WORKER_API_URL`, `CATALOG_LLM_NORMALIZE_MODE` (auto|always|never), `CATALOG_LLM_NORMALIZE_MAX_DESC_CHARS`, `CATALOG_LLM_NORMALIZE_MAX_IMAGES`, `CATALOG_LLM_NORMALIZE_MAX_VARIANTS`, `CATALOG_LLM_NORMALIZE_MAX_OPTION_VALUES`.
- Catalog extractor (PDP LLM): `CATALOG_OPENAI_MODEL`, `CATALOG_OPENAI_TEMPERATURE`, `CATALOG_OPENAI_DISABLE_TEMPERATURE`, `CATALOG_PDP_LLM_ENABLED`, `CATALOG_PDP_LLM_CONFIDENCE_MIN`, `CATALOG_PDP_LLM_MAX_HTML_CHARS`, `CATALOG_PDP_LLM_MAX_TEXT_CHARS`, `CATALOG_PDP_LLM_MAX_IMAGES`.
- Product enrichment (Claude via Bedrock / OpenAI): `PRODUCT_ENRICHMENT_PROVIDER` (bedrock|openai), `BEDROCK_INFERENCE_PROFILE_ID`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (opcional), `PRODUCT_ENRICHMENT_MODEL` (solo si provider=openai), `PRODUCT_ENRICHMENT_TEMPERATURE`, `PRODUCT_ENRICHMENT_MAX_TOKENS`, `PRODUCT_ENRICHMENT_MAX_RETRIES`, `PRODUCT_ENRICHMENT_MAX_ATTEMPTS`, `PRODUCT_ENRICHMENT_MAX_IMAGES`, `PRODUCT_ENRICHMENT_BEDROCK_MAX_IMAGES`, `PRODUCT_ENRICHMENT_BEDROCK_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_BEDROCK_INCLUDE_IMAGES`, `PRODUCT_ENRICHMENT_BEDROCK_IMAGE_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_BEDROCK_IMAGE_MAX_BYTES`, `PRODUCT_ENRICHMENT_VARIANT_CHUNK_SIZE`, `PRODUCT_ENRICHMENT_REPAIR_MAX_CHARS`, `PRODUCT_ENRICHMENT_QUEUE_NAME`, `PRODUCT_ENRICHMENT_QUEUE_TIMEOUT_MS`, `PRODUCT_ENRICHMENT_QUEUE_DISABLED`, `PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT`, `PRODUCT_ENRICHMENT_QUEUE_STALE_MINUTES`, `PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES`, `PRODUCT_ENRICHMENT_RESUME_STUCK_MINUTES`, `PRODUCT_ENRICHMENT_AUTO_PAUSE_ON_ERRORS`, `PRODUCT_ENRICHMENT_CONSECUTIVE_ERROR_LIMIT`, `PRODUCT_ENRICHMENT_DRAIN_ON_RUN`, `PRODUCT_ENRICHMENT_DRAIN_BATCH`, `PRODUCT_ENRICHMENT_DRAIN_MAX_RUNTIME_MS`, `PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY`, `PRODUCT_ENRICHMENT_WORKER_CONCURRENCY`, `PRODUCT_ENRICHMENT_WORKER_API_URL`.
- Sweep tech profiler: `TECH_PROFILE_SWEEP_LIMIT`, `TECH_PROFILE_SWEEP_PLATFORM` (all|unknown|null|shopify|...).
- Dry-run LLM: `UNKNOWN_LLM_DRY_RUN_LIMIT`, `UNKNOWN_LLM_DRY_RUN_CANDIDATES`.
No commitees credenciales reales.

## Comandos locales
```bash
cd apps/web
npm install        # ya ejecutado en bootstrap
npm run dev        # http://localhost:3000
npm run lint
npm run build
npm run db:import:brands   # importa Marcas colombianas.xlsx a Neon
npm run db:seed:users      # crea/actualiza usuario admin en Neon
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/smoke-catalog-adapters.ts  # smoke test por tecnología
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/smoke-product-enrichment.ts  # smoke test de enriquecimiento (Bedrock)
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/unknown-llm-dry-run.ts     # dry-run LLM PDP (unknown)
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/tech-profiler-sweep.ts     # perfila y elimina marcas no procesables
node scripts/build-style-assignments.mjs  # seed style_profiles + backfill estilos principal/secundario
```

### Docker Compose (stack completo)
```bash
docker-compose build
docker-compose up
```
Servicios: `web` (host 3080 → contenedor 3000), `redis` (6379), `scraper`, `worker`.  
La base de datos es **Neon** (no se levanta Postgres local en Compose).

## Base de datos y Prisma
- Esquema definido en `apps/web/prisma/schema.prisma`, cliente generado en `@prisma/client` (adapter `@prisma/adapter-pg`).
- Migración inicial (`20260115125012_init_schema`) crea tablas core y habilita `pgvector`.
- Tabla `style_profiles`: catálogo de estilos con tags; `products` guarda `stylePrimary/styleSecondary` + conteos.
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
- Panel `/admin/brands/scrape` (scraping):
  - Encolado y ejecución de scraping/enriquecimiento de marcas (1/5/10/25/50).
  - Auto‑resume tras recarga y recuperación de jobs atascados.
  - El batch continua aunque haya fallos; se detiene tras 3 errores consecutivos (configurable con `BRAND_SCRAPE_MAX_FAILURES`).
- Panel `/admin/brands/tech` (tech profiler):
  - Ejecuta perfilado de tecnología ecommerce (Shopify/Woo/Magento/VTEX/Tiendanube/Wix/custom).
  - Actualiza `brands.ecommercePlatform` y guarda detalle en `brands.metadata.tech_profile`.
  - Si detecta `social`, `bot_protection`, `unreachable`, `parked_domain`, `landing_no_store`, `no_pdp_candidates` o review `manual_review_no_products`, elimina la marca automáticamente.
- Panel `/admin/products` (productos):
  - Directorio de productos scrapeados con cards (carrusel de imágenes si hay múltiples fotos), modal de detalle enriquecido (precio/stock, tallas y colores visibles con swatches, fit/material por variante) y filtros por marca.
  - El modal muestra estilo principal/secundario (derivado de `styleTags`) con labels humanos.
  - Las imágenes de cards pasan por `/api/image-proxy` (cache a Blob) y se renderizan con `next/image`.
  - `next.config.ts` incluye allowlist para dominios `*.public.blob.vercel-storage.com` usados por Vercel Blob.
  - Las imágenes servidas por `/api/image-proxy` se muestran como `unoptimized` para evitar 400 en `_next/image` con URLs proxy.
  - El cierre del modal limpia `productId` de la URL sin reabrirlo en bucle.
  - Persistencia de navegación: la página y el filtro por marca viven en la URL (`page`, `brandId`) y el detalle se puede abrir por `productId`.
- Panel `/admin/color-combinations` (combinaciones de color):
  - Al hacer click en un color, lista productos asociados y filtra por rol del color con categorías permitidas:
    - Siempre descarta categorías fuera del set permitido global (si el rol viene inesperado).
    - Dominante: `blazers_y_sastreria`, `buzos_hoodies_y_sueteres`, `camisas_y_blusas`, `chaquetas_y_abrigos`, `enterizos_y_overoles`, `faldas`, `jeans_y_denim`, `pantalones_no_denim`, `vestidos`.
    - Secundario: `shorts_y_bermudas`, `pantalones_no_denim`, `jeans_y_denim`, `camisetas_y_tops`, `blazers_y_sastreria`.
    - Acento: `accesorios_textiles_y_medias`, `bolsos_y_marroquineria`, `calzado`, `gafas_y_optica`, `joyeria_y_bisuteria`.
- Panel `/admin/product-enrichment` (enriquecimiento):
  - Enriquecimiento de atributos por Claude Sonnet 4.5 (Bedrock) para categoría, subcategoría, tags, género, temporada, color hex, Pantone, fit, descripción (texto plano) y campos SEO (meta title/description + seoTags). Taxonomía incluye ropa + accesorios (joyería, calzado, bolsos, gafas).
  - Se puede forzar OpenAI con `PRODUCT_ENRICHMENT_PROVIDER=openai` (usa `PRODUCT_ENRICHMENT_MODEL`).
  - Materiales incluyen metales (oro/plata/bronce/cobre) **solo para joyería o accesorios**.
  - Style tags: **exactamente 10** por producto.
  - Colores: admite hasta 3 hex/pantone por variante; el color principal se guarda en `variants.color`/`variants.colorPantone` y el resto en `variants.metadata.enrichment.colors`.
  - Modos: batch (10/25/50/100/250/500/1000), todos por marca o global.
  - Por defecto omite productos ya enriquecidos (se puede incluirlos manualmente).
  - Controles de **pausa** y **detener**, y botón para **limpiar batches activos**; muestra progreso, errores, estado y cobertura (enriquecidos vs pendientes) con conteo de cola/en‑progreso. Auto‑refresco cada 5s cuando hay run activo.
  - Al finalizar, el progreso se calcula con conteos reales de items para evitar pendientes fantasma si cambió el catálogo.
  - En el panel, el run no se drena en la misma petición (respuesta rápida); el progreso se ve por polling y por el cron `/api/admin/product-enrichment/drain`.
  - Fallback serverless `/api/admin/product-enrichment/drain` con cron (cada 1 min) para evitar colas “pegadas”.
  - El drenado aplica concurrencia mínima 20 (clamp) vía `PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY`.
  - El worker BullMQ aplica concurrencia mínima 20 vía `PRODUCT_ENRICHMENT_WORKER_CONCURRENCY`.
  - El batch de drenado y el enqueue limit se elevan automáticamente al nivel de concurrencia para evitar cuellos por configuración baja.
  - Persistencia de estado: `scope`, `brandId`, `batch` e `includeEnriched` viven en la URL para mantener el contexto tras recarga.
- Panel `/admin/catalog-extractor` (catalog extractor):
  - Ejecuta extracción por **tecnología** con auto‑selección de marca.
  - Controles Play/Pausar/Detener (detener conserva estado para reanudar), reanudación automática y sitemap‑first.
  - Mientras está en `processing`, el panel drena lotes pequeños para progreso casi en tiempo real (poll ~2s).
  - Toggle para ver **todas** las marcas sin run, agrupadas por tecnología.
  - Permite **finalizar** una marca para sacarla de la cola y registrar `metadata.catalog_extract_finished`.
  - Usa cola Redis/BullMQ para procesar URLs en paralelo (workers externos).
  - Para `unknown`, intenta inferencia rápida de plataforma (sin LLM) desde la home y guarda `catalog_extract_inferred_platform` en `brands.metadata`.
  - Para `unknown/custom`, si el adapter no puede extraer, usa LLM para clasificar PDP y extraer RawProduct (HTML+texto).
  - Si no hay URLs producto en sitemap, hace fallback broad y filtra con LLM (solo si PDP LLM está habilitado).
  - Si el sitemap no contiene URLs de producto, se omite (no procesa listados/portafolios) y cae a fallback o manual review.
  - Subida de imágenes reintenta con `referer` y `user-agent` para evitar hotlinking.
  - Normaliza imágenes (acepta JSON-LD ImageObject y extrae `contentUrl`) antes de subir a Blob.
  - Sube imágenes a Vercel Blob y guarda productos/variantes en Neon.
  - Muestra último error y errores recientes para diagnosticar fallas.
  - No pausa la corrida por errores de producto (HTML/imagenes/LLM no-PDP); el auto‑pause queda solo para fallas sistémicas si se habilita.
  - Moneda se infiere por regla (<=999 USD, >=10000 COP) si no viene explícita.
  - Normalizacion determinista para Shopify/Woo; LLM solo se usa para custom/unknown o cuando `CATALOG_LLM_NORMALIZE_MODE=always`.

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
- `POST /api/admin/brands`: crear marca (slug autogenerado si no se envía).
- `GET /api/admin/brands/:id`: detalle completo de marca + último job + `productStats` (conteo y avg real) + `previewProducts` (10 productos).
- `PATCH /api/admin/brands/:id`: editar campos de marca.
- `DELETE /api/admin/brands/:id`: elimina la marca en cascada (hard delete).
- `POST /api/admin/brands/:id/re-enrich`: re‑enriquecimiento individual con método 2 (14 fuentes, 20k chars).

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

## API interna (image proxy)
- `GET /api/image-proxy?url=<encoded>`: descarga la imagen remota, la cachea en Vercel Blob y redirige al asset cacheado.
- Query params opcionales: `productId` y `kind=cover|gallery` (si es `cover`, intenta persistir el cover en DB).
- URLs con formato Cloudflare `cdn-cgi/image/.../https://...` se normalizan al asset original para evitar errores de DNS.

## API interna (product enrichment)
- `GET /api/admin/product-enrichment/state`: estado de corrida (query: `scope=brand|all`, `brandId?`).
- `POST /api/admin/product-enrichment/run`: inicia corrida (body: `{ scope, brandId?, mode: \"batch\"|\"all\", limit?, resume? }`).
- `POST /api/admin/product-enrichment/pause`: pausa corrida (body: `{ runId }`).
- `POST /api/admin/product-enrichment/stop`: detiene corrida (body: `{ runId }`).
- `POST /api/admin/product-enrichment/process-item`: procesa item (body: `{ itemId }`).

## Cron en Vercel
- Configurado en `vercel.json` para ejecutar `/api/admin/brands/scrape/cron` cada 5 minutos.
- El endpoint acepta invocaciones de cron (User-Agent `vercel-cron`) o `ADMIN_TOKEN` en `Authorization`.

## CI/CD y Git
- Repositorio: git@github.com:alejingutierrez/oda_storefront.git
- Pendiente: configurar GitHub Actions y Vercel pipeline.

## Operativa de historias (resumen)
Al abordar una historia: (0) pedir credenciales/definiciones faltantes, (1) rebuild docker, (2) revisar errores, (3) push a la rama, (4) esperar build Vercel y verificar, (5) actualizar README, (6) marcar done en `USER_STORIES.md`, `BACKLOG.md`, `STATUS.md`.

## Próximos pasos sugeridos
- MC-009–017 (F1): taxonomía, búsqueda+pgvector, observabilidad scraping v1, admin mínimo, anuncios básicos, 10–20 marcas, emails/plantillas, ISR/cache y gestión de secrets.
- Integrar VSF UI components y conectores de catálogo.
