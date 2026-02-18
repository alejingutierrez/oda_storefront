import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import { applyUsdBrandOverrides } from "@/lib/pricing-auto-usd";

export const runtime = "nodejs";
export const maxDuration = 60;

const isCronRequest = (req: Request) => {
  const cronHeader = (req.headers.get("x-vercel-cron") ?? "").toLowerCase();
  const userAgent = req.headers.get("user-agent") ?? "";
  return (
    cronHeader === "1" ||
    cronHeader === "true" ||
    userAgent.toLowerCase().includes("vercel-cron")
  );
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

