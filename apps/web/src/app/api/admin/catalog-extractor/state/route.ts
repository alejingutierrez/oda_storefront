import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { findLatestRun, summarizeRun } from "@/lib/catalog/run-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { metadata: true },
  });
  if (!brand) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  const run = await findLatestRun(brandId);
  if (!run) return NextResponse.json({ state: null });
  const state = await summarizeRun(run.id);
  return NextResponse.json({ state });
}
