"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Descope } from "@descope/nextjs-sdk";
import { useDescope } from "@descope/nextjs-sdk/client";

export default function SignInPage() {
  const router = useRouter();
  const sdk = useDescope();
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || params.get("returnTo");
    if (next) {
      setReturnTo(next);
      return;
    }
    const referrer = document.referrer;
    if (!referrer) return;
    try {
      const refUrl = new URL(referrer);
      if (refUrl.origin === window.location.origin && refUrl.pathname !== "/sign-in") {
        setReturnTo(`${refUrl.pathname}${refUrl.search}${refUrl.hash}`);
      }
    } catch (error) {
      console.error("Unable to parse referrer for return", error);
    }
  }, []);

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
            onSuccess={async (event) => {
              try {
                await sdk.refresh();
                await sdk.me();
              } catch (error) {
                console.error("Failed to refresh Descope session", error);
              }
              let sessionToken: string | null = null;
              try {
                const sdkAny = sdk as unknown as {
                  getSessionToken?: () => Promise<string>;
                  getSessionTokenSync?: () => string;
                };
                if (typeof sdkAny.getSessionToken === "function") {
                  sessionToken = await sdkAny.getSessionToken();
                } else if (typeof sdkAny.getSessionTokenSync === "function") {
                  sessionToken = sdkAny.getSessionTokenSync();
                }
              } catch (error) {
                console.error("Failed to read Descope session token", error);
              }
              const descopeUser =
                typeof event?.detail?.user === "object" ? event.detail.user : null;
              const headers: Record<string, string> = {
                "content-type": "application/json",
              };
              if (sessionToken) {
                headers.authorization = `Bearer ${sessionToken}`;
              }
              await fetch("/api/user/sync", {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ user: descopeUser }),
              });
              router.push(returnTo ?? "/perfil");
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
