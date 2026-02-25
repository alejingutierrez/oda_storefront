import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getRealStyleSummary } from "@/lib/real-style/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getRealStyleSummary();
    return NextResponse.json({
      ok: true,
      summary,
    });
  } catch (error) {
    console.error("real-style.summary.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
