import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { publishDraftTaxonomy } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await publishDraftTaxonomy({ adminEmail: admin.email });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: (result as any).details ?? null },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}
