import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, syncUserFromDescope } from "@/lib/descope";

export async function GET() {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const identities = await prisma.userIdentity.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ identities });
}

export async function POST() {
  const synced = await syncUserFromDescope();
  if (!synced) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const identities = await prisma.userIdentity.findMany({
    where: { userId: synced.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ identities });
}
