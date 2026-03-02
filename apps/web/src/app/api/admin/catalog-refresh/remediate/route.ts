import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import {
  runCatalogRefreshStuckRemediation,
  type CatalogRefreshStuckRemediationStrategy,
} from "@/lib/catalog/refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

const parseBody = async (req: Request) => {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

const boolFromValue = (value: unknown) =>
  value === true || value === "true" || value === 1 || value === "1";

const parseOptionalNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseStrategy = (value: unknown): CatalogRefreshStuckRemediationStrategy => {
  if (typeof value !== "string") return "aggressive_tail_close";
  const normalized = value.trim().toLowerCase();
  return normalized === "balanced" ? "balanced" : "aggressive_tail_close";
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await parseBody(req);
  const dryRun = body.dryRun === undefined ? true : boolFromValue(body.dryRun);
  const strategy = parseStrategy(body.strategy);
  const limit = parseOptionalNumber(body.limit);
  const minNoProgressMinutes = parseOptionalNumber(body.minNoProgressMinutes);
  const pauseOverCapTarget = parseOptionalNumber(body.pauseOverCapTarget);
  const tailProgressPct = parseOptionalNumber(body.tailProgressPct);
  const tailMaxRemaining = parseOptionalNumber(body.tailMaxRemaining);
  const tailStaleMinutes = parseOptionalNumber(body.tailStaleMinutes);
  const forceTerminalizeRemaining =
    body.forceTerminalizeRemaining === undefined
      ? undefined
      : boolFromValue(body.forceTerminalizeRemaining);
  const runId = typeof body.runId === "string" ? body.runId : undefined;

  try {
    const result = await runCatalogRefreshStuckRemediation({
      dryRun,
      strategy,
      limit,
      minNoProgressMinutes,
      pauseOverCapTarget,
      tailProgressPct,
      tailMaxRemaining,
      tailStaleMinutes,
      forceTerminalizeRemaining,
      runId,
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
