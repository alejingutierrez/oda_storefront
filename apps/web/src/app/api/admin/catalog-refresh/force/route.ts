import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { startForcedRefreshForBrand } from "@/lib/catalog/refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

const hasAdminToken = (req: Request) => {
  const headerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!headerToken) return false;
  if (process.env.ADMIN_TOKEN && headerToken === process.env.ADMIN_TOKEN) return true;
  return false;
};

const asBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};

export async function POST(req: Request) {
  if (!hasAdminToken(req)) {
    const admin = await validateAdminRequest(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json().catch(() => null);
    const brandId = typeof body?.brandId === "string" ? body.brandId : "";
    if (!brandId) {
      return NextResponse.json({ error: "missing_brandId" }, { status: 400 });
    }
    const force = asBoolean(body?.force, true);
    const result = await startForcedRefreshForBrand({
      brandId,
      force,
      source: "manual",
    });

    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        brandId: result.brandId,
        runId: result.runId,
        mode: result.mode,
        reason: result.reason,
        message: result.message,
        pollUrl: `/api/admin/catalog-refresh/state`,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "brand_not_found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
