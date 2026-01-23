import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { findActiveRun, markRunStatus } from "@/lib/catalog/run-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const run = await findActiveRun(brandId);
  if (!run) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  await markRunStatus(run.id, "stopped");
  return NextResponse.json({ status: "stopped" });
}
