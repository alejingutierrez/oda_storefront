import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { processNextBrandScrapeJob } from "@/lib/brand-scrape-queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const batchId = typeof body?.batchId === "string" ? body.batchId : null;

  const result = await processNextBrandScrapeJob(batchId);

  if (result.status === "failed") {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
