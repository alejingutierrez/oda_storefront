import { NextResponse } from "next/server";
import { processBrandScrapeBatch } from "@/lib/brand-scrape-queue";
import { validateCronOrAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const parseNumber = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
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
