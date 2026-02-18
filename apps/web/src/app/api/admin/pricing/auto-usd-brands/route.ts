import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import { applyUsdBrandOverrides, computeUsdBrandCandidates } from "@/lib/pricing-auto-usd";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { config, evaluatedBrands, candidates } = await computeUsdBrandCandidates();

  return NextResponse.json({
    ok: true,
    config,
    evaluatedBrands,
    candidateBrands: candidates.length,
    candidates,
  });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await applyUsdBrandOverrides();
    invalidateCatalogCache();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("pricing.auto_usd_brand.apply_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

