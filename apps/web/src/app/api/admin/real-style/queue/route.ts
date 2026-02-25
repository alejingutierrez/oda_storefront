import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import {
  decodeRealStyleCursor,
  getRealStyleQueue,
  parseQueueLimit,
} from "@/lib/real-style/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = parseQueueLimit(url.searchParams.get("limit"));
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeRealStyleCursor(rawCursor);

  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  try {
    const payload = await getRealStyleQueue({ limit, cursor });
    return NextResponse.json({
      ok: true,
      limit,
      ...payload,
    });
  } catch (error) {
    console.error("real-style.queue.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
