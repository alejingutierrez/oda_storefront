import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import {
  evaluateArchiveCandidates,
  type ArchiveCandidateReason,
} from "@/lib/catalog/archive-policy";

export const runtime = "nodejs";
export const maxDuration = 60;

const isArchiveReason = (value: unknown): value is ArchiveCandidateReason =>
  value === "404_real" || value === "no_products_validated";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = typeof body?.dryRun === "boolean" ? body.dryRun : true;
  const scope = body?.scope === "brand" ? "brand" : "all";
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const limitRaw = Number(body?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  const reasons = Array.isArray(body?.reasons)
    ? body.reasons.filter(isArchiveReason)
    : undefined;

  if (scope === "brand" && !brandId) {
    return NextResponse.json(
      { error: "brandId_required_for_scope_brand" },
      { status: 400 },
    );
  }

  try {
    const createdBy =
      typeof (admin as { id?: string }).id === "string"
        ? (admin as { id: string }).id
        : (admin as { email?: string }).email ?? "admin_token";
    const result = await evaluateArchiveCandidates({
      dryRun,
      scope,
      brandId,
      reasons,
      limit,
      createdBy,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
