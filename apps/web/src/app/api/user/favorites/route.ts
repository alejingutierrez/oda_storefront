import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";

export async function GET(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { product: { include: { brand: true } }, variant: true },
  });

  return NextResponse.json({
    favorites: favorites.map((favorite) => ({
      id: favorite.id,
      createdAt: favorite.createdAt,
      product: {
        id: favorite.product.id,
        name: favorite.product.name,
        imageCoverUrl: favorite.product.imageCoverUrl,
        sourceUrl: favorite.product.sourceUrl,
        currency: favorite.product.currency,
        brand: favorite.product.brand
          ? { id: favorite.product.brand.id, name: favorite.product.brand.name }
          : null,
      },
      variant: favorite.variant
        ? {
            id: favorite.variant.id,
            price: favorite.variant.price.toString(),
            currency: favorite.variant.currency,
            color: favorite.variant.color,
            size: favorite.variant.size,
          }
        : null,
    })),
  });
}

export async function POST(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { productId: string; variantId?: string | null };
  if (!body.productId) {
    return NextResponse.json({ error: "productId_required" }, { status: 400 });
  }

  const existing = await prisma.userFavorite.findFirst({
    where: {
      userId: session.user.id,
      productId: body.productId,
      variantId: body.variantId ?? null,
    },
  });

  const favorite =
    existing ??
    (await prisma.userFavorite.create({
      data: {
        userId: session.user.id,
        productId: body.productId,
        variantId: body.variantId ?? undefined,
      },
    }));

  await logExperienceEvent({
    type: "favorite_add",
    userId: session.user.id,
    productId: body.productId,
    variantId: body.variantId ?? undefined,
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
