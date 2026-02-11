import { NextResponse } from "next/server";
import { runCatalogRefreshBatch } from "@/lib/catalog/refresh";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const brandId = url.searchParams.get("brandId");
  const force = url.searchParams.get("force") === "true";
  const maxBrandsRaw = Number(url.searchParams.get("maxBrands"));
  const brandConcurrencyRaw = Number(url.searchParams.get("brandConcurrency"));
  const maxRuntimeMsRaw = Number(url.searchParams.get("maxRuntimeMs"));
  const maxBrands = Number.isFinite(maxBrandsRaw) ? maxBrandsRaw : undefined;
  const brandConcurrency = Number.isFinite(brandConcurrencyRaw)
    ? brandConcurrencyRaw
    : undefined;
  const maxRuntimeMs = Number.isFinite(maxRuntimeMsRaw) ? maxRuntimeMsRaw : undefined;

  const result = await runCatalogRefreshBatch({
    brandId: brandId ?? undefined,
    force,
    maxBrands,
    brandConcurrency,
    maxRuntimeMs,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}
