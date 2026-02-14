"use client";

import { AuthProvider } from "@descope/nextjs-sdk";
import ExperienceTracker from "./ExperienceTracker";
import FavoritesProvider from "@/components/FavoritesProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  const isProd = process.env.NODE_ENV === "production";

  return (
    <AuthProvider
      projectId={process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID!}
      baseUrl={process.env.NEXT_PUBLIC_DESCOPE_BASE_URL}
      persistTokens
      autoRefresh
      // El session JWT puede crecer (claims/roles) y romper el set-cookie por tamaño.
      // Persistimos session token en storage y guardamos refresh en cookie para que el middleware
      // pueda validar navegacion a rutas privadas (p.ej. `/perfil`) sin depender del session cookie.
      refreshTokenViaCookie={{ sameSite: "Lax", secure: isProd }}
    >
      <FavoritesProvider>
        <ExperienceTracker />
        {children}
      </FavoritesProvider>
    </AuthProvider>
  );
}
