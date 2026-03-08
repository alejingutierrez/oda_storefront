import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function GET(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");

  if (productId) {
    const alert = await prisma.priceAlert.findUnique({
      where: { userId_productId: { userId: session.user.id, productId } },
    });
    return NextResponse.json({ alert });
  }

  const alerts = await prisma.priceAlert.findMany({
    where: { userId: session.user.id, active: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ alerts });
}

export async function POST(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    productId?: string;
    targetPrice?: number;
    currency?: string;
  };

  if (!body.productId || typeof body.targetPrice !== "number" || body.targetPrice <= 0) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const alert = await prisma.priceAlert.upsert({
    where: {
      userId_productId: { userId: session.user.id, productId: body.productId },
    },
    update: {
      targetPrice: body.targetPrice,
      currency: body.currency ?? "COP",
      active: true,
      triggeredAt: null,
    },
    create: {
      userId: session.user.id,
      productId: body.productId,
      targetPrice: body.targetPrice,
      currency: body.currency ?? "COP",
    },
  });

  return NextResponse.json({ alert });
}

export async function DELETE(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "product_id_required" }, { status: 400 });
  }

  await prisma.priceAlert.deleteMany({
    where: { userId: session.user.id, productId },
  });

  return NextResponse.json({ ok: true });
}
