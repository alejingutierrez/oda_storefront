import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis, isRedisEnabled } from "@/lib/redis";

export const runtime = "nodejs";

const JOB_KEY = "vector-emb-job";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Only allow clear when job is idle or error
    if (isRedisEnabled()) {
      const status = await getRedis().get(`${JOB_KEY}:status`);
      if (status === "running" || status === "paused") {
        return NextResponse.json(
          { error: "job_must_be_stopped_first" },
          { status: 400 },
        );
      }
    }

    // Delete all embeddings
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM product_embeddings`,
    );

    // Reset Redis state
    if (isRedisEnabled()) {
      const r = getRedis();
      await r
        .pipeline()
        .set(`${JOB_KEY}:status`, "idle", "EX", 3600)
        .del(`${JOB_KEY}:generated`)
        .del(`${JOB_KEY}:remaining`)
        .del(`${JOB_KEY}:totalProcessed`)
        .del(`${JOB_KEY}:speed`)
        .del(`${JOB_KEY}:chainCount`)
        .del(`${JOB_KEY}:startedAt`)
        .del(`${JOB_KEY}:error`)
        .del(`${JOB_KEY}:token`)
        .del(`${JOB_KEY}:heartbeat`)
        .lpush(
          `${JOB_KEY}:log`,
          JSON.stringify({
            t: Date.now(),
            m: `Embeddings limpiados: ${result} registros eliminados`,
          }),
        )
        .ltrim(`${JOB_KEY}:log`, 0, 49)
        .expire(`${JOB_KEY}:log`, 3600)
        .exec();
    }

    return NextResponse.json({ ok: true, deleted: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
