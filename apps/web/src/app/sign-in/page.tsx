"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Descope } from "@descope/nextjs-sdk";
import { useSession } from "@descope/nextjs-sdk/client";

const computeReturnTo = () => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("next") || params.get("returnTo");
  const normalize = (value: string | null) => {
    if (!value) return null;
    if (!value.startsWith("/")) return null;
    if (value.startsWith("//")) return null;
    return value;
  };
  const normalized = normalize(candidate);
  if (normalized) return normalized;

  const stored = normalize(window.sessionStorage.getItem("oda_last_path"));
  if (stored && stored !== "/sign-in") return stored;

  const referrer = document.referrer;
  if (!referrer) return null;
  try {
    const refUrl = new URL(referrer);
    if (refUrl.origin === window.location.origin && refUrl.pathname !== "/sign-in") {
      return `${refUrl.pathname}${refUrl.search}${refUrl.hash}`;
    }
  } catch (error) {
    console.error("Unable to parse referrer for return", error);
  }
  return null;
};

export default function SignInPage() {
  const router = useRouter();
  const { isAuthenticated, isSessionLoading } = useSession();
  // @descope/nextjs-sdk types do not expose flowId (aunque el componente sí lo soporta).
  // Lo tipamos localmente para mantener build TS verde.
  const DescopeFlow = Descope as unknown as ComponentType<{
    flowId: string;
    theme?: string;
    debug?: boolean;
    redirectAfterSuccess?: string;
    redirectAfterError?: string;
    onSuccess?: (...args: unknown[]) => void | Promise<void>;
    onError?: (...args: unknown[]) => void;
  }>;
  const [returnTo] = useState<string | null>(() => computeReturnTo());
  const [mounted, setMounted] = useState(false);
  const [flowOverride] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const flow = new URLSearchParams(window.location.search).get("flow");
    return flow?.trim() || null;
  });
  const [debugFlow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("debug") === "true";
  });
  const flowId =
    flowOverride ||
    process.env.NEXT_PUBLIC_DESCOPE_SIGNIN_FLOW_ID ||
    "sign-up-or-in";
  const [flowError, setFlowError] = useState<string | null>(null);
  const redirectAfterSuccess = useMemo(() => {
    const target = returnTo ?? "/perfil";
    const params = new URLSearchParams();
    params.set("next", target);
    return `/auth/callback?${params.toString()}`;
  }, [returnTo]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const error = new URLSearchParams(window.location.search).get("error")?.trim();
      if (error) return;
    }
    if (isSessionLoading) return;
    if (!isAuthenticated) return;
    // Si el usuario ya esta autenticado, no mostramos el flow (puede causar estados raros en Descope);
    // forzamos el callback para sincronizar en Neon y devolver al `next`.
    router.replace(redirectAfterSuccess);
  }, [isAuthenticated, isSessionLoading, redirectAfterSuccess, router]);

  const callbackError = useMemo(() => {
    if (!mounted) return null;
    return new URLSearchParams(window.location.search).get("error")?.trim() || null;
  }, [mounted]);

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
          {flowError ? (
            <p className="mt-4 text-sm font-medium text-[color:var(--oda-ink)]">
              {flowError}
            </p>
          ) : null}
          {callbackError ? (
            <p className="mt-4 text-sm font-medium text-[color:var(--oda-ink)]">
              No pudimos confirmar tu sesion. Intenta de nuevo.
            </p>
          ) : null}
        </div>
        <div className="w-full max-w-md rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_30px_80px_rgba(23,21,19,0.12)]">
          {mounted ? (
            <DescopeFlow
              flowId={flowId}
              theme="light"
              debug={debugFlow}
              redirectAfterSuccess={redirectAfterSuccess}
              redirectAfterError="/sign-in"
              onSuccess={() => {
                setFlowError(null);
                // Navegacion hard para evitar edge-cases donde el SPA nav no dispare el callback.
                window.location.assign(redirectAfterSuccess);
              }}
              onError={(error) => {
                console.error("Descope login error", error);
                setFlowError("No pudimos cargar el login. Reintenta en unos segundos.");
              }}
            />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center">
              <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                Cargando login…
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
