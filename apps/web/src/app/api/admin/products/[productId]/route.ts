import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ productId: string }> }) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { productId } = await context.params;
  if (!productId) {
    return NextResponse.json({ error: "missing_product" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      brand: { select: { id: true, name: true, logoUrl: true } },
      variants: { orderBy: { price: "asc" } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ product });
}
