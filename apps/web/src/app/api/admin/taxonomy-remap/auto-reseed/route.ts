import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import {
  getTaxonomyAutoReseedPhaseState,
  runTaxonomyAutoReseedBatch,
} from "@/lib/taxonomy-remap/auto-reseed";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const phase = await getTaxonomyAutoReseedPhaseState();
  return NextResponse.json({ ok: true, phase });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const debug = req.headers.get("x-oda-debug") === "1";
  const body = (await req.json().catch(() => null)) as
    | { force?: boolean; limit?: number; mode?: string }
    | null;
  const force = body?.force === true;
  const limit = typeof body?.limit === "number" ? Math.max(100, Math.floor(body.limit)) : undefined;
  const mode = body?.mode === "refresh_pending" ? "refresh_pending" : undefined;

  const result = await runTaxonomyAutoReseedBatch({
    trigger: "manual",
    force,
    limit,
    ...(mode ? { mode } : {}),
  });

  return NextResponse.json({
    ok: true,
    result,
    ...(debug ? { debug: { force, limit, mode } } : {}),
  });
}
