import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { readCatalogRunState, summarizeCatalogRunState } from "@/lib/catalog/extractor";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { metadata: true },
  });
  if (!brand) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  const metadata =
    brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
      ? (brand.metadata as Record<string, unknown>)
      : {};
  const state = summarizeCatalogRunState(readCatalogRunState(metadata));

  return NextResponse.json({ state });
}
