import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findActiveRun, summarizeRun } from "@/lib/product-enrichment/run-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : null;
  const scope = body?.scope === "all" || body?.scope === "brand" ? body.scope : null;
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;

  const run = runId
    ? await prisma.productEnrichmentRun.findUnique({ where: { id: runId } })
    : scope
      ? await findActiveRun({ scope, brandId })
      : null;

  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  await prisma.productEnrichmentRun.update({
    where: { id: run.id },
    data: { status: "paused", updatedAt: new Date() },
  });

  const summary = await summarizeRun(run.id);
  return NextResponse.json({ summary });
}
