import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { findLatestRun, summarizeRun } from "@/lib/product-enrichment/run-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const brandId = url.searchParams.get("brandId") ?? undefined;
  const scope = scopeParam === "brand" || scopeParam === "all" ? scopeParam : brandId ? "brand" : "all";

  const run = await findLatestRun({ scope, brandId });
  const summary = run ? await summarizeRun(run.id) : null;

  return NextResponse.json({
    summary,
    run: run
      ? {
          id: run.id,
          status: run.status,
          scope: run.scope,
          brandId: run.brandId,
          updatedAt: run.updatedAt,
        }
      : null,
  });
}
