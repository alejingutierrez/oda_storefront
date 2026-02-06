import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const options = await getPublishedTaxonomyOptions();
  return NextResponse.json({ ok: true, options });
}

