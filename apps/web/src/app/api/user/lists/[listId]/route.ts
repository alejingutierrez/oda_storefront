import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ listId: string }> },
) {
  const params = await context.params;
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = await prisma.userList.findUnique({
    where: { id: params.listId },
  });

  if (!list || list.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    name?: string;
    description?: string;
    visibility?: string;
  };

  const visibility = body.visibility === "public" ? "public" : list.visibility;
  const updated = await prisma.userList.update({
    where: { id: list.id },
    data: {
      name: body.name?.trim() || list.name,
      description: body.description?.trim() ?? list.description,
      visibility,
    },
  });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "list_update",
      entityType: "list",
      entityId: list.id,
    },
  });

  return NextResponse.json({ list: updated });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ listId: string }> },
) {
  const params = await context.params;
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = await prisma.userList.findUnique({
    where: { id: params.listId },
  });

  if (!list || list.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.userList.delete({ where: { id: list.id } });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "list_delete",
      entityType: "list",
      entityId: list.id,
    },
  });

  return NextResponse.json({ ok: true });
}
