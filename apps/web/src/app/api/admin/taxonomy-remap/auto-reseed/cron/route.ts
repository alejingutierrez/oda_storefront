import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { runTaxonomyAutoReseedBatch } from "@/lib/taxonomy-remap/auto-reseed";

export const runtime = "nodejs";
export const maxDuration = 300;

const isCronRequest = (req: Request) => {
  const cronHeader = req.headers.get("x-vercel-cron");
  const userAgent = req.headers.get("user-agent") ?? "";
  return cronHeader === "1" || userAgent.toLowerCase().includes("vercel-cron");
};

const hasAdminToken = (req: Request) => {
  const headerToken = req.headers.get("authorization")?.replace(/^Bearer\\s+/i, "").trim();
  if (!headerToken) return false;
  if (process.env.ADMIN_TOKEN && headerToken === process.env.ADMIN_TOKEN) return true;
  return false;
};

export async function GET(req: Request) {
  const isCron = isCronRequest(req);
  const hasToken = hasAdminToken(req);
  if (!isCron && !hasToken) {
    const admin = await validateAdminRequest(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(100, Number(limitRaw) || 0) : undefined;

  const result = await runTaxonomyAutoReseedBatch({
    trigger: "cron",
    force,
    limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });

  return NextResponse.json({ ok: true, result });
}

export async function POST(req: Request) {
  return GET(req);
}
