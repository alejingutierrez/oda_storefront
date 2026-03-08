import { NextResponse } from "next/server";
import { validateCronOrAdmin } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import { applyUsdBrandOverrides } from "@/lib/pricing-auto-usd";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await applyUsdBrandOverrides();
    invalidateCatalogCache();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("pricing.auto_usd_brand.cron_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}

