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
  const includeSummaryParam = url.searchParams.get("includeSummary");
  const cursor = decodeRealStyleCursor(rawCursor);
  const includeSummary =
    includeSummaryParam == null
      ? true
      : includeSummaryParam === "true"
        ? true
        : includeSummaryParam === "false"
          ? false
          : null;

  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
  if (includeSummary == null) {
    return NextResponse.json({ error: "invalid_include_summary" }, { status: 400 });
  }

  try {
    const payload = await getRealStyleQueue({ limit, cursor, includeSummary });
    const response: {
      ok: true;
      limit: number;
      items: typeof payload.items;
      nextCursor: string | null;
      summary?: typeof payload.summary;
    } = {
      ok: true,
      limit,
      items: payload.items,
      nextCursor: payload.nextCursor,
    };
    if (payload.summary) {
      response.summary = payload.summary;
    }
    return NextResponse.json(response);
  } catch (error) {
    console.error("real-style.queue.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
