import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getRedis, isRedisEnabled } from "@/lib/redis";

export const runtime = "nodejs";

const JOB_KEY = "vector-emb-job";
const CONFIG_TTL = 86400; // 24 hours — persists between jobs

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    let skipImages = false;
    if (isRedisEnabled()) {
      const val = await getRedis().get(`${JOB_KEY}:config:skipImages`);
      skipImages = val === "true";
    }
    return NextResponse.json({ skipImages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const skipImages = Boolean(body.skipImages);

    if (isRedisEnabled()) {
      await getRedis().set(
        `${JOB_KEY}:config:skipImages`,
        skipImages ? "true" : "false",
        "EX",
        CONFIG_TTL,
      );
    }

    return NextResponse.json({ ok: true, skipImages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
