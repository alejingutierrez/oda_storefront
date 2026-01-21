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
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const platform = url.searchParams.get("platform");

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      siteUrl: { not: null },
      ecommercePlatform: platform ? platform : { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      siteUrl: true,
      ecommercePlatform: true,
      metadata: true,
      _count: { select: { products: true } },
    },
  });

  const brandsWithState = brands.map((brand) => {
    const metadata =
      brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
        ? (brand.metadata as Record<string, unknown>)
        : {};
    const runState = summarizeCatalogRunState(readCatalogRunState(metadata));
    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
      _count: brand._count,
      runState,
    };
  });

  const nextBrand = brandsWithState.find((brand) => brand.runState?.status !== "completed") ?? null;

  return NextResponse.json({ brands: brandsWithState, nextBrandId: nextBrand?.id ?? null });
}
