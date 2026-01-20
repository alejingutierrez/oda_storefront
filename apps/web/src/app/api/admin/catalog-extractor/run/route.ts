import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { extractCatalogForBrand } from "@/lib/catalog/extractor";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const limit = Number(body?.limit ?? 20);

  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  try {
    const summary = await extractCatalogForBrand(brandId, Number.isFinite(limit) ? limit : 20);
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}
