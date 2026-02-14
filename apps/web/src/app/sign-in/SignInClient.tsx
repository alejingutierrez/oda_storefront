"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@descope/nextjs-sdk/client";

const LOGIN_NEXT_KEY = "oda_login_next_v1";

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

export default function SignInClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isSessionLoading } = useSession();
  const callbackError = searchParams.get("error")?.trim() || null;
  // @descope/nextjs-sdk types do not expose flowId (aunque el componente sí lo soporta).
  // Lo tipamos localmente para mantener build TS verde.
  const DescopeFlow = dynamic<{
    flowId: string;
    theme?: string;
    debug?: boolean;
    redirectAfterSuccess?: string;
    redirectAfterError?: string;
    onSuccess?: (...args: unknown[]) => void | Promise<void>;
    onError?: (...args: unknown[]) => void;
  }>(
    () =>
      import("@descope/nextjs-sdk").then(
        (mod) =>
          mod.Descope as unknown as ComponentType<{
            flowId: string;
            theme?: string;
            debug?: boolean;
            redirectAfterSuccess?: string;
            redirectAfterError?: string;
            onSuccess?: (...args: unknown[]) => void | Promise<void>;
            onError?: (...args: unknown[]) => void;
          }>,
      ),
    {
      ssr: false,
      loading: () => (
        <div className="flex min-h-[360px] items-center justify-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Cargando login…
          </p>
        </div>
      ),
    },
  );
  const [returnTo] = useState<string | null>(() => computeReturnTo());
  const [flowOverride] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const flow = new URLSearchParams(window.location.search).get("flow");
    return flow?.trim() || null;
  });
  const [debugFlow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("debug") === "true";
  });
  const flowId = flowOverride || process.env.NEXT_PUBLIC_DESCOPE_SIGNIN_FLOW_ID || "sign-up-or-in";
  const [flowError, setFlowError] = useState<string | null>(null);
  const redirectAfterSuccess = "/auth/callback";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!returnTo) return;
    try {
      window.sessionStorage.setItem(LOGIN_NEXT_KEY, returnTo);
    } catch {
      // ignore
    }
  }, [returnTo]);

  useEffect(() => {
    if (callbackError) return;
    if (isSessionLoading) return;
    if (!isAuthenticated) return;
    // Si el usuario ya esta autenticado, no mostramos el flow (puede causar estados raros en Descope);
    // forzamos el callback para sincronizar en Neon y devolver al `next`.
    router.replace(redirectAfterSuccess);
  }, [callbackError, isAuthenticated, isSessionLoading, redirectAfterSuccess, router]);

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <div className="oda-container flex min-h-screen flex-col items-center justify-center gap-8 py-16">
        <div className="w-full max-w-md">
          {flowError || callbackError ? (
            <p className="mb-4 rounded-2xl border border-[color:var(--oda-border)] bg-white/70 px-4 py-3 text-sm text-[color:var(--oda-ink)]">
              {flowError ?? "No pudimos confirmar tu sesión. Intenta de nuevo."}
            </p>
          ) : null}
          <div className="w-full rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_30px_80px_rgba(23,21,19,0.12)]">
            <DescopeFlow
              flowId={flowId}
              theme="light"
              debug={debugFlow}
              redirectAfterSuccess={redirectAfterSuccess}
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
          </div>
        </div>
      </div>
    </main>
  );
}
