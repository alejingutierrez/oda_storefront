import { NextResponse } from "next/server";
import { runCatalogRefreshBatch } from "@/lib/catalog/refresh";
import { validateCronOrAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Dedicated lightweight cron endpoint for Vercel scheduler.
 * Hard-codes mode=light and maxRuntimeMs=240000 to avoid query-param issues
 * with Vercel Cron (the primary /cron route uses query params which may
 * not be reliably forwarded by the scheduler).
 */
export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCatalogRefreshBatch({
      mode: "light",
      maxRuntimeMs: 240_000,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("catalog-refresh.cron-light_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
