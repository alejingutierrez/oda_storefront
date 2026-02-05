"use client";

import { AuthProvider } from "@descope/nextjs-sdk";
import ExperienceTracker from "./ExperienceTracker";

export default function Providers({ children }: { children: React.ReactNode }) {
  const isProd = process.env.NODE_ENV === "production";

  return (
    <AuthProvider
      projectId={process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID!}
      baseUrl={process.env.NEXT_PUBLIC_DESCOPE_BASE_URL}
      persistTokens
      autoRefresh
      sessionTokenViaCookie={{ sameSite: "Lax", secure: isProd }}
      refreshTokenViaCookie={{ sameSite: "Lax", secure: isProd }}
    >
      <ExperienceTracker />
      {children}
    </AuthProvider>
  );
}
