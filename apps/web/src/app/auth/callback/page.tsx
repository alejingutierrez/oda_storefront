"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSessionToken, useDescope, useSession, useUser } from "@descope/nextjs-sdk/client";

const normalizeNext = (value?: string | null) => {
  if (!value) return "/perfil";
  if (!value.startsWith("/") || value.startsWith("//")) return "/perfil";
  if (value.startsWith("/auth/callback")) return "/perfil";
  return value;
};

const LOGIN_NEXT_KEY = "oda_login_next_v1";

export default function AuthCallbackPage() {
  const router = useRouter();
  const sdk = useDescope();
  const { isAuthenticated, isSessionLoading } = useSession();
  const { user, isUserLoading } = useUser();
  const [next] = useState(() => {
    if (typeof window === "undefined") return "/perfil";
    const params = new URLSearchParams(window.location.search);
    if (params.has("next")) {
      return normalizeNext(params.get("next"));
    }
    try {
      const stored = window.sessionStorage.getItem(LOGIN_NEXT_KEY);
      if (stored) {
        window.sessionStorage.removeItem(LOGIN_NEXT_KEY);
        return normalizeNext(stored);
      }
    } catch {
      // ignore
    }
    return "/perfil";
  });
  const [message, setMessage] = useState("Procesando inicio de sesion…");
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);

  const readSessionToken = useMemo(() => {
    return () => {
      const token = getSessionToken();
      if (typeof token !== "string") return null;
      const clean = token.trim();
      return clean.length > 0 ? clean : null;
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    if (isSessionLoading || isUserLoading) return;
    // Justo después del redirect de OAuth, Descope puede tardar un instante en poblar isAuthenticated/sessionToken.
    // Evitamos un redirect prematuro a /sign-in para no causar loops.
    if (!isAuthenticated) {
      const token = readSessionToken();
      if (!token) {
        const timeout = window.setTimeout(() => {
          const qs = new URLSearchParams({ next, error: "not_authenticated" });
          router.replace(`/sign-in?${qs.toString()}`);
        }, 1200);
        return () => window.clearTimeout(timeout);
      }
    }

    startedRef.current = true;

    let cancelled = false;

    const run = async () => {
      const MAX_ATTEMPTS = 8;
      for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
        if (cancelled) return;
        setAttempt(i);
        try {
          const token = readSessionToken();
          const headers: Record<string, string> = { "content-type": "application/json" };
          if (token) {
            headers.Authorization = `Bearer ${token}`;
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
            // 401 puede ocurrir si el token aun no esta disponible justo despues del redirect.
            // Solo hacemos logout si ya teniamos token y aun asi falla varias veces.
            const UNAUTHORIZED_GRACE = 4;
            if (!token && i < MAX_ATTEMPTS) {
              console.warn("Auth callback unauthorized (missing token); will retry", {
                attempt: i,
              });
            } else if (i < UNAUTHORIZED_GRACE) {
              console.warn("Auth callback unauthorized; will retry", {
                attempt: i,
                hasSessionToken: Boolean(token),
              });
            } else {
              console.error("Auth callback unauthorized; clearing Descope session", {
                attempt: i,
                hasSessionToken: Boolean(token),
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
    isAuthenticated,
    isSessionLoading,
    isUserLoading,
    readSessionToken,
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
