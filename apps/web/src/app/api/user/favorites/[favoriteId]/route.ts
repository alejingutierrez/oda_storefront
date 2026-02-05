import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function DELETE(
  _req: Request,
  { params }: { params: { favoriteId: string } },
) {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const favorite = await prisma.userFavorite.findUnique({
    where: { id: params.favoriteId },
  });

  if (!favorite || favorite.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.userFavorite.delete({ where: { id: favorite.id } });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "favorite_remove",
      entityType: "product",
      entityId: favorite.productId,
      metadata: { variantId: favorite.variantId ?? null },
    },
  });

  return NextResponse.json({ ok: true });
}
