# BD_NEON

Documento operativo de la base de datos principal (Neon Postgres) y el manejo de usuarios/admin.

## Contexto
- Fuente de verdad: Neon Postgres.
- Esquema: `apps/web/prisma/schema.prisma`.
- Migraciones: `apps/web/prisma/migrations/`.

## Extensiones
- `vector` (pgvector) habilitada en la migracion inicial para embeddings.

## Conexiones y variables
- Variables clave: `DATABASE_URL`, `POSTGRES_URL`, `NEON_DATABASE_URL`.
- En Vercel, las URLs de Postgres se administran como env vars por ambiente.

## Estructura principal (tablas)
- `brands`: marcas con metadatos, contacto y columnas de calificacion/import.
- `stores`: tiendas fisicas/digitales asociadas a una marca.
- `products`: catalogo unificado (categoria, tags, fuente, metadata).
- `variants`: variantes por producto (color, talla, precio, stock, imagenes).
- `price_history`: historico de precios por variante.
- `stock_history`: historico de stock por variante.
- `assets`: medios asociados a brand/product/variant/store/user.
- `taxonomy_tags`: taxonomias normalizadas (tipo, valor, sinonimos).
- `users`: usuarios y admins (rol, plan, password hash, sesiones).
- `events`: eventos de comportamiento y tracking (click, view, save, etc).
- `experience_subjects`: sujeto de experiencia anónimo (cookie persistente) para entrenamiento.
- `experience_events`: eventos de UI/experiencia ligados a `experience_subjects` y opcionalmente a `users`.
- `user_identities`: identidades externas (Descope: Google/Apple/Facebook).
- `user_favorites`: favoritos por usuario.
- `user_lists` y `user_list_items`: listas de productos (privadas/públicas).
- `user_audit_events`: auditoría de cambios de perfil/listas.
- `announcements`: anuncios y placements (slot, budget, fechas).

## Manejo de usuarios y admin (DB-first)
- El login admin usa `ADMIN_EMAIL` y `ADMIN_PASSWORD` como credenciales validas.
- Al autenticar, el sistema asegura el usuario admin en DB y actualiza `passwordHash` si cambia.
- La sesion se guarda en DB en `users.sessionTokenHash` + `sessionTokenCreatedAt`.
- El navegador guarda un cookie HttpOnly `admin_session` con el token en claro; el backend lo hashea y lo valida contra DB.
- `ADMIN_TOKEN` es un bypass opcional (Bearer) para endpoints internos, pero no reemplaza la sesion web.
- Usuarios externos se autentican via Descope (Google/Apple/Facebook) y se sincronizan por `users.descopeUserId`.
- La experiencia de usuario se registra en `experience_events` con cookie persistente `oda_anon_id` (tabla `experience_subjects`).
- Si el usuario se borra, se elimina su registro y relaciones (`user_*`), pero se conservan los eventos de experiencia (se desvinculan de `userId`).

## Scripts utiles
- `apps/web/scripts/seed-users.mjs`: crea/actualiza admin en DB con `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- `apps/web/scripts/import-brands.mjs`: importa marcas desde Excel a `brands`.

## Notas
- El manejo de usuarios es persistente en DB (no memoria). Reinicios de runtime no invalidan sesiones salvo rotacion de tokens.
- Cambios de `ADMIN_EMAIL`/`ADMIN_PASSWORD` requieren redeploy para que el backend use las nuevas env vars.
