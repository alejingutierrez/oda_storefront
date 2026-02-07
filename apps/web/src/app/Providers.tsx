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
      sessionTokenViaCookie={{ sameSite: "Lax", secure: isProd }}
    >
      <FavoritesProvider>
        <ExperienceTracker />
        {children}
      </FavoritesProvider>
    </AuthProvider>
  );
}
