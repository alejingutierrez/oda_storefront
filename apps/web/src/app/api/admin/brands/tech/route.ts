import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [total, withPlatform, pending] = await Promise.all([
    prisma.brand.count({ where: { isActive: true, siteUrl: { not: null } } }),
    prisma.brand.count({
      where: { isActive: true, siteUrl: { not: null }, ecommercePlatform: { not: null } },
    }),
    prisma.brand.count({
      where: { isActive: true, siteUrl: { not: null }, ecommercePlatform: null },
    }),
  ]);

  return NextResponse.json({ total, withPlatform, pending });
}
