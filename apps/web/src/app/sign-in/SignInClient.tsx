"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Descope as DescopeBase } from "@descope/nextjs-sdk";
import { useDescope, useSession } from "@descope/nextjs-sdk/client";

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
  const sdk = useDescope();
  const { isAuthenticated, isSessionLoading } = useSession();
  const callbackError = searchParams.get("error")?.trim() || null;
  const oauthErr = searchParams.get("err")?.trim() || null;
  const oauthCode = searchParams.get("code")?.trim() || null;
  // Tipado local: `@descope/nextjs-sdk` no expone consistentemente `flowId` en sus types.
  // No queremos bloquear el build por un gap de tipos en el SDK.
  const DescopeFlow = DescopeBase as unknown as ComponentType<{
    flowId: string;
    theme?: string;
    debug?: boolean;
    redirectUrl?: string;
    redirectAfterSuccess?: string;
    redirectAfterError?: string;
    onSuccess?: (...args: unknown[]) => void | Promise<void>;
    onError?: (...args: unknown[]) => void;
  }>;
  const [returnTo] = useState<string | null>(() => computeReturnTo());
  const [redirectUrl] = useState<string | undefined>(() => {
    // Descope abre ciertos redirects (OAuth) en popup cuando no tiene un `redirect-url`.
    // Forzamos un redirect de vuelta a `/sign-in` para evitar popups bloqueados y hacer el flujo confiable.
    if (typeof window === "undefined") return undefined;
    return `${window.location.origin}/sign-in`;
  });
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
  const [oauthExchangeMessage, setOauthExchangeMessage] = useState<string | null>(null);
  const oauthExchangeStartedRef = useRef(false);
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
    if (oauthErr) return;
    if (oauthCode) return;
    if (isSessionLoading) return;
    if (!isAuthenticated) return;
    // Si el usuario ya esta autenticado, no mostramos el flow (puede causar estados raros en Descope);
    // forzamos el callback para sincronizar en Neon y devolver al `next`.
    router.replace(redirectAfterSuccess);
  }, [
    callbackError,
    oauthCode,
    oauthErr,
    isAuthenticated,
    isSessionLoading,
    redirectAfterSuccess,
    router,
  ]);

  const oauthUiMessage = useMemo(() => {
    if (callbackError) return "No pudimos confirmar tu sesión. Intenta de nuevo.";
    if (!oauthErr) return null;
    const decoded = decodeURIComponent(oauthErr);
    if (decoded.includes("E062209")) {
      return "Google no pudo completar el login (configuración OAuth). Intenta de nuevo o avísanos para revisar la configuración.";
    }
    return "No pudimos completar el login con Google. Intenta de nuevo.";
  }, [callbackError, oauthErr]);

  useEffect(() => {
    if (!oauthCode) return;
    if (oauthExchangeStartedRef.current) return;
    oauthExchangeStartedRef.current = true;

    let cancelled = false;

    const run = async () => {
      setFlowError(null);
      setOauthExchangeMessage("Confirmando sesión…");
      try {
        const response = await sdk.oauth.exchange(oauthCode);
        if (cancelled) return;

        if (response?.ok) {
          router.replace(redirectAfterSuccess);
          return;
        }

        const errorCode =
          typeof response?.error?.errorCode === "string" ? response.error.errorCode : null;
        const errorDescription =
          typeof response?.error?.errorDescription === "string"
            ? response.error.errorDescription
            : null;

        console.error("Descope OAuth exchange failed", {
          code: response?.code,
          errorCode,
          errorDescription,
        });

        if (errorCode === "E061301") {
          setFlowError("El intento de login expiró. Intenta de nuevo.");
        } else {
          setFlowError("No pudimos confirmar tu sesión. Intenta de nuevo.");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Descope OAuth exchange crashed", error);
        setFlowError("No pudimos confirmar tu sesión. Intenta de nuevo.");
      } finally {
        if (!cancelled) setOauthExchangeMessage(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [oauthCode, redirectAfterSuccess, router, sdk.oauth]);

  const resetToCleanSignIn = () => {
    const qs = new URLSearchParams();
    if (returnTo) qs.set("next", returnTo);
    router.replace(qs.size ? `/sign-in?${qs.toString()}` : "/sign-in");
  };

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <div className="oda-container flex min-h-screen flex-col items-center justify-center gap-8 py-16">
        <div className="w-full max-w-md">
          {flowError || callbackError || oauthUiMessage ? (
            <p className="mb-4 rounded-2xl border border-[color:var(--oda-border)] bg-white/70 px-4 py-3 text-sm text-[color:var(--oda-ink)]">
              {flowError ?? oauthUiMessage ?? "No pudimos confirmar tu sesión. Intenta de nuevo."}
            </p>
          ) : null}
          <div className="w-full rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_30px_80px_rgba(23,21,19,0.12)]">
            {oauthCode ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {oauthExchangeMessage ?? "Confirmando sesión…"}
                </p>
                {flowError ? (
                  <button
                    type="button"
                    onClick={resetToCleanSignIn}
                    className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--oda-ink)]"
                  >
                    Reintentar
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <DescopeFlow
                  flowId={flowId}
                  theme="light"
                  debug={debugFlow}
                  redirectUrl={redirectUrl}
                  redirectAfterSuccess={redirectAfterSuccess}
                  onSuccess={() => {
                    setFlowError(null);
                    // Evitamos forzar navegacion: el flow ya tiene `redirectAfterSuccess` y, si el SDK
                    // marca la sesion como autenticada, el effect de arriba redirige a `/auth/callback`.
                  }}
                  onError={(error: unknown) => {
                    console.error("Descope login error", error);
                    setFlowError("No pudimos cargar el login. Reintenta en unos segundos.");
                  }}
                />
                {oauthUiMessage ? (
                  <div className="mt-4 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={resetToCleanSignIn}
                      className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--oda-ink)]"
                    >
                      Reintentar
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
