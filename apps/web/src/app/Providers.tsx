"use client";

import { AuthProvider } from "@descope/nextjs-sdk";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider
      projectId={process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID!}
      baseUrl={process.env.NEXT_PUBLIC_DESCOPE_BASE_URL}
    >
      {children}
    </AuthProvider>
  );
}
