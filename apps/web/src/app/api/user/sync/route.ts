import { NextResponse } from "next/server";
import { syncUserFromDescope } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";

export async function POST(req: Request) {
  let fallbackUser: Record<string, unknown> | null = null;
  try {
    const body = (await req.json()) as { user?: Record<string, unknown> };
    fallbackUser = body?.user ?? null;
  } catch {
    fallbackUser = null;
  }

  const synced = await syncUserFromDescope(fallbackUser);
  if (!synced) {
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
