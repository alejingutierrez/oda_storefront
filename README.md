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
- `OPENAI_API_KEY` (GPT-5.2), `VERCEL_TEAM_ID`, `VERCEL_TOKEN`
- `NEON_DATABASE_URL` (prod/stg) y `DATABASE_URL` (local, apunta a `db` del compose)
- `REDIS_URL`, `VERCEL_BLOB_READ_WRITE_TOKEN`
- `WOMPI_PUBLIC_KEY`/`WOMPI_PRIVATE_KEY`
- `SMTP_*`, `NEXTAUTH_SECRET`
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
Servicios: `web` (3000), `db` (5432), `redis` (6379), `scraper`, `worker`.

## CI/CD y Git
- Repositorio: git@github.com:alejingutierrez/oda_storefront.git
- Pendiente: configurar GitHub Actions y Vercel pipeline.

## Operativa de historias (resumen)
Al abordar una historia: (0) pedir credenciales/definiciones faltantes, (1) rebuild docker, (2) revisar errores, (3) push a la rama, (4) esperar build Vercel y verificar, (5) actualizar README, (6) marcar done en `USER_STORIES.md`, `BACKLOG.md`, `STATUS.md`.

## Próximos pasos sugeridos
- MC-009–017 (F1): taxonomía, búsqueda+pgvector, observabilidad scraping v1, admin mínimo, anuncios básicos, 10–20 marcas, emails/plantillas, ISR/cache y gestión de secrets.
- Integrar VSF UI components y conectores de catálogo.
