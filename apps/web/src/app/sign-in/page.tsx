"use client";

import { useRouter } from "next/navigation";
import { Descope } from "@descope/nextjs-sdk";
import { useDescope } from "@descope/nextjs-sdk/client";

export default function SignInPage() {
  const router = useRouter();
  const sdk = useDescope();

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <div className="oda-container flex min-h-screen flex-col items-center justify-center gap-8 py-16">
        <div className="max-w-lg text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--oda-taupe)]">
            Bienvenido a ODA
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-[color:var(--oda-ink)]">
            Ingresa para guardar favoritos y listas
          </h1>
          <p className="mt-3 text-sm text-[color:var(--oda-ink-soft)]">
            Accede con Google, Apple o Facebook usando Descope.
          </p>
        </div>
        <div className="w-full max-w-md rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_30px_80px_rgba(23,21,19,0.12)]">
          <Descope
            flowId="sign-up-or-in"
            theme="light"
            onSuccess={async () => {
              try {
                await sdk.refresh();
              } catch (error) {
                console.error("Failed to refresh Descope session", error);
              }
              await fetch("/api/user/sync", { method: "POST" });
              router.push("/perfil");
            }}
            onError={(error) => {
              console.error("Descope login error", error);
            }}
          />
        </div>
      </div>
    </main>
  );
}
