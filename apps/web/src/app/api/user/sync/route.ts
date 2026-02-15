import { NextResponse } from "next/server";
import { syncUserFromDescope } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";
import { cookies, headers } from "next/headers";

const getRequestId = async () => {
  const headerStore = await headers();
  return (
    headerStore.get("x-vercel-id") ??
    headerStore.get("x-request-id") ??
    headerStore.get("x-amzn-trace-id") ??
    undefined
  );
};

const getCookieNames = async () => {
  const cookieStore = await cookies();
  try {
    return cookieStore
      .getAll()
      .map((cookie) => cookie.name)
      .filter(Boolean)
      .slice(0, 50);
  } catch {
    return [];
  }
};

export async function POST(req: Request) {
  let fallbackUser: Record<string, unknown> | null = null;
  try {
    const body = (await req.json()) as { user?: Record<string, unknown> };
    fallbackUser = body?.user ?? null;
  } catch {
    fallbackUser = null;
  }

  let synced;
  try {
    synced = await syncUserFromDescope(fallbackUser, req);
  } catch (error) {
    console.error("User sync failed", {
      requestId: await getRequestId(),
      cookieNames: await getCookieNames(),
      hasAuthorization: Boolean(req.headers.get("authorization")),
      hasInjectedSessionHeader: Boolean(req.headers.get("x-descope-session")),
      error,
    });
    throw error;
  }
  if (!synced) {
    const authHeader = req.headers.get("authorization");
    const authScheme = authHeader?.split(/\s+/)[0]?.toLowerCase() ?? null;
    const authLength = authHeader ? authHeader.length : 0;
    console.warn("User sync unauthorized", {
      requestId: await getRequestId(),
      cookieNames: await getCookieNames(),
      hasAuthorization: Boolean(authHeader),
      authScheme,
      authLength,
      hasInjectedSessionHeader: Boolean(req.headers.get("x-descope-session")),
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await logExperienceEvent({
    type: "auth_login",
    userId: synced.user.id,
    subjectId: synced.subject.id,
    properties: {
      providerCount: Object.keys(synced.descopeUser.OAuth ?? {}).length,
    },
  });

  return NextResponse.json({
    user: {
      id: synced.user.id,
      email: synced.user.email,
      displayName: synced.user.displayName,
      fullName: synced.user.fullName,
      bio: synced.user.bio,
      avatarUrl: synced.user.avatarUrl,
      status: synced.user.status,
      plan: synced.user.plan,
    },
    descope: {
      userId: synced.descopeUser.userId,
      email: synced.descopeUser.email,
      name: synced.descopeUser.name,
      picture: synced.descopeUser.picture,
      providers: Object.entries(synced.descopeUser.OAuth ?? {})
        .filter(([, enabled]) => Boolean(enabled))
        .map(([provider]) => provider),
    },
  });
}
