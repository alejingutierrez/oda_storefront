import { NextResponse } from "next/server";
import { runCatalogRefreshBatch } from "@/lib/catalog/refresh";
import { validateCronOrAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Dedicated lightweight cron endpoint for Vercel scheduler.
 * Hard-codes mode=light and a conservative maxRuntimeMs to stay well within
 * the 300s Vercel function limit. Previous 240s budget caused
 * FUNCTION_INVOCATION_TIMEOUT because runCatalogRefreshBatch pre-batch
 * operations can overrun the budget.
 */
export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCatalogRefreshBatch({
      mode: "light",
      maxRuntimeMs: 120_000,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("catalog-refresh.cron-light_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
