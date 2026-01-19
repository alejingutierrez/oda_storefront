import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { processNextBrandScrapeJob } from "@/lib/brand-scrape-queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await processNextBrandScrapeJob();

  if (result.status === "failed") {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
