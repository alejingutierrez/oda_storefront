"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDescope } from "@descope/nextjs-sdk/client";

const normalizeNext = (value?: string | null) => {
  if (!value) return "/perfil";
  if (!value.startsWith("/") || value.startsWith("//")) return "/perfil";
  if (value.startsWith("/auth/callback")) return "/perfil";
  return value;
};

export default function AuthCallbackPage() {
  const router = useRouter();
  const sdk = useDescope();
  const [next] = useState(() => {
    if (typeof window === "undefined") return "/perfil";
    const params = new URLSearchParams(window.location.search);
    return normalizeNext(params.get("next"));
  });
  const [message, setMessage] = useState("Procesando inicio de sesion…");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const MAX_ATTEMPTS = 8;
      for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
        if (cancelled) return;
        setAttempt(i);
        try {
          const res = await fetch("/api/user/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({}),
          });

          if (cancelled) return;

          if (res.ok) {
            router.replace(next);
            return;
          }

          if (res.status === 401) {
            // Si el cliente cree estar autenticado pero el servidor no valida la sesion,
            // limpiamos la sesion del cliente para evitar loops.
            console.error("Auth callback unauthorized; clearing Descope session", {
              attempt: i,
            });
            try {
              await sdk.logout();
            } catch (error) {
              console.error("Auth callback failed to logout Descope session", error);
            }
            const qs = new URLSearchParams({ next, error: "unauthorized" });
            router.replace(`/sign-in?${qs.toString()}`);
            return;
          }

          const body = await res.text();
          console.error("Auth callback user sync failed", {
            attempt: i,
            status: res.status,
            body: body.slice(0, 2000),
          });
        } catch (error) {
          console.error("Auth callback user sync error", { attempt: i, error });
        }

        if (cancelled) return;
        setMessage("Confirmando sesion…");
        await new Promise((resolve) => setTimeout(resolve, 250 * i));
      }

      if (cancelled) return;
      setMessage("No se pudo completar el login.");
      const qs = new URLSearchParams({ next, error: "sync_failed" });
      router.replace(`/sign-in?${qs.toString()}`);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [router, next, sdk]);

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <div className="oda-container flex min-h-screen flex-col items-center justify-center gap-6 py-16 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--oda-taupe)]">
          ODA
        </p>
        <h1 className="text-2xl font-semibold text-[color:var(--oda-ink)]">
          {message}
        </h1>
        {attempt > 0 ? (
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Intento {attempt} de 8
          </p>
        ) : null}
        <p className="max-w-md text-sm text-[color:var(--oda-ink-soft)]">
          Si esto tarda mas de unos segundos, regresa e intenta de nuevo.
        </p>
      </div>
    </main>
  );
}
