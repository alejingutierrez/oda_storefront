This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Auth (Descope)

Variables requeridas en `.env` (local/Vercel):

- `NEXT_PUBLIC_DESCOPE_PROJECT_ID`
- `NEXT_PUBLIC_DESCOPE_BASE_URL`
- `DESCOPE_MANAGEMENT_KEY`
- `NEXT_PUBLIC_DESCOPE_SIGNIN_FLOW_ID`
- `NEXT_PUBLIC_DESCOPE_LINK_FLOW_ID`

Flujo:

- `/sign-in` renderiza el flow de Descope.
- Al completar login redirige a `/auth/callback?next=...`, que hace el sync del usuario en Neon y luego devuelve al `next`.
- Si Descope regresa con `?code=...`, la UI espera bootstrap de sesión y recupera token/sesión en polling corto (sin `oauth.exchange` manual); `E061301` se maneja como carrera recuperable (sin error visible ni botón de reintento) con redirect automático a `/auth/callback` o limpieza de URL.

## Descope Approved Domains

Configurar hosts aprobados en Descope (Project Settings) dentro de `trustedDomains` **sin protocolo** (`https://`) y separados por coma.

Hosts requeridos:

- `oda-moda.vercel.app`
- `oda-storefront-6ee5-alejingutierrezs-projects.vercel.app`
- `oda-storefront-6ee5-git-main-alejingutierrezs-projects.vercel.app`
- `localhost`
- `127.0.0.1`

Regla operativa:

- Para QA de auth en preview, usar el alias estable `oda-storefront-6ee5-git-main-alejingutierrezs-projects.vercel.app` y evitar URLs efímeras.

Checklist antes de probar login en un host nuevo:

1. Agregar el host exacto en `trustedDomains`.
2. Guardar configuración en Descope.
3. Reintentar `/sign-in` y validar que no aparezca `E108202`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
