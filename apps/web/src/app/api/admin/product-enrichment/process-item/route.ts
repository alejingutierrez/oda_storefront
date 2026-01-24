import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { processEnrichmentItemById } from "@/lib/product-enrichment/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const itemId = typeof body?.itemId === "string" ? body.itemId : null;
  if (!itemId) {
    return NextResponse.json({ error: "missing_item" }, { status: 400 });
  }

  try {
    const result = await processEnrichmentItemById(itemId, { allowQueueRefill: true });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}
