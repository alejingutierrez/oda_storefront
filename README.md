# ODA Storefront

Plataforma headless para indexar ~500 marcas de moda colombiana, normalizar catálogos vía OpenAI GPT-5.2 (JSON mode) y servir búsqueda/recomendaciones en Next.js + Vue Storefront, con backend BFF, scrapers y workers dockerizados. Despliegue objetivo: Vercel (web/BFF) + contenedores para scrapers/workers.

## Estructura
- `apps/web` – Front + BFF en Next.js (App Router, TS, Tailwind).
- `services/scraper` – Scraper stub (Node) listo para integrar descubrimiento de sitemap y parsers por marca.
- `services/worker` – Worker stub (BullMQ) para orquestar ingestión y pipeline IA.
- `docker-compose.yml` – Web, scraper, worker, Postgres (pgvector), Redis.
- `AGENTS.md`, `BACKLOG.md`, `USER_STORIES.md`, `STATUS.md` – Documentación y control operativo.

## Requisitos
- Node 18/20, npm.
- Docker + Docker Compose (para entorno local).

## Variables de entorno
Copiar `.env.example` a `.env`/`.env.local` y completar:
- Core: `OPENAI_API_KEY`, `NEXTAUTH_SECRET`, `VERCEL_TEAM_ID`, `VERCEL_TOKEN`.
- Base de datos (Neon): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_DATABASE_URL`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`.
- Redis: `REDIS_URL`.
- Storage: `VERCEL_BLOB_READ_WRITE_TOKEN`, `BLOB_READ_WRITE_TOKEN`.
- Billing: `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`.
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
- Scraper: `USER_AGENT`.
No commitees credenciales reales.

## Comandos locales
```bash
cd apps/web
npm install        # ya ejecutado en bootstrap
npm run dev        # http://localhost:3000
npm run lint
npm run build
```

### Docker Compose (stack completo)
```bash
docker-compose build
docker-compose up
```
Servicios: `web` (host 3080 → contenedor 3000), `db` (5432), `redis` (6379), `scraper`, `worker`.

## Base de datos y Prisma
- Esquema definido en `apps/web/prisma/schema.prisma`, cliente generado en `apps/web/src/generated/prisma`.
- Migración inicial (`20260115125012_init_schema`) crea tablas core y habilita `pgvector`.
- Comandos (con stack de docker levantado):
  ```bash
  cd apps/web
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx prisma generate
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx prisma migrate dev --name <nombre>
  ```
  Si tu host no ve el contenedor en `localhost`, puedes ejecutar sobre la red de compose:
  ```bash
  docker run --rm --network=oda_storefront_default \
    -v "$(pwd)/apps/web":/app -w /app node:20 \
    sh -c "npm install prisma @prisma/client --no-save >/dev/null && \
           DATABASE_URL=postgres://postgres:postgres@db:5432/postgres npx prisma migrate dev --name <nombre>"
  ```
- Para inspeccionar DB local: `docker-compose exec db psql -U postgres -c "\dt"`.

## Admin
- Ruta `/admin` reservada para el panel interno (placeholder inicial). Aquí se listarán scrapers, normalizaciones y aprobaciones.

## CI/CD y Git
- Repositorio: git@github.com:alejingutierrez/oda_storefront.git
- Pendiente: configurar GitHub Actions y Vercel pipeline.

## Operativa de historias (resumen)
Al abordar una historia: (0) pedir credenciales/definiciones faltantes, (1) rebuild docker, (2) revisar errores, (3) push a la rama, (4) esperar build Vercel y verificar, (5) actualizar README, (6) marcar done en `USER_STORIES.md`, `BACKLOG.md`, `STATUS.md`.

## Próximos pasos sugeridos
- MC-009–017 (F1): taxonomía, búsqueda+pgvector, observabilidad scraping v1, admin mínimo, anuncios básicos, 10–20 marcas, emails/plantillas, ISR/cache y gestión de secrets.
- Integrar VSF UI components y conectores de catálogo.
