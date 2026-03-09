import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getRedis, isRedisEnabled } from "@/lib/redis";

export const runtime = "nodejs";

const JOB_KEY = "vector-emb-job";
const JOB_TTL = 3600;

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (!isRedisEnabled()) {
      return NextResponse.json({ error: "redis_required" }, { status: 400 });
    }

    const r = getRedis();
    const status = await r.get(`${JOB_KEY}:status`);
    if (status !== "paused") {
      return NextResponse.json({ error: "job_not_paused" }, { status: 400 });
    }

    // Generate new token and set running
    const token = crypto.randomUUID();
    await r
      .pipeline()
      .set(`${JOB_KEY}:status`, "running", "EX", JOB_TTL)
      .set(`${JOB_KEY}:token`, token, "EX", JOB_TTL)
      .lpush(
        `${JOB_KEY}:log`,
        JSON.stringify({ t: Date.now(), m: "Job reanudado por el usuario" }),
      )
      .ltrim(`${JOB_KEY}:log`, 0, 49)
      .expire(`${JOB_KEY}:log`, JOB_TTL)
      .exec();

    // Trigger new invocation with the token
    const baseUrl = getBaseUrl();
    fetch(
      `${baseUrl}/api/admin/vector-classification/embeddings/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-job-token": token,
        },
        body: JSON.stringify({}),
      },
    ).catch(() => {
      // fire-and-forget
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
