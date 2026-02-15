import { NextResponse } from "next/server";
import { processBrandScrapeBatch } from "@/lib/brand-scrape-queue";

export const runtime = "nodejs";

const parseNumber = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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

export async function GET(req: Request) {
  if (!isCronRequest(req) && !hasAdminToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const maxJobs = parseNumber(
    url.searchParams.get("limit"),
    parseNumber(process.env.BRAND_SCRAPE_MAX_JOBS ?? null, 3),
  );
  const maxRuntimeMs = parseNumber(
    process.env.BRAND_SCRAPE_MAX_RUNTIME_MS ?? null,
    25000,
  );

  const results = await processBrandScrapeBatch({ maxJobs, maxRuntimeMs });
  return NextResponse.json({
    status: "ok",
    processed: results.length,
    results,
  });
}
