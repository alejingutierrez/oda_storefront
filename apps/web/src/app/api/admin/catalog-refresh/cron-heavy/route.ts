import { NextResponse } from "next/server";
import { runCatalogRefreshBatch } from "@/lib/catalog/refresh";
import { validateCronOrAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Dedicated heavy cron endpoint for Vercel scheduler.
 * Hard-codes mode=heavy and maxRuntimeMs=240000 to avoid query-param issues
 * with Vercel Cron.
 */
export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCatalogRefreshBatch({
      mode: "heavy",
      maxRuntimeMs: 240_000,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("catalog-refresh.cron-heavy_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
