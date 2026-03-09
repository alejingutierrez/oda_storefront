import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getRedis, isRedisEnabled } from "@/lib/redis";
import { getEmbeddingStats } from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";

const JOB_KEY = "vector-emb-job";
const HEARTBEAT_TTL_MS = 90_000;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getEmbeddingStats();

    // Include job status + progress + extended state from Redis
    let jobStatus = "idle";
    let jobError: string | null = null;
    let lastBatchAt: string | null = null;
    let isStale = false;
    let startedAt: string | null = null;
    let speed: number | null = null;
    let chainCount: number | null = null;
    let totalProcessed: number | null = null;
    let log: Array<{ t: number; m: string }> = [];
    let config = { skipImages: false };

    if (isRedisEnabled()) {
      try {
        const r = getRedis();
        const [
          s, e, lb, hb, sa, sp, cc, tp, skipImg,
        ] = await r.mget(
          `${JOB_KEY}:status`,
          `${JOB_KEY}:error`,
          `${JOB_KEY}:lastBatchAt`,
          `${JOB_KEY}:heartbeat`,
          `${JOB_KEY}:startedAt`,
          `${JOB_KEY}:speed`,
          `${JOB_KEY}:chainCount`,
          `${JOB_KEY}:totalProcessed`,
          `${JOB_KEY}:config:skipImages`,
        );

        jobStatus = s ?? "idle";
        jobError = e ?? null;
        lastBatchAt = lb ?? null;
        startedAt = sa ?? null;
        speed = sp != null ? Number(sp) : null;
        chainCount = cc != null ? Number(cc) : null;
        totalProcessed = tp != null ? Number(tp) : null;
        config.skipImages = skipImg === "true";

        // Check heartbeat liveness
        const heartbeatAlive = hb != null && Date.now() - Number(hb) < HEARTBEAT_TTL_MS;

        // Auto-recover "stopping" when no invocation is alive
        if (jobStatus === "stopping" && !heartbeatAlive) {
          jobStatus = "idle";
          await r.set(`${JOB_KEY}:status`, "idle", "EX", 3600).catch(() => {});
        }

        // Check if job is stale (running but heartbeat expired)
        if (jobStatus === "running" && !heartbeatAlive) {
          isStale = true;
        }

        // Fetch last 20 log entries
        const rawLog = await r.lrange(`${JOB_KEY}:log`, 0, 19);
        log = rawLog
          .map((entry) => {
            try {
              return JSON.parse(entry) as { t: number; m: string };
            } catch {
              return null;
            }
          })
          .filter((x): x is { t: number; m: string } => x !== null);
      } catch {
        // Redis failure should not block stats
      }
    }

    return NextResponse.json({
      ...stats,
      jobStatus,
      jobError,
      lastBatchAt,
      isStale,
      startedAt,
      speed,
      chainCount,
      totalProcessed,
      log,
      config,
    });
  } catch (error) {
    console.error("[vector-classification/embeddings] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
