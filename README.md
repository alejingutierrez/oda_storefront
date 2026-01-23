# ODA Storefront

Plataforma headless para indexar ~500 marcas de moda colombiana, normalizar catálogos vía OpenAI GPT-5.2 (JSON mode) y servir búsqueda/recomendaciones en Next.js + Vue Storefront, con backend BFF, scrapers y workers dockerizados. Despliegue objetivo: Vercel (web/BFF) + contenedores para scrapers/workers.

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
- Core: `OPENAI_API_KEY`, `OPENAI_MODEL` (opcional, default `gpt-5.2`), `OPENAI_WEB_SEARCH` (opcional), `NEXTAUTH_SECRET`, `VERCEL_TEAM_ID`, `VERCEL_TOKEN`.
- Base de datos (Neon): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_DATABASE_URL`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`.
- Redis: `REDIS_URL`.
- Storage: `VERCEL_BLOB_READ_WRITE_TOKEN`, `BLOB_READ_WRITE_TOKEN`.
- Billing: `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`.
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
- Scraper: `USER_AGENT`, `BRAND_SCRAPE_MAX_JOBS`, `BRAND_SCRAPE_MAX_RUNTIME_MS`.
- Scraper: `BRAND_SCRAPE_STALE_MINUTES` (re-encola jobs en `processing` con más de N minutos).
- Catalog extractor: `CATALOG_EXTRACT_SITEMAP_LIMIT`, `CATALOG_EXTRACT_SITEMAP_MAX_FILES`, `CATALOG_EXTRACT_DISCOVERY_LIMIT`, `CATALOG_EXTRACT_MAX_RUNTIME_MS`, `CATALOG_EXTRACT_CONSECUTIVE_ERROR_LIMIT`, `CATALOG_QUEUE_ENQUEUE_LIMIT`, `CATALOG_QUEUE_NAME`, `CATALOG_QUEUE_STALE_MINUTES`, `CATALOG_ITEM_STUCK_MINUTES`, `CATALOG_WORKER_CONCURRENCY`, `CATALOG_WORKER_API_URL`.
- Catalog extractor (PDP LLM): `CATALOG_OPENAI_MODEL`, `CATALOG_PDP_LLM_ENABLED`, `CATALOG_PDP_LLM_CONFIDENCE_MIN`, `CATALOG_PDP_LLM_MAX_HTML_CHARS`, `CATALOG_PDP_LLM_MAX_TEXT_CHARS`, `CATALOG_PDP_LLM_MAX_IMAGES`.
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
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/unknown-llm-dry-run.ts     # dry-run LLM PDP (unknown)
npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/tech-profiler-sweep.ts     # perfila y elimina marcas no procesables
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
  - Cards 3×5 por página, modal con detalle completo, CRUD (crear/editar/desactivar).
  - Acciones por marca: **Re‑enriquecer** (método 2 con 14 fuentes y 20k chars por fuente).
  - Check azul cuando una marca tiene revisión manual (guardado en `brands.manualReview`).
- Panel `/admin/brands/scrape` (scraping):
  - Encolado y ejecución de scraping/enriquecimiento de marcas (1/5/10/25/50).
  - Auto‑resume tras recarga y recuperación de jobs atascados.
- Panel `/admin/brands/tech` (tech profiler):
  - Ejecuta perfilado de tecnología ecommerce (Shopify/Woo/Magento/VTEX/Tiendanube/Wix/custom).
  - Actualiza `brands.ecommercePlatform` y guarda detalle en `brands.metadata.tech_profile`.
  - Si detecta `social`, `bot_protection`, `unreachable`, `parked_domain`, `landing_no_store`, `no_pdp_candidates` o review `manual_review_no_products`, elimina la marca automáticamente.
- Panel `/admin/products` (productos):
  - Directorio de productos scrapeados con cards, modal de detalle y filtros por marca.
- Panel `/admin/catalog-extractor` (catalog extractor):
  - Ejecuta extracción por **tecnología** con auto‑selección de marca.
  - Controles Play/Pausar/Detener (detener conserva estado para reanudar), reanudación automática y sitemap‑first.
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
  - Moneda se infiere por regla (<=999 USD, >=10000 COP) si no viene explícita.

## API interna (MC-004)
- Endpoint: `POST /api/normalize` (runtime Node).
- Autorización: header `Authorization: Bearer <ADMIN_TOKEN>` (fallback a `NEXTAUTH_SECRET` si no se define). Middleware protege `/api/normalize`.
- Payload: `{ productHtml: string, images: string[], sourceUrl?: string }`.
- Respuesta: objeto `{ product, cost }` normalizado por GPT-5.2 (JSON mode).

## API interna (scraper de marcas)
- `GET /api/admin/brands/scrape`: estado de cola (requiere sesión admin o `ADMIN_TOKEN`).
- `POST /api/admin/brands/scrape`: encola N marcas (`count` = 1,5,10,25,50).
- `POST /api/admin/brands/scrape/next`: procesa el siguiente job (uno por request).
- `GET /api/admin/brands/scrape/cron`: procesa un batch corto para cron (usa `BRAND_SCRAPE_MAX_JOBS` y `BRAND_SCRAPE_MAX_RUNTIME_MS`).
- El enriquecimiento usa `web_search` + fetch HTML (sin Playwright) para extraer señales del sitio oficial y evidencia **textual limpia** de **mínimo 15 fuentes** (hasta 20k caracteres por fuente, guardado en `brands.metadata.brand_scrape`).

## API interna (brands CRUD)
- `GET /api/admin/brands`: listado paginado con filtros (`filter=processed|unprocessed|all`).
- `POST /api/admin/brands`: crear marca (slug autogenerado si no se envía).
- `GET /api/admin/brands/:id`: detalle completo de marca + último job.
- `PATCH /api/admin/brands/:id`: editar campos de marca.
- `DELETE /api/admin/brands/:id`: desactiva la marca (`isActive=false`).
- `POST /api/admin/brands/:id/re-enrich`: re‑enriquecimiento individual con método 2 (14 fuentes, 20k chars).

## API interna (tech profiler)
- `GET /api/admin/brands/tech`: estado de marcas con sitio (total/procesadas/pendientes).
- `POST /api/admin/brands/tech/next`: procesa la siguiente marca pendiente y actualiza su tecnología.

## API interna (catalog extractor)
- `GET /api/admin/catalog-extractor/brands`: lista marcas con `ecommercePlatform`.
- `POST /api/admin/catalog-extractor/run`: ejecuta extracción de catálogo para una marca (body: `{ brandId, limit }`).
- `POST /api/admin/catalog-extractor/finish`: marca marca como terminada y la saca de la cola (body: `{ brandId, reason? }`).
- `POST /api/admin/catalog-extractor/process-item`: procesa un item de catálogo desde worker (body: `{ itemId }`).

## API interna (productos)
- `GET /api/admin/products`: listado paginado de productos (query: `page`, `pageSize`, `brandId`).
- `GET /api/admin/products/brands`: listado de marcas con conteo de productos.
- `GET /api/admin/products/:id`: detalle de producto con variantes.

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
