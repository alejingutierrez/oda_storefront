import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const platforms = await prisma.brand.groupBy({
    by: ["ecommercePlatform"],
    where: {
      isActive: true,
      siteUrl: { not: null },
      ecommercePlatform: { not: null },
    },
    _count: true,
    orderBy: { ecommercePlatform: "asc" },
  });

  return NextResponse.json({
    platforms: platforms
      .filter((row) => row.ecommercePlatform)
      .map((row) => ({
        platform: row.ecommercePlatform,
        count: row._count,
      })),
  });
}
