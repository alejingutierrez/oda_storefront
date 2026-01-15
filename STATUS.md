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
- 2026-01-15 | MC-001 | done | Estructura base repo (Next TS/Tailwind), servicios scraper/worker stub, docker-compose, .env.example, README inicial; envs creadas en Vercel (prod/preview/dev) | Build local ok (lint/build); Vercel deploy productivo OK (https://oda-storefront-6ee5-hdg0yo8xc-alejingutierrezs-projects.vercel.app); stack docker corriendo en host puerto 3080.
- 2026-01-15 | meta | done | Limpieza de variables duplicadas en Vercel (prefijo `oda_*` removido) y carga de credenciales Neon/Blob finales | Env set consolidado; pendiente acceso del autor correcto para deploy.
- 2026-01-15 | meta | done | Deploy Vercel producción OK | https://oda-storefront-6ee5-hdg0yo8xc-alejingutierrezs-projects.vercel.app
- 2026-01-15 | MC-002 | done | Docker compose local con web/scraper/worker, Postgres pgvector, Redis; healthchecks y puerto 3080 para web; envs alineadas con Vercel | `docker-compose up -d` exitoso; warning de NODE_ENV en Next pendiente de afinado pero servicio operativo.
