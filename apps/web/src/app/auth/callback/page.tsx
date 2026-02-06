"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDescope, useSession, useUser } from "@descope/nextjs-sdk/client";

const normalizeNext = (value?: string | null) => {
  if (!value) return "/perfil";
  if (!value.startsWith("/") || value.startsWith("//")) return "/perfil";
  if (value.startsWith("/auth/callback")) return "/perfil";
  return value;
};

export default function AuthCallbackPage() {
  const router = useRouter();
  const sdk = useDescope();
  const { isAuthenticated, isSessionLoading, sessionToken } = useSession();
  const { user, isUserLoading } = useUser();
  const [next] = useState(() => {
    if (typeof window === "undefined") return "/perfil";
    const params = new URLSearchParams(window.location.search);
    return normalizeNext(params.get("next"));
  });
  const [message, setMessage] = useState("Procesando inicio de sesion…");
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);

  const authHeaders = useMemo(() => {
    if (!sessionToken || typeof sessionToken !== "string") return null;
    return { Authorization: `Bearer ${sessionToken}` } as const;
  }, [sessionToken]);

  useEffect(() => {
    if (startedRef.current) return;
    if (isSessionLoading || isUserLoading) return;
    if (!isAuthenticated) {
      const qs = new URLSearchParams({ next, error: "not_authenticated" });
      router.replace(`/sign-in?${qs.toString()}`);
      return;
    }
    startedRef.current = true;

    let cancelled = false;

    const run = async () => {
      const MAX_ATTEMPTS = 8;
      for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
        if (cancelled) return;
        setAttempt(i);
        try {
          const headers: Record<string, string> = { "content-type": "application/json" };
          if (authHeaders) {
            headers.Authorization = authHeaders.Authorization;
          }
          const res = await fetch("/api/user/sync", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ user: user ?? null }),
          });

          if (cancelled) return;

          if (res.ok) {
            router.replace(next);
            return;
          }

          if (res.status === 401) {
            // 401 puede ocurrir si el cookie de sesion aun no esta listo justo despues del redirect.
            // Reintentamos un par de veces antes de limpiar sesion para evitar loops falsos.
            const UNAUTHORIZED_GRACE = 3;
            if (i < UNAUTHORIZED_GRACE) {
              console.warn("Auth callback unauthorized; will retry", {
                attempt: i,
                hasSessionToken: Boolean(authHeaders),
              });
            } else {
              console.error("Auth callback unauthorized; clearing Descope session", {
                attempt: i,
                hasSessionToken: Boolean(authHeaders),
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
          } else {
            const body = await res.text();
            console.error("Auth callback user sync failed", {
              attempt: i,
              status: res.status,
              body: body.slice(0, 2000),
            });
          }
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
  }, [
    router,
    next,
    sdk,
    user,
    authHeaders,
    isAuthenticated,
    isSessionLoading,
    isUserLoading,
  ]);

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
