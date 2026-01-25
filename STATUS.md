# STATUS (resumen operativo)

Usar este archivo para registrar, de forma breve, el estado global y los cierres de historias.

Formato sugerido:
- YYYY-MM-DD | MC-XXX | done | Resumen corto de lo entregado | Notas (build Vercel ok?/link, README actualizado, etc.)

Checklist obligatorio al cerrar una historia:
0) Pedir requisitos previos al solicitante (credenciales/API keys, definiciones faltantes, accesos).
1) Rebuild docker.
2) Revisar salida del rebuild y corregir errores.
3) Push a la rama.
4) Esperar y revisar build en Vercel hasta que finalice correctamente.
5) Actualizar README con cambios relevantes.
6) Marcar la historia como terminada en `USER_STORIES.md`, `BACKLOG.md` y en este `STATUS.md`.

Registros:
- 2026-01-25 | MC-088 | done | Catalog extractor sin pausa por errores soft | Docker rebuild ok; logs web/worker/scraper OK; Vercel pendiente.
- 2026-01-25 | MC-087 | done | Modal productos + carrusel en cards | Docker rebuild ok; logs web/worker/scraper OK; Vercel prod OK: https://oda-storefront-6ee5.vercel.app (deploy dpl_8T6XGHVMRQ4qtHTfBdeC7RUcbmUG).
- 2026-01-25 | MC-085 | done | Style tags exactos 10 | Docker rebuild: ok; logs web/worker/scraper OK.
- 2026-01-25 | MC-084 | done | Auto‑refresh enrichment solo con runs processing | Docker rebuild: ok; logs web/worker/scraper OK.
- 2026-01-25 | MC-083 | done | Estabilidad product‑enrichment (drain cron + auto‑refresh) | Docker rebuild: ok; Vercel prod OK: https://oda-storefront-6ee5.vercel.app; endpoint drain probado (200).
- 2026-01-25 | MC-082 | done | Normalizacion determinista v2 (reglas extendidas) | Docker rebuild ok; docker-compose up ok; logs web/worker/scraper saludables (warning sslmode); vercel build local OK; Vercel preview OK: https://oda-storefront-6ee5-git-mc-081-c37d8b-alejingutierrezs-projects.vercel.app
- 2026-01-25 | MC-081 | done | Catalog extractor: normalizacion determinista + menos OpenAI + retries cola | Docker rebuild: fallo (daemon apagado); vercel build local OK; Vercel preview OK: https://oda-storefront-6ee5-git-mc-081-c37d8b-alejingutierrezs-projects.vercel.app
- 2026-01-24 | MC-080 | done | Enriquecimiento IA de productos (admin + cola + GPT-5 mini) | Docker rebuild: falló (daemon apagado); migración `20260124123000_product_enrichment` aplicada en Neon; Vercel prod OK: https://oda-storefront-6ee5.vercel.app; prueba batch 10 random OK (10/10).
- 2026-01-23 | MC-079 | fix | Auto‑Play all no se detiene tras primera marca | Vercel prod OK: https://oda-storefront-6ee5-cnktphvd0-alejingutierrezs-projects.vercel.app
- 2026-01-23 | MC-078 | done | Botón Auto‑Play para recorrer todas las marcas sin selección manual | Vercel prod OK: https://oda-storefront-6ee5-e9bxrn5om-alejingutierrezs-projects.vercel.app
- 2026-01-23 | MC-077 | done | Auto-play selecciona marcas sin productos y encadena siguiente | Vercel prod OK: https://oda-storefront-6ee5-kvt8951mv-alejingutierrezs-projects.vercel.app
- 2026-01-23 | MC-076 | done | PDP LLM sin temperature en gpt-5 (evita 400) | Vercel prod OK: https://oda-storefront-6ee5-8tb3bbgn0-alejingutierrezs-projects.vercel.app
- 2026-01-23 | MC-075 | done | Errores no detienen extractor (sin auto‑pause) + auto‑resume continuo | Vercel prod OK: https://oda-storefront-6ee5-hnw0qqnzc-alejingutierrezs-projects.vercel.app (CATALOG_AUTO_PAUSE_ON_ERRORS=false).
- 2026-01-23 | MC-074 | done | Resume robusto (barrido + drain ilimitado por tiempo) y Blob path safe (#/?) | Vercel prod OK: https://oda-storefront-6ee5-54lb6safv-alejingutierrezs-projects.vercel.app (envs drain/resume actualizadas).
- 2026-01-23 | MC-073 | done | Drain serverless catálogo con cron Vercel | Build local OK (env); Vercel prod OK: https://oda-storefront-6ee5-8qznsuruv-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-072 | done | Redis + cola operativa en Vercel (guardas + timeout) | Docker rebuild: no ejecutado (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-65dxt41qs-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-071 | done | Blob robusto: sanitizar path + tolerar fallos parciales | Build local OK (env); Vercel prod OK: https://oda-storefront-6ee5-qiuv3hfhu-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-070 | done | Concurrencia catálogo v2 (cola + runs/items + backfill) | Build local OK (env); Vercel prod OK: https://oda-storefront-6ee5-qiuv3hfhu-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-069 | done | Telemetría de extractor + pausa por errores consecutivos | Docker rebuild: no requerido; build local OK (env); Vercel prod OK: https://oda-storefront-6ee5-htp4h72kw-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-068 | done | Resume UI + barrido de URLs + GPT-5 mini en productos | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-d0jxgupfa-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-067 | done | Detener extractor conserva estado y permite reanudar | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-78a47fh4x-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-23 | MC-066 | done | Catalog extractor: finalizar marca y sacarla de la cola | Docker rebuild: ok; servicios locales OK; Vercel pendiente (sin acceso).
- 2026-01-23 | MC-065 | done | LLM PDP fallback + limpieza de marcas | Docker rebuild: ok; servicios locales OK; Vercel pendiente.
- 2026-01-22 | MC-064 | done | Normaliza ImageObject antes de subir a Blob | Docker rebuild: ok; Vercel prod OK: https://oda-storefront-6ee5-l2c89z1w0-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-22 | MC-063 | done | Blob retry con referer/UA | Docker rebuild: ok; Vercel prod OK: https://oda-storefront-6ee5-bcdhvfxlm-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-22 | MC-062 | done | Custom: omite sitemap sin PDPs + excluye /portafolio | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app (alias).
- 2026-01-22 | MC-061 | done | Unknown: sitemaps extra + inferencia rápida plataforma sin LLM | Docker rebuild: falló (daemon apagado); pruebas rápidas con tsx no ejecutables por alias `@/` fuera de tsconfig; Vercel prod OK: https://oda-storefront-6ee5-bv62sxd1m-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-22 | MC-060 | done | Custom adapter filtra listados por og:type/rutas | Docker rebuild: falló (daemon apagado); pruebas unknown con PDPs OK (Derek, Lyenzo, Zuahaza); Vercel prod OK: https://oda-storefront-6ee5-38wsp1vwl-alejingutierrezs-projects.vercel.app.
- 2026-01-22 | MC-059 | done | Custom adapter evita listados y acepta pistas de PDP sin JSON-LD | Docker rebuild: falló (daemon apagado); ejecución batch tech profiler completada; Vercel prod OK: https://oda-storefront-6ee5-inhkc67k2-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-22 | MC-058 | done | Mejoras unknown: tech profiler Tiendanube/Wix + parked/unreachable + patrones de producto | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-eh4orhbg9-alejingutierrezs-projects.vercel.app (logs sin eventos).
- 2026-01-22 | MC-057 | done | Marca manualReview cuando no hay productos detectables | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-836cmfy95-alejingutierrezs-projects.vercel.app
- 2026-01-22 | MC-056 | done | Filtra URLs de sitemap por mismo dominio | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-7xssnhjib-alejingutierrezs-projects.vercel.app
- 2026-01-22 | MC-055 | done | Fallback a API cuando sitemap no trae productos (evita URLs no-producto en VTEX) | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-iq7spmpy5-alejingutierrezs-projects.vercel.app
- 2026-01-21 | MC-054 | done | Sitemap discovery full (index/gz) + fallback HTML Woo/VTEX + smoke test por tecnología | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-ppznfqdln-alejingutierrezs-projects.vercel.app (logs sin eventos en tail).
- 2026-01-21 | MC-053 | done | VTEX: linkText desde URL en sitemap + error con plataforma/URL | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-9pube0ap3-alejingutierrezs-projects.vercel.app
- 2026-01-21 | MC-052 | done | Panel catalog extractor ahora muestra errores y bloqueos | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-6o0cbizja-alejingutierrezs-projects.vercel.app
- 2026-01-21 | MC-051 | done | Catalog extractor por tecnologia: play/pausa/detener, auto‑avance y sitemap‑first con reanudación | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-dfx8rvjsp-alejingutierrezs-projects.vercel.app
- 2026-01-21 | MC-050 | done | Tech profiler sanitiza Unicode y parseo JSON tolerante para evitar 500 por escapes inválidos | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-8nelw4f1b-alejingutierrezs-projects.vercel.app
- 2026-01-21 | MC-049 | done | Default OpenAI vuelve a gpt-5.2 en scrapers/normalizer y docs | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-pz7sc4d9s-alejingutierrezs-projects.vercel.app
- 2026-01-21 | MC-048 | done | Limpieza de evidencia: HTML→texto, filtrado de líneas y priorización por señales relevantes para OpenAI | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5-ilgipaww5-alejingutierrezs-projects.vercel.app
- 2026-01-20 | MC-047 | done | Cambia modelo OpenAI por defecto a gpt-5-mini para scrapers | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-046 | done | Reglas de moneda (USD/COP), parseo de precios, currency en productos + reset catálogo (truncate products/variants) | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-045 | done | Progreso extractor productos (barra informativa + reanudación por tandas + fix OpenAI wrapper) | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-044 | done | Directorio admin de productos (cards + modal, filtro por marca, endpoints /api/admin/products) | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-043 | done | Catalog extractor por tecnología (Shopify/Woo/Magento/VTEX/Custom) con panel `/admin/catalog-extractor`, normalización OpenAI y subida a Blob | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-042 | done | Revisión manual de marcas (check azul en cards + toggle en modal, persistido en DB) | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-041 | done | Tech profiler de marcas (campo ecommercePlatform, panel /admin/brands/tech, API tech profiler) | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-040 | done | Re‑enriquecer por marca (método 2: 14 fuentes, 20k chars) + mini progreso en card | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-039 | done | Cards muestran logo cuando existe y URLs clicables en modal de marca | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-038 | done | Admin con sidebar anclado a la izquierda para ganar espacio de canvas | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-037 | done | Resiliencia scraping admin: re‑encola jobs atascados, auto‑resume tras recarga, /admin/brands separado de /admin/brands/scrape y menú lateral | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-20 | MC-036 | done | Directorio admin de marcas con cards 3x5, modal de detalle, CRUD y filtros/paginación; API CRUD brands | Docker rebuild: falló (daemon apagado); Vercel prod OK: https://oda-storefront-6ee5.vercel.app
- 2026-01-19 | MC-035 | fix | Ajusta botón "Encolar y ejecutar": ahora procesa solo la cantidad encolada (evita drenar cola completa) | Docker rebuild: TLS handshake timeout con docker.io; Vercel prod OK: https://oda-storefront-6ee5-jpvx4krxz-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Ajusta web_search: query única con instagram, tool config CO/high y alerta si <10 fuentes | Docker rebuild: error Docker API 500; Vercel prod OK: https://oda-storefront-6ee5-8er10tg0o-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Sanitiza texto para evitar Unicode inválido en metadata (surrogates/control chars) | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-435cz194p-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Coerción de sources.other a strings (url/title) para evitar fallos de validación OpenAI | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-gnw7hyy47-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Normaliza payload OpenAI: coerce para opening_hours (string→obj/null), sources.website (array→string), y lat/lng desde string | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-iqrt6ftb5-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Aumenta evidencia a 10k caracteres por fuente en enrichment de marcas | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-g11gbakrb-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Evidencia web mínima 7 fuentes: fetch HTML de fuentes, extracción de texto/título, se pasa como evidence_texts a OpenAI y se guarda en metadata | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-a1v57ppob-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Mejora UI de diff en admin: muestra solo campos cambiados con antes/después legible | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-97sbtpmql-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Mejora calidad de datos de marcas: se agregan señales multi‑página (contacto/ubicación), parsing de JSON-LD @graph/sameAs, extracción de lat/lng en mapas/meta/data, prompt con evidencia y fallback a valores existentes | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-qbk546zju-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | fix | Corrige 500 en `/api/admin/brands` por conteos BigInt (casts a int en summary) | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-kctrrzw34-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-035 | done | Scraper de marcas con cola (1/5/10/25/50), panel /admin/brands, endpoints admin + cron, tabla completa de marcas con diff antes/después y enriquecimiento OpenAI web search + fallback HTML, tabla brand_scrape_jobs | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-juzgjesbw-alejingutierrezs-projects.vercel.app
- 2026-01-19 | MC-006 | done | Login admin (email/password + cookie), seed admin en Neon, /admin directo, middleware sólo en /api/normalize; carga Excel a columnas (incluye ratings) | Docker rebuild ok; Vercel prod OK: https://oda-storefront-6ee5-8wm8f249r-alejingutierrezs-projects.vercel.app
- 2026-01-19 | meta | done | Sync repo con origin, fixes build Vercel (OpenAI lazy client + Node 22), docker compose healthy (web/worker/db/redis) | Vercel preview OK: https://oda-storefront-6ee5-o4pjm62bz-alejingutierrezs-projects.vercel.app
- 2026-01-15 | MC-001 | done | Estructura base repo (Next TS/Tailwind), servicios scraper/worker stub, docker-compose, .env.example, README inicial; envs creadas en Vercel (prod/preview/dev) | Build local ok (lint/build); Vercel deploy productivo OK (https://oda-storefront-6ee5-hdg0yo8xc-alejingutierrezs-projects.vercel.app); stack docker corriendo en host puerto 3080.
- 2026-01-15 | meta | done | Limpieza de variables duplicadas en Vercel (prefijo `oda_*` removido) y carga de credenciales Neon/Blob finales | Env set consolidado; pendiente acceso del autor correcto para deploy.
- 2026-01-15 | meta | done | Deploy Vercel producción OK | https://oda-storefront-6ee5-hdg0yo8xc-alejingutierrezs-projects.vercel.app
- 2026-01-15 | MC-002 | done | Docker compose local con web/scraper/worker, Postgres pgvector, Redis; healthchecks y puerto 3080 para web; envs alineadas con Vercel | `docker-compose up -d` exitoso; warning de NODE_ENV en Next pendiente de afinado pero servicio operativo.
- 2026-01-15 | MC-003 | done | Esquema inicial + migración Prisma (brands, stores, products, variants, price/stock history, assets polimórficos, taxonomy_tags, users, events, announcements) con pgvector | Migración `20260115125012_init_schema` aplicada en DB local (pgvector habilitado); Prisma client generado.
- 2026-01-15 | MC-004 | done | Cliente OpenAI GPT-5.2 con retries y validación Zod; endpoint `/api/normalize`; middleware Bearer (ADMIN_TOKEN/NEXTAUTH_SECRET) protegiendo admin/API; README actualizado; build y lint ok | Deploy Vercel incluye /admin y /api/normalize.
- 2026-01-25 | MC-086 | done | Progreso incremental product-enrichment (no drain en run) | Docker rebuild ok; servicios healthy; Vercel prod OK: https://oda-storefront-6ee5-qe83zgip0-alejingutierrezs-projects.vercel.app (runtime logs sin eventos).
