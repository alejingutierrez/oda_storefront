import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getRedis, isRedisEnabled } from "@/lib/redis";
import { getEmbeddingStats } from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";

const JOB_KEY = "vector-emb-job";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getEmbeddingStats();

    // Include job status from Redis
    let jobStatus = "idle";
    let jobError: string | null = null;
    if (isRedisEnabled()) {
      try {
        const r = getRedis();
        jobStatus = (await r.get(`${JOB_KEY}:status`)) ?? "idle";
        jobError = (await r.get(`${JOB_KEY}:error`)) ?? null;
      } catch {
        // Redis failure should not block stats
      }
    }

    return NextResponse.json({ ...stats, jobStatus, jobError });
  } catch (error) {
    console.error("[vector-classification/embeddings] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
