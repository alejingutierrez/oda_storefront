import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [heroPinCount, activePinCount, trendingSnapshot, configCount] = await Promise.all([
    prisma.homeHeroPin.count(),
    prisma.homeHeroPin.count({ where: { active: true } }),
    prisma.homeTrendingDaily.findFirst({
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true, createdAt: true },
    }),
    prisma.homeConfig.count(),
  ]);

  const trendingCount = trendingSnapshot
    ? await prisma.homeTrendingDaily.count({
        where: { snapshotDate: trendingSnapshot.snapshotDate },
      })
    : 0;

  return NextResponse.json({
    heroPinCount,
    activePinCount,
    trendingSnapshotDate: trendingSnapshot?.snapshotDate ?? null,
    trendingSnapshotCreatedAt: trendingSnapshot?.createdAt ?? null,
    trendingCount,
    configCount,
  });
}
