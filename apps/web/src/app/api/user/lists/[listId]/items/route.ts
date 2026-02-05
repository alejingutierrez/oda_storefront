import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function GET(
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

  const items = await prisma.userListItem.findMany({
    where: { listId: list.id },
    orderBy: { position: "asc" },
    include: { product: true, variant: true },
  });

  return NextResponse.json({ items });
}

export async function POST(
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
    productId: string;
    variantId?: string | null;
    position?: number;
  };

  if (!body.productId) {
    return NextResponse.json({ error: "productId_required" }, { status: 400 });
  }

  const item = await prisma.userListItem.upsert({
    where: {
      listId_productId_variantId: {
        listId: list.id,
        productId: body.productId,
        variantId: body.variantId ?? null,
      },
    },
    create: {
      listId: list.id,
      productId: body.productId,
      variantId: body.variantId ?? null,
      position: body.position ?? 0,
    },
    update: {
      position: body.position ?? 0,
    },
  });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "list_item_add",
      entityType: "list_item",
      entityId: item.id,
      metadata: { listId: list.id, productId: body.productId, variantId: body.variantId ?? null },
    },
  });

  return NextResponse.json({ item });
}
