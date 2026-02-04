# Backlog

## Now (F0 – bootstrap E2E mínimo)
- MC-005 | todo | P0 | Primer scraper E2E | Descubrir sitemap marca piloto, parsear, enviar a GPT-5.1, upsert DB, ficha en VSF + ISR.
- MC-007 | todo | P1 | CI lint/test smoke | GitHub Actions: lint, type-check, unit smoke; build contenedores básicos.
- MC-008 | todo | P1 | Observabilidad mínima | Logging estructurado, health checks, traces básicos; dashboard inicial de servicios.

## Next (F1 – primeras capacidades)
- MC-009 | todo | P1 | Taxonomía fija y catálogos | Categorías, materiales, patrones, fits, estilo/ocasión; publicación para IA y front.
- MC-010 | todo | P1 | Búsqueda básica + pgvector | Index texto/embeddings, endpoint search, listados VSF, métricas de calidad.
- MC-011 | todo | P1 | Observabilidad scraping v1 | Métricas por marca, staleness, alertas básicas, dashboard.
- MC-012 | todo | P2 | Admin mínimo | Login, CRUD marcas/tiendas, salud scraper, aprobación manual de normalizaciones IA.
- MC-013 | todo | P2 | Anuncios básicos | Modelo de placements, serving simple, tracking impresiones/clicks.
- MC-014 | todo | P1 | 10–20 marcas integradas | Parsers templated, scheduler adaptativo, cobertura inicial.
- MC-015 | todo | P2 | Emails y plantillas | SMTP/SendGrid, plantillas de servicio, opt-in/opt-out, logs de envío.
- MC-016 | todo | P1 | ISR/Cache y performance | Cache headers, revalidación, budgets CWV, optimización de imágenes.
- MC-017 | todo | P1 | Gestión de secrets/entornos | Matriz local/stg/prod, rotación, docs de configuración.

## Later (F2–F3 – escalado y premium)
- MC-018 | todo | P1 | Recomendador híbrido v1 | Embeddings texto/imagen, kNN, reglas stock/talla, API de similares.
- MC-019 | todo | P1 | Recomendaciones proactivas + alertas | Back-in-stock, drops, email/push, control por plan.
- MC-020 | todo | P1 | Planes pagos Wompi | Checkout suscripción, webhooks, flags de features, facturación.
- MC-021 | todo | P2 | Try-on IA MVP | Upload seguro a Blob, pipeline async, expiración de assets, UX básica.
- MC-022 | todo | P2 | Panel advertiser | Campañas, budget, targeting simple, reporting CTR/CPA.
- MC-023 | todo | P2 | Versionado de prompts + FinOps IA | Costos por marca, límites diarios, dashboards de drift/error rate.
- MC-024 | todo | P1 | Escalado a 100+ marcas | Pool de proxies, crawler de respaldo, priorización por rotación/frescura.
- MC-025 | todo | P2 | Data quality & drift dashboard | Campos faltantes, duplicados, staleness, drift de modelo IA.
- MC-026 | todo | P2 | Gestión de colas y reintentos | Retries exponenciales, DLQ, priorización por marca/frescura.
- MC-027 | todo | P2 | Segmentación estilo/ocasión + A/B ranking | Experimentos, cohortes, métricas automáticas.
- MC-028 | todo | P2 | Store locator enriquecido | Geocodificación, horarios/teléfonos/redes actualizados, UX de mapa.
- MC-029 | todo | P2 | Seguridad y privacidad reforzada | WAF, rate limit afinado, borrado/anonimización try-on, auditoría completa.
- MC-030 | todo | P2 | Optimización de costos infra | Cache de inferencias sin cambios, compresión de assets, tuning colas/batch.
- MC-031 | todo | P2 | Despliegue prod Vercel + contenedores workers | Ramas stg/prod, CI/CD completo, monitoreo post-deploy.
- MC-032 | todo | P1 | Cobertura 500 marcas | Escalado scraping, acuerdos con marcas clave, SLAs de frescura.
- MC-033 | todo | P2 | Legal/compliance y políticas | Términos, privacidad, manejo de robots, procesos de takedown, retención de datos.
- MC-034 | todo | P2 | Performance & resiliencia front | Budgets CWV, fallbacks, manejo de errores de catálogo.

## Done (2026-02)
- MC-108 | done | P1 | Fix cola de scraping de marcas | Encolar solo marcas sin job completed y drenar cola existente desde UI.
- MC-109 | done | P1 | Onboarding de marca en modal | Crear marca inicia pipeline (enrich → tech → catálogo → productos) con barra de progreso y endpoints onboarding.
- MC-110 | done | P1 | Refresh semanal de catálogo + monitor admin | Cron semanal con jitter, refresco completo, métricas de cambios y panel `/admin/catalog-refresh`; VTEX discovery sin cap fijo.

## Done (2026-01)
- MC-107 | done | P1 | Enrichment: esquema estricto + repair/chunking Bedrock | 1 imagen por variante, repair pass y chunking por variantes; smoke test Bedrock; concurrencia 40 en envs prod.
- MC-106 | done | P1 | Estilos principal/secundario por styleTags | Tabla style_profiles + trigger + backfill; labels humanos en admin.
- MC-105 | done | P1 | Filtro por rol de color en combinaciones | `/api/admin/color-combinations/[id]/products` filtra por categorias permitidas segun rol (dominante/secundario/acento).
- MC-104 | done | P1 | Enrichment productos con Claude (Bedrock) | Product enrichment usa Bedrock (Claude Sonnet 4.5) vía inference profile; OpenAI queda para el resto.
- MC-103 | done | P1 | Campos SEO en productos + enriquecimiento IA | Nuevas columnas seoTitle/seoDescription/seoTags[] y prompt de enrichment genera meta title/description + tags.
- MC-102 | done | P1 | Enriquecimiento productos: persistencia + progreso realtime + reset batches | URL state, conteos por status en UI y endpoint para limpiar batches activos.
- MC-100 | done | P1 | Filtro de categorias + orden por productos en /admin/brands | Multiselect `brands.category` y sort `productCount` asc/desc.
- MC-099 | done | P1 | Contador pendientes marcas: desglose y elegibilidad | `/api/admin/brands` expone pending breakdown (queued/no_jobs/failed/manualReview/cloudflare) y la UI lo muestra.
- MC-098 | done | P1 | Acelerar serving de imágenes (proxy+cache) | Nuevo `/api/image-proxy` cachea en Blob/CDN y el admin lo usa en logos/grids con `next/image`.
- MC-097 | done | P1 | Persistencia de navegación en admin (page/filter en URL) | `/admin/brands` y `/admin/products` conservan página/filtros tras reload/acciones y ajustan página si se sale de rango.
- MC-096 | done | P1 | Modal marcas: stats reales + preview + delete cascada | Modal usa stats reales desde variants, preview 10 productos con deep-link a `/admin/products?productId=...` y delete hard cascade.
- MC-095 | done | P1 | UI: ver marcas sin run agrupadas por tecnología | Toggle en extractor + API soporta onlyNoRun/all y límite ampliado.
- MC-094 | done | P1 | Sitemap discovery tolerante a fallos | Robots/sitemaps con fetch error no bloquean el run; fallback a adapter.
- MC-093 | done | P1 | Sitemap completo sin corte temprano | No se corta en el primer sitemap de productos; límite configurable y sin cap fijo.
- MC-090 | done | P1 | Sitemap budget + precios Woo fallback | Prioriza robots y limita tiempo de discovery; precios Woo se completan con fallback HTML cuando API devuelve 0.
- MC-091 | done | P1 | Drain finaliza runs idle + control sitemap/queue | Drain marca run completed si no hay pendientes; /run respeta enqueueOnly y `CATALOG_FORCE_SITEMAP`.
- MC-092 | done | P1 | Reducir reintentos de catálogo | Máximo 1 reintento por producto y 1 reintento en cola.
- MC-089 | done | P1 | Concurrencia alta + progreso frecuente en extractor | Drenado más rápido y polling ~2s en UI.
- MC-088 | done | P1 | Catalog extractor no pausa por errores de producto | Errores soft no cuentan para auto-pause; continua la corrida.
- MC-087 | done | P2 | Modal productos + carrusel en cards | Colores visibles con swatches, resumen de variantes y navegación de fotos en listado.
- MC-086 | done | P2 | Progreso incremental en panel product-enrichment | Run no drena en la misma request; barra avanza vía polling + cron.
- MC-085 | done | P2 | Style tags exactos 10 | Prompt y validación ajustados a 10 tags exactos.
- MC-084 | done | P2 | Auto-refresh solo con runs processing | Panel enrichment refresca solo cuando hay run activo.
- MC-083 | done | P1 | Estabilidad product-enrichment (cron + auto-refresh) | Drain serverless y cron Vercel para product-enrichment; auto-refresh en panel.
- MC-082 | done | P1 | Normalizacion determinista v2 (reglas extendidas) | Reglas de categoria, material, patron, fit y color mejoradas para reducir LLM.
- MC-081 | done | P1 | Catalog extractor: normalizacion determinista + menos OpenAI | Shopify/Woo sin LLM, payload LLM recortado, retries/backoff en cola, auto-finish marcas sin fallos.
- MC-080 | done | P1 | Enriquecimiento IA de productos | Admin + cola para enriquecer categorías/tags/colores/fit con GPT-5 mini.
- MC-073 | done | P1 | Drain serverless catálogo (Vercel cron) | Endpoint drain + cron cada minuto para procesar sin worker persistente.
- MC-072 | done | P1 | Redis + cola operativa en Vercel | REDIS_URL correcto en Vercel, guardas de cola y reanudacion sin timeouts.
- MC-071 | done | P1 | Blob robusto: sanitizar path + tolerar fallos | Evita error por # y no aborta por fallos parciales.
- MC-070 | done | P1 | Concurrencia catálogo v2 (cola + runs/items) | Tablas + BullMQ + worker + backfill.
- MC-069 | done | P1 | Robustez extractor: telemetría + pausa por errores | lastUrl/lastStage/errorSamples y pausa por errores consecutivos.
- MC-068 | done | P1 | Resume UI + barrido + GPT-5 mini en productos | Botón Resume en pausa/stop, sync cursor, modelo barato para PDP/normalización.
- MC-067 | done | P1 | Detener extractor conserva estado | Stop mantiene cursor/refs y permite reanudar sin reiniciar.
- MC-066 | done | P1 | Finalizar marca en catalog extractor | Botón y endpoint para sacar marcas de la cola y registrar `catalog_extract_finished`.
- MC-064 | done | P1 | Normalizar ImageObject en blob | Extrae contentUrl/thumbnail antes de upload.
- MC-065 | done | P1 | LLM PDP fallback + limpieza de marcas | Clasifica PDP con LLM, extrae RawProduct y elimina marcas no procesables.
- MC-063 | done | P1 | Blob: retry con referer/UA | Reduce fallos por hotlinking al subir imágenes.
- MC-062 | done | P1 | Custom: evitar URLs no-producto desde sitemap | Excluye /portafolio y no usa URLs no-producto cuando no hay coincidencias.
- MC-061 | done | P1 | Unknown: sitemaps extra + inferencia rápida plataforma | Nuevos sitemaps (wp/products/store), inferencia sin LLM y pistas microdata.
- MC-060 | done | P1 | Custom: excluir listados por og:type/rutas | Negativos blog/collections + og:type website sin price meta.
- MC-059 | done | P1 | Custom: omitir listados y detectar producto por pistas | Ajusta heurísticas /tienda y /shop; acepta product hints cuando no hay JSON-LD.
- MC-058 | done | P1 | Mejoras unknown: tech profiler + custom discovery | Tiendanube/Wix + parked/unreachable; patrones /product-page y /product-.
- MC-057 | done | P1 | Marcar manualReview cuando no hay productos | Bloquea runs sin productos y setea manualReview + metadata de revisión.
- MC-056 | done | P1 | Filtrar sitemap a mismo dominio | Evita URLs externas en VTEX y reduce raw vacío.
- MC-055 | done | P1 | Fallback a API si sitemap no trae productos | Evita URLs no-producto en VTEX; usa discovery del adapter.
- MC-054 | done | P1 | Sitemap scan completo + fallbacks Woo/VTEX | Descubrimiento product-aware, gzip/index, límite de sitemaps y smoke test; Vercel pendiente (sin token).
- MC-053 | done | P1 | Fix VTEX linkText en sitemap + error más claro | Deriva linkText desde URL y mejora mensaje cuando raw es vacío.
- MC-052 | done | P1 | Errores visibles en catalog extractor | Muestra último error, bloqueos y errores recientes en panel.
- MC-051 | done | P1 | Catalog extractor por tecnologia con play/pause/stop | Seleccion por plataforma, auto‑avance de marcas, sitemap-first y reanudacion por cursor.
- MC-050 | done | P1 | Fix Unicode tech profiler | Sanitiza Unicode y parseo JSON para evitar errores de escape al guardar metadata.
- MC-049 | done | P1 | Volver a modelo OpenAI gpt-5.2 | Default en scrapers/normalizer y env example/documentación.
- MC-048 | done | P1 | Evidencia textual limpia en scraper de marcas | Limpieza de HTML→texto, prioriza líneas relevantes y reduce ruido en evidencia OpenAI.
- MC-047 | done | P1 | Cambiar modelo OpenAI a gpt-5-mini | Reduce costos en scrapers (marcas, tech, catálogo).
- MC-046 | done | P1 | Reglas de moneda + reset catálogo | Parsing precios, currency en productos, truncate products/variants.
- MC-045 | done | P1 | Progreso extractor productos | Barra de progreso informativa + reanudación por tandas + hardening OpenAI.
- MC-044 | done | P1 | Directorio de productos admin | Cards con detalle, filtros por marca, endpoints productos.
- MC-043 | done | P1 | Catalog extractor por tecnología | Adaptadores Shopify/Woo/Magento/VTEX/Custom, normalización OpenAI, imágenes a Blob, panel admin.
- MC-042 | done | P2 | Revisión manual de marcas | Check azul en cards + toggle en modal, persistido en DB.
- MC-041 | done | P1 | Tech profiler de marcas | Campo ecommercePlatform, perfilado Shopify/Woo/Magento/VTEX, panel /admin/brands/tech.
- MC-035 | done | P1 | Scraper de marcas (enriquecimiento OpenAI) | Panel /admin/brands con cola 1/5/10/25/50; endpoints admin + cron; OpenAI web search JSON mode + fallback HTML; diff de cambios en historial; actualización de tabla brands y metadata.
- MC-006 | done | P1 | Autenticación y roles base | Login admin (email/password + cookie), ruta /admin sin /admin/login, seed admin en Neon, middleware sólo en /api/normalize.
- MC-004 | done | P0 | Conexión OpenAI GPT-5.2 JSON mode | Helper con retries/validación Zod, endpoint `/api/normalize`, middleware Bearer (ADMIN_TOKEN/NEXTAUTH_SECRET), carpeta `/admin` base; README documentado.
- MC-003 | done | P1 | Esquema Neon + migraciones | Prisma schema con brands/stores/products/variants/price&stock history/assets/events/taxonomy/announcements/users; pgvector habilitado; migración `20260115125012_init_schema`.
- MC-002 | done | P1 | Docker compose local | Servicios web/scraper/worker, Postgres pgvector, Redis; healthchecks; puerto host 3080; `.env.example` alineado con Vercel; stack sube con `docker-compose up -d`.
- MC-001 | done | P1 | Estructura base repo y convenciones | Next app TS/Tailwind en apps/web, estructura servicios scraper/worker, .gitignore, .env.example, docker-compose base, README creado.
- MC-036 | done | P1 | Directorio de marcas admin | Grid 3x5, modal detalle, CRUD marcas, filtros/paginación en /admin/brands; endpoints CRUD en /api/admin/brands.
- MC-037 | done | P1 | Resiliencia scraping admin | Re‑encolar jobs atascados, auto‑resume tras recarga, separación de /admin/brands y /admin/brands/scrape con menú lateral.
- MC-038 | done | P2 | Admin layout anclado | Sidebar anclado a la izquierda para maximizar el canvas de contenido.
- MC-039 | done | P2 | Mejoras cards marcas | Mostrar logo en card y URLs cliqueables en modal.
- MC-040 | done | P1 | Re‑enriquecimiento por marca | Método 2 (14 fuentes, 20k chars) desde card con progreso mini.

---
**Instrucción operativa**: al abordar cualquier historia de este backlog: (0) pedir requisitos previos (credenciales/API keys, definiciones faltantes), (1) rebuild docker, (2) revisar salida y corregir errores, (3) push a la rama, (4) esperar y revisar build en Vercel hasta que finalice bien, (5) actualizar README con cambios relevantes, (6) marcar la historia como terminada en `USER_STORIES.md`, `BACKLOG.md` y en `STATUS.md`.
