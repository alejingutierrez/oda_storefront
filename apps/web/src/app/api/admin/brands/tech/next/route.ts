import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { profileBrandTechnology } from "@/lib/brand-tech-profiler";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const force = !!body?.force;

  const brand = await prisma.brand.findFirst({
    where: {
      isActive: true,
      siteUrl: { not: null },
      ...(force ? {} : { ecommercePlatform: null }),
    },
    orderBy: { updatedAt: "asc" },
  });

  if (!brand) {
    return NextResponse.json({ status: "empty" });
  }

  try {
    const profile = await profileBrandTechnology(brand);
    const existingMetadata =
      brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
        ? (brand.metadata as Record<string, unknown>)
        : {};

    const nextMetadata = {
      ...existingMetadata,
      tech_profile: {
        ...profile,
        capturedAt: new Date().toISOString(),
      },
    };

    await prisma.brand.update({
      where: { id: brand.id },
      data: {
        ecommercePlatform: profile.platform,
        metadata: nextMetadata,
      },
    });

    return NextResponse.json({
      status: "completed",
      brandId: brand.id,
      brandName: brand.name,
      platform: profile.platform,
      confidence: profile.confidence,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "failed",
        brandId: brand.id,
        brandName: brand.name,
        error: error instanceof Error ? error.message : "Error inesperado",
      },
      { status: 500 },
    );
  }
}
