"use client";

import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Descope as DescopeBase } from "@descope/nextjs-sdk";
import { getSessionToken, useDescope, useSession } from "@descope/nextjs-sdk/client";
import { sanitizeAuthReturnPath } from "@/lib/auth-return";

const LOGIN_NEXT_KEY = "oda_login_next_v1";

type ParsedDescopeError = {
  errorCode: string | null;
  errorDescription: string | null;
  message: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (source: Record<string, unknown> | null, key: string) => {
  if (!source) return null;
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const extractDescopeErrorCode = (value: string | null) => {
  if (!value) return null;
  const decoded = safeDecode(value);
  const match = decoded.match(/\bE\d{6}\b/i);
  return match ? match[0].toUpperCase() : null;
};

const parseDescopeError = (error: unknown): ParsedDescopeError => {
  const base = isRecord(error) ? error : null;
  const detail = isRecord(base?.detail) ? (base.detail as Record<string, unknown>) : base;
  const nestedError = isRecord(detail?.error) ? (detail.error as Record<string, unknown>) : null;
  return {
    errorCode:
      readString(detail, "errorCode") ??
      readString(nestedError, "errorCode") ??
      readString(detail, "code") ??
      null,
    errorDescription:
      readString(detail, "errorDescription") ??
      readString(nestedError, "errorDescription") ??
      readString(detail, "description") ??
      null,
    message:
      readString(detail, "message") ??
      readString(nestedError, "message") ??
      (error instanceof Error ? error.message : null),
  };
};

const domainNotApprovedMessage = (hostname: string | null) => {
  const hostInfo = hostname ? ` Dominio actual: ${hostname}.` : "";
  return `Este dominio no está autorizado para login en Descope.${hostInfo} Avísanos para habilitarlo.`;
};

const buildDescopeUiMessage = ({
  errorCode,
  fallback,
  hostname,
}: {
  errorCode: string | null;
  fallback: string;
  hostname: string | null;
}) => {
  if (errorCode === "E108202") return domainNotApprovedMessage(hostname);
  if (errorCode === "E062209") {
    return "Google no pudo completar el login (configuración OAuth). Intenta de nuevo o avísanos para revisar la configuración.";
  }
  if (errorCode === "E061301") {
    return null;
  }
  return fallback;
};

const computeReturnTo = () => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("next") || params.get("returnTo");
  const normalized = sanitizeAuthReturnPath(candidate);
  if (normalized) return normalized;

  const stored = sanitizeAuthReturnPath(window.sessionStorage.getItem("oda_last_path"));
  if (stored) return stored;

  const referrer = document.referrer;
  if (!referrer) return null;
  try {
    const refUrl = new URL(referrer);
    if (refUrl.origin === window.location.origin) {
      return sanitizeAuthReturnPath(`${refUrl.pathname}${refUrl.search}${refUrl.hash}`);
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
  const { isAuthenticated, isSessionLoading, sessionToken } = useSession();
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
  const [oauthBootstrapExpired, setOauthBootstrapExpired] = useState(false);
  const lastHandledCodeRef = useRef<string | null>(null);
  const redirectAfterSuccess = "/auth/callback";

  const readSessionToken = useMemo(() => {
    return () => {
      const sdkToken = getSessionToken();
      if (typeof sdkToken === "string" && sdkToken.trim().length > 0) return sdkToken.trim();
      if (typeof sessionToken === "string" && sessionToken.trim().length > 0) return sessionToken.trim();
      return null;
    };
  }, [sessionToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (returnTo) {
        window.sessionStorage.setItem(LOGIN_NEXT_KEY, returnTo);
      } else {
        window.sessionStorage.removeItem(LOGIN_NEXT_KEY);
      }
    } catch {
      // ignore
    }
  }, [returnTo]);

  useEffect(() => {
    if (isSessionLoading) return;
    const token = readSessionToken();
    if (!isAuthenticated && !token) return;
    // Si el usuario ya esta autenticado, no mostramos el flow (puede causar estados raros en Descope);
    // forzamos el callback para sincronizar en Neon y devolver al `next`.
    router.replace(redirectAfterSuccess);
  }, [
    isAuthenticated,
    isSessionLoading,
    readSessionToken,
    redirectAfterSuccess,
    router,
  ]);

  useEffect(() => {
    if (!oauthCode) {
      setOauthBootstrapExpired(false);
      lastHandledCodeRef.current = null;
      return;
    }
    if (!isSessionLoading) {
      setOauthBootstrapExpired(false);
      return;
    }

    const timeoutMs = 2500;
    const timer = window.setTimeout(() => {
      setOauthBootstrapExpired(true);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [oauthCode, isSessionLoading]);

  const oauthUiMessage = useMemo(() => {
    if (callbackError) return "No pudimos confirmar tu sesión. Intenta de nuevo.";
    if (!oauthErr) return null;
    const errorCode = extractDescopeErrorCode(oauthErr);
    const hostname = typeof window !== "undefined" ? window.location.hostname : null;
    return buildDescopeUiMessage({
      errorCode,
      hostname,
      fallback: "No pudimos completar el login con Google. Intenta de nuevo.",
    });
  }, [callbackError, oauthErr]);

  const resetToCleanSignIn = useCallback(() => {
    const qs = new URLSearchParams();
    const cleanNext = sanitizeAuthReturnPath(returnTo);
    if (cleanNext) qs.set("next", cleanNext);
    router.replace(qs.size ? `/sign-in?${qs.toString()}` : "/sign-in");
  }, [returnTo, router]);

  useEffect(() => {
    if (!oauthCode) return;
    if (isSessionLoading && !oauthBootstrapExpired) {
      setFlowError(null);
      setOauthExchangeMessage("Confirmando sesión…");
      return;
    }
    if (lastHandledCodeRef.current === oauthCode) return;
    lastHandledCodeRef.current = oauthCode;

    let cancelled = false;
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const run = async () => {
      setFlowError(null);
      setOauthExchangeMessage("Confirmando sesión…");
      const hostname = typeof window !== "undefined" ? window.location.hostname : null;
      const pollForSession = async (attempts: number, delayMs: number) => {
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          if (cancelled) return false;
          const token = readSessionToken();
          if (token) return true;
          await delay(delayMs);
        }
        return false;
      };
      try {
        const preExistingToken = readSessionToken();
        if (preExistingToken) {
          router.replace(redirectAfterSuccess);
          return;
        }

        const response = await sdk.oauth.exchange(oauthCode);
        if (cancelled) return;

        if (response?.ok) {
          router.replace(redirectAfterSuccess);
          return;
        }

        const errorCode =
          typeof response?.error?.errorCode === "string"
            ? response.error.errorCode.trim().toUpperCase()
            : null;
        const errorDescription =
          typeof response?.error?.errorDescription === "string"
            ? response.error.errorDescription
            : null;

        if (errorCode === "E061301") {
          if (debugFlow) {
            console.debug("Descope OAuth exchange recoverable race", {
              code: response?.code,
              errorCode,
              errorDescription,
            });
          }
          const recovered = await pollForSession(8, 200);
          if (recovered) {
            router.replace(redirectAfterSuccess);
            return;
          }
          resetToCleanSignIn();
          return;
        }

        console.error("Descope OAuth exchange failed", {
          hostname,
          flowId,
          projectId: process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID,
          code: response?.code,
          errorCode,
          errorDescription,
        });

        setFlowError(
          buildDescopeUiMessage({
            errorCode,
            hostname,
            fallback: "No pudimos confirmar tu sesión. Intenta de nuevo.",
          }),
        );
      } catch (error) {
        if (cancelled) return;
        const parsed = parseDescopeError(error);
        if (parsed.errorCode?.toUpperCase() === "E061301") {
          if (debugFlow) {
            console.debug("Descope OAuth exchange crashed with recoverable race", {
              errorCode: parsed.errorCode,
              errorDescription: parsed.errorDescription,
              message: parsed.message,
            });
          }
          const recovered = await pollForSession(8, 200);
          if (recovered) {
            router.replace(redirectAfterSuccess);
            return;
          }
          resetToCleanSignIn();
          return;
        }

        console.error("Descope OAuth exchange crashed", {
          hostname,
          flowId,
          projectId: process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID,
          errorCode: parsed.errorCode,
          errorDescription: parsed.errorDescription,
          message: parsed.message,
          error,
        });
        setFlowError("No pudimos confirmar tu sesión. Intenta de nuevo.");
      } finally {
        if (!cancelled) setOauthExchangeMessage(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    debugFlow,
    isSessionLoading,
    oauthBootstrapExpired,
    oauthCode,
    readSessionToken,
    resetToCleanSignIn,
    redirectAfterSuccess,
    router,
    sdk.oauth,
    flowId,
  ]);

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
                    const parsed = parseDescopeError(error);
                    const hostname = typeof window !== "undefined" ? window.location.hostname : null;
                    if (parsed.errorCode !== "E061301") {
                      console.error("Descope login error", {
                        hostname,
                        flowId,
                        projectId: process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID,
                        errorCode: parsed.errorCode,
                        errorDescription: parsed.errorDescription,
                        message: parsed.message,
                        error,
                      });
                    }
                    setFlowError(
                      buildDescopeUiMessage({
                        errorCode: parsed.errorCode,
                        hostname,
                        fallback: "No pudimos cargar el login. Reintenta en unos segundos.",
                      }),
                    );
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
