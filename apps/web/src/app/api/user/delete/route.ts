import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, getDescopeManagementSdk } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";

export async function POST() {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const descopeUserId = session.user.descopeUserId;

  if (descopeUserId) {
    try {
      const sdk = getDescopeManagementSdk();
      await sdk.management.user.deleteByUserId(descopeUserId);
    } catch (error) {
      console.error("Failed to delete Descope user", error);
    }
  }

  await prisma.experienceEvent.updateMany({
    where: { userId },
    data: { userId: null },
  });

  await logExperienceEvent({
    type: "account_delete",
    userId,
  });

  await prisma.userAuditEvent.create({
    data: {
      userId,
      action: "user_delete",
      entityType: "user",
      entityId: userId,
      metadata: { descopeUserId },
    },
  });

  await prisma.user.delete({ where: { id: userId } });

  return NextResponse.json({ ok: true });
}
