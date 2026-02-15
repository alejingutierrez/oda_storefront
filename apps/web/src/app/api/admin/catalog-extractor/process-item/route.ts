import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { isCatalogQueueEnabled } from "@/lib/catalog/queue";
import { processCatalogItemById } from "@/lib/catalog/processor";

export const runtime = "nodejs";

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

  const result = await processCatalogItemById(itemId, {
    allowQueueRefill: isCatalogQueueEnabled(),
  });
  return NextResponse.json(result);
}
