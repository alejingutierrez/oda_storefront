import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const isCronRequest = (req: Request) => {
  const cronHeader = (req.headers.get("x-vercel-cron") ?? "").toLowerCase();
  const userAgent = req.headers.get("user-agent") ?? "";
  return (
    cronHeader === "1" ||
    cronHeader === "true" ||
    userAgent.toLowerCase().includes("vercel-cron")
  );
};

const hasAdminToken = (req: Request) => {
  const headerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!headerToken) return false;
  if (process.env.ADMIN_TOKEN && headerToken === process.env.ADMIN_TOKEN) return true;
  return false;
};

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

type TrendingCandidate = {
  productId: string;
  clickCount: number;
};

async function rebuildDailyTrending(limit: number) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowEnd = todayUtc;
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  const snapshotDate = windowStart;

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
    await tx.homeTrendingDaily.deleteMany({
      where: { snapshotDate },
    });

    if (rows.length === 0) return;

    await tx.homeTrendingDaily.createMany({
      data: rows.map((row, index) => ({
        snapshotDate,
        productId: row.productId,
        clickCount: Number(row.clickCount ?? 0),
        rank: index + 1,
        sourceWindowStart: windowStart,
        sourceWindowEnd: windowEnd,
        metadata: {
          source: "experience_events",
          eventType: "product_click",
        },
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
  const cron = isCronRequest(req);
  const token = hasAdminToken(req);
  if (!cron && !token) {
    const admin = await validateAdminRequest(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const url = new URL(req.url);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 48);
    const result = await rebuildDailyTrending(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("home-trending.cron_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
