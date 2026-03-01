import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { isPrismaTableMissingError } from "@/lib/prisma-error-utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let heroPinCount = 0;
  let activePinCount = 0;
  let configCount = 0;

  try {
    [heroPinCount, activePinCount] = await Promise.all([
      prisma.homeHeroPin.count(),
      prisma.homeHeroPin.count({ where: { active: true } }),
    ]);
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_hero_pins")) throw error;
    console.warn("admin.home.api.stats.hero_pins_table_missing_fallback", { table: "home_hero_pins" });
  }

  try {
    configCount = await prisma.homeConfig.count();
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_config")) throw error;
    console.warn("admin.home.api.stats.config_table_missing_fallback", { table: "home_config" });
  }

  const trendingSnapshot = await prisma.homeTrendingDaily.findFirst({
    orderBy: { snapshotDate: "desc" },
    select: { snapshotDate: true, createdAt: true },
  });

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
