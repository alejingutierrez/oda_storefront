import { NextResponse } from "next/server";
import { syncUserFromDescope } from "@/lib/descope";

export async function POST() {
  const synced = await syncUserFromDescope();
  if (!synced) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
