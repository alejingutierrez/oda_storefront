import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function GET() {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lists = await prisma.userList.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });

  return NextResponse.json({ lists });
}

export async function POST(req: Request) {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name?: string;
    description?: string;
    visibility?: string;
  };

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const visibility = body.visibility === "public" ? "public" : "private";
  const list = await prisma.userList.create({
    data: {
      userId: session.user.id,
      name,
      description: body.description?.trim() || null,
      visibility,
    },
  });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "list_create",
      entityType: "list",
      entityId: list.id,
    },
  });

  return NextResponse.json({ list });
}
