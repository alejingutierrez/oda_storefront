import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ products: [] });

  const products = await prisma.product.findMany({
    where: {
      hasInStock: true,
      imageCoverUrl: { not: null },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { brand: { name: { contains: q, mode: "insensitive" } } },
        { id: q.length === 36 ? q : undefined },
      ],
    },
    select: {
      id: true,
      name: true,
      imageCoverUrl: true,
      brand: { select: { name: true } },
      category: true,
      hasInStock: true,
      sourceUrl: true,
    },
    take: 10,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ products });
}
