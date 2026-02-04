import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { processOnboarding } from "@/lib/brand-onboarding";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ brandId: string }> },
) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { brandId } = await context.params;
  if (!brandId) {
    return NextResponse.json({ error: "brand_id_required" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => null)) as { force?: boolean } | null;
  const force = payload?.force === true;

  const result = await processOnboarding(brandId, { force, advance: true });
  return NextResponse.json(result);
}
