import { NextResponse } from "next/server";
import { syncUserFromDescope } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";

export const dynamic = "force-dynamic";

const normalizeNext = (value?: string | null) => {
  if (!value) return "/perfil";
  if (!value.startsWith("/") || value.startsWith("//")) return "/perfil";
  if (value.startsWith("/auth/callback")) return "/perfil";
  return value;
};

const getRequestId = (req: Request) =>
  req.headers.get("x-vercel-id") ??
  req.headers.get("x-request-id") ??
  req.headers.get("x-amzn-trace-id") ??
  undefined;

const getCookieNames = (req: Request) => {
  const raw = req.headers.get("cookie") ?? "";
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => entry.split("=")[0]?.trim())
    .filter(Boolean)
    .slice(0, 50);
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const next = normalizeNext(searchParams.get("next"));

  let synced: Awaited<ReturnType<typeof syncUserFromDescope>> | null = null;
  try {
    synced = await syncUserFromDescope();
  } catch (error) {
    console.error("Auth callback failed to read/sync Descope session", {
      requestId: getRequestId(req),
      next,
      cookieNames: getCookieNames(req),
      hasAuthorizationHeader: Boolean(req.headers.get("authorization")),
      error,
    });
  }

  if (!synced) {
    console.warn("Auth callback missing/invalid Descope session", {
      requestId: getRequestId(req),
      next,
      cookieNames: getCookieNames(req),
      hasAuthorizationHeader: Boolean(req.headers.get("authorization")),
    });

    const params = new URLSearchParams({ next });
    return NextResponse.redirect(new URL(`/sign-in?${params.toString()}`, req.url));
  }

  try {
    await logExperienceEvent({
      type: "auth_login",
      userId: synced.user.id,
      subjectId: synced.subject.id,
      properties: {
        providerCount: Object.keys(synced.descopeUser.OAuth ?? {}).length,
      },
    });
  } catch (error) {
    // No bloqueamos el login por falla de analytics.
    console.error("Auth callback failed to persist auth_login event", {
      requestId: getRequestId(req),
      userId: synced.user.id,
      error,
    });
  }

  return NextResponse.redirect(new URL(next, req.url));
}

