import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      siteUrl: { not: null },
      ecommercePlatform: { not: null },
    },
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      siteUrl: true,
      ecommercePlatform: true,
      _count: { select: { products: true } },
    },
  });

  return NextResponse.json({ brands });
}
