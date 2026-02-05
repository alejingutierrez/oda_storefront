import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function GET() {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { product: true, variant: true },
  });

  return NextResponse.json({ favorites });
}

export async function POST(req: Request) {
  const session = await requireUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { productId: string; variantId?: string | null };
  if (!body.productId) {
    return NextResponse.json({ error: "productId_required" }, { status: 400 });
  }

  const favorite = await prisma.userFavorite.upsert({
    where: {
      userId_productId_variantId: {
        userId: session.user.id,
        productId: body.productId,
        variantId: body.variantId ?? null,
      },
    },
    create: {
      userId: session.user.id,
      productId: body.productId,
      variantId: body.variantId ?? undefined,
    },
    update: {},
  });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "favorite_add",
      entityType: "product",
      entityId: body.productId,
      metadata: { variantId: body.variantId ?? null },
    },
  });

  return NextResponse.json({ favorite });
}
