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
