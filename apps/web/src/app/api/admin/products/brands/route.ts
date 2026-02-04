import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const counts = await prisma.product.groupBy({
    by: ["brandId"],
    _count: { _all: true },
  });

  const countMap = new Map<string, number>();
  counts.forEach((row) => countMap.set(row.brandId, row._count._all ?? 0));

  return NextResponse.json({
    brands: brands.map((brand) => ({
      ...brand,
      productCount: countMap.get(brand.id) ?? 0,
    })),
  });
}
