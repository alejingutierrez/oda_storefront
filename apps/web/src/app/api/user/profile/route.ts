import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, getDescopeManagementSdk } from "@/lib/descope";

export async function GET() {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const identities = await prisma.userIdentity.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      fullName: session.user.fullName,
      bio: session.user.bio,
      avatarUrl: session.user.avatarUrl,
      status: session.user.status,
      plan: session.user.plan,
    },
    identities,
  });
}

export async function PATCH(req: Request) {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    displayName?: string | null;
    fullName?: string | null;
    bio?: string | null;
  };

  const updatePayload: {
    displayName?: string | null;
    fullName?: string | null;
    bio?: string | null;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
    updatePayload.displayName = body.displayName?.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "fullName")) {
    updatePayload.fullName = body.fullName?.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "bio")) {
    updatePayload.bio = body.bio?.trim() || null;
  }

  const before = {
    displayName: session.user.displayName,
    fullName: session.user.fullName,
    bio: session.user.bio,
  };

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: updatePayload,
  });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "profile_update",
      entityType: "user",
      entityId: session.user.id,
      before,
      after: {
        displayName: updated.displayName,
        fullName: updated.fullName,
        bio: updated.bio,
      },
    },
  });

  try {
    const sdk = getDescopeManagementSdk();
    if (session.user.descopeUserId) {
      await sdk.management.user.patch(session.user.descopeUserId, {
        displayName: updated.displayName ?? undefined,
      });
    }
  } catch (error) {
    console.error("Failed to sync Descope user profile", error);
  }

  return NextResponse.json({
    user: {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      fullName: updated.fullName,
      bio: updated.bio,
      avatarUrl: updated.avatarUrl,
      status: updated.status,
      plan: updated.plan,
    },
  });
}
