# Backlog

## Now (F0 – bootstrap E2E mínimo)
- MC-005 | todo | P0 | Primer scraper E2E | Descubrir sitemap marca piloto, parsear, enviar a GPT-5.2, upsert DB, ficha en VSF + ISR.
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

## Done (2026-01)
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
