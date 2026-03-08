import { NextResponse } from "next/server";
import { validateCronOrAdmin } from "@/lib/auth";
import { runTaxonomyAutoReseedBatch } from "@/lib/taxonomy-remap/auto-reseed";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
