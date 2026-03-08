import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRedisEnabled, getRedis, readHeartbeat } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = {
  status: "ok" | "degraded" | "down";
  latencyMs?: number;
  error?: string;
};

export async function GET() {
  const checks: Record<string, CheckResult> = {};

  // Database
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: "down",
      latencyMs: Date.now() - dbStart,
      error: error instanceof Error ? error.message : "unknown",
    };
  }

  // Redis
  if (isRedisEnabled()) {
    const redisStart = Date.now();
    try {
      const client = getRedis();
      await client.ping();
      checks.redis = { status: "ok", latencyMs: Date.now() - redisStart };
    } catch (error) {
      checks.redis = {
        status: "degraded",
        latencyMs: Date.now() - redisStart,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  } else {
    checks.redis = { status: "degraded", error: "not_configured" };
  }

  // Worker heartbeat
  try {
    const heartbeat = await readHeartbeat("workers:catalog:alive");
    checks.worker = heartbeat?.online
      ? { status: "ok" }
      : { status: "degraded", error: "heartbeat_missing" };
  } catch {
    checks.worker = { status: "degraded", error: "heartbeat_check_failed" };
  }

  const hasDown = Object.values(checks).some((c) => c.status === "down");
  const hasDegraded = Object.values(checks).some((c) => c.status === "degraded");
  const overall = hasDown ? "down" : hasDegraded ? "degraded" : "ok";

  return NextResponse.json(
    { status: overall, checks, timestamp: new Date().toISOString() },
    {
      status: hasDown ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
