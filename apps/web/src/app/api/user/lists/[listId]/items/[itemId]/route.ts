import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function DELETE(
  _req: Request,
  { params }: { params: { listId: string; itemId: string } },
) {
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

  const item = await prisma.userListItem.findUnique({
    where: { id: params.itemId },
  });

  if (!item || item.listId !== list.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.userListItem.delete({ where: { id: item.id } });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "list_item_remove",
      entityType: "list_item",
      entityId: item.id,
      metadata: { listId: list.id, productId: item.productId, variantId: item.variantId ?? null },
    },
  });

  return NextResponse.json({ ok: true });
}
