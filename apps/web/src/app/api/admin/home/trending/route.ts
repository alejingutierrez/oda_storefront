import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

async function rebuildDailyTrending(limit: number) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowEnd = todayUtc;
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  const snapshotDate = windowStart;

  type TrendingCandidate = { productId: string; clickCount: number };
  const rows = await prisma.$queryRaw<TrendingCandidate[]>(Prisma.sql`
    with ranked as (
      select
        ee."productId" as "productId",
        count(*)::int as "clickCount"
      from "experience_events" ee
      join products p on p.id = ee."productId"
      where ee.type = 'product_click'
        and ee."productId" is not null
        and ee."createdAt" >= ${windowStart}
        and ee."createdAt" < ${windowEnd}
        and p."imageCoverUrl" is not null
        and p."hasInStock" = true
      group by ee."productId"
    )
    select
      "productId",
      "clickCount"
    from ranked
    order by "clickCount" desc, md5(concat("productId"::text, ${snapshotDate.toISOString()}))
    limit ${limit}
  `);

  await prisma.$transaction(async (tx) => {
    await tx.homeTrendingDaily.deleteMany({ where: { snapshotDate } });
    if (rows.length === 0) return;
    await tx.homeTrendingDaily.createMany({
      data: rows.map((row, index) => ({
        snapshotDate,
        productId: row.productId,
        clickCount: Number(row.clickCount ?? 0),
        rank: index + 1,
        sourceWindowStart: windowStart,
        sourceWindowEnd: windowEnd,
        metadata: { source: "experience_events", eventType: "product_click" },
      })),
      skipDuplicates: true,
    });
  });

  return {
    snapshotDate: snapshotDate.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    inserted: rows.length,
    limit,
  };
}

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const latest = await prisma.homeTrendingDaily.findFirst({
    orderBy: { snapshotDate: "desc" },
    select: {
      snapshotDate: true,
      sourceWindowStart: true,
      sourceWindowEnd: true,
      createdAt: true,
    },
  });

  const count = latest
    ? await prisma.homeTrendingDaily.count({
        where: { snapshotDate: latest.snapshotDate },
      })
    : 0;

  return NextResponse.json({ snapshot: latest, count });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawLimit = typeof body.limit === "number" ? body.limit : Number(body.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 48;

  try {
    const result = await rebuildDailyTrending(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("home-trending.admin_rebuild_failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
