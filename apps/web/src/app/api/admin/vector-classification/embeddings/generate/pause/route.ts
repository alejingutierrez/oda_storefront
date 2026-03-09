import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getRedis, isRedisEnabled } from "@/lib/redis";

export const runtime = "nodejs";

const JOB_KEY = "vector-emb-job";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (isRedisEnabled()) {
      const r = getRedis();
      const status = await r.get(`${JOB_KEY}:status`);
      if (status !== "running") {
        return NextResponse.json({ error: "job_not_running" }, { status: 400 });
      }
      await r
        .pipeline()
        .set(`${JOB_KEY}:status`, "paused", "EX", 3600)
        .del(`${JOB_KEY}:token`) // prevent self-chains
        .lpush(
          `${JOB_KEY}:log`,
          JSON.stringify({ t: Date.now(), m: "Job pausado por el usuario" }),
        )
        .ltrim(`${JOB_KEY}:log`, 0, 49)
        .expire(`${JOB_KEY}:log`, 3600)
        .exec();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
