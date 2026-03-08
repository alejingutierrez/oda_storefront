import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** POST — Create a new style discovery session. */
export async function POST(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const styleSession = await prisma.styleSession.create({
    data: {
      userId: session.user.id,
      status: "active",
      itemCount: 20,
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json(styleSession, {
    headers: { "cache-control": "private, no-store" },
  });
}
