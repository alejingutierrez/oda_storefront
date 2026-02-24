import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { reconcileCatalogQueue } from "@/lib/catalog/queue-drift";

export const runtime = "nodejs";
export const maxDuration = 60;

const parseBody = async (req: Request) => {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

const boolFromValue = (value: unknown) =>
  value === true || value === "true" || value === 1 || value === "1";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await parseBody(req);
  const brandId = typeof body.brandId === "string" ? body.brandId : null;
  const runId = typeof body.runId === "string" ? body.runId : null;
  const dryRun = boolFromValue(body.dryRun);
  const jobScanLimit = Number(body.jobScanLimit ?? body.sampleLimit);
  const reenqueueLimit = Number(body.reenqueueLimit ?? body.limit);
  const activeHungMinutes = Number(body.activeHungMinutes ?? body.hungMinutes);
  const scanUntilMatchLimit = Number(body.scanUntilMatchLimit ?? body.activeScanLimit);
  const includeActiveAnalysis =
    body.includeActiveAnalysis === undefined
      ? undefined
      : boolFromValue(body.includeActiveAnalysis);

  try {
    const result = await reconcileCatalogQueue({
      brandId,
      runId,
      dryRun,
      jobScanLimit: Number.isFinite(jobScanLimit) ? jobScanLimit : undefined,
      reenqueueLimit: Number.isFinite(reenqueueLimit) ? reenqueueLimit : undefined,
      activeHungMinutes: Number.isFinite(activeHungMinutes) ? activeHungMinutes : undefined,
      scanUntilMatchLimit: Number.isFinite(scanUntilMatchLimit) ? scanUntilMatchLimit : undefined,
      includeActiveAnalysis,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
