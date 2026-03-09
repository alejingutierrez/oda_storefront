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
      // Delete token first to prevent any new self-chains
      await r.del(`${JOB_KEY}:token`);

      // Check if an invocation is actually alive via heartbeat
      const hb = await r.get(`${JOB_KEY}:heartbeat`);
      const isAlive = hb != null && Date.now() - Number(hb) < 90_000;

      if (isAlive) {
        // Active invocation exists — set "stopping" so it finishes gracefully
        await r
          .pipeline()
          .set(`${JOB_KEY}:status`, "stopping", "EX", 3600)
          .lpush(
            `${JOB_KEY}:log`,
            JSON.stringify({ t: Date.now(), m: "Detencion solicitada por el usuario" }),
          )
          .ltrim(`${JOB_KEY}:log`, 0, 49)
          .expire(`${JOB_KEY}:log`, 3600)
          .exec();
      } else {
        // No active invocation — go straight to idle
        await r
          .pipeline()
          .set(`${JOB_KEY}:status`, "idle", "EX", 3600)
          .lpush(
            `${JOB_KEY}:log`,
            JSON.stringify({ t: Date.now(), m: "Job detenido (sin invocacion activa)" }),
          )
          .ltrim(`${JOB_KEY}:log`, 0, 49)
          .expire(`${JOB_KEY}:log`, 3600)
          .exec();
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
