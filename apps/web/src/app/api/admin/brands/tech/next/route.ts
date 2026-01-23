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
    const reviewReason =
      typeof existingMetadata.catalog_extract_review === "object" &&
      existingMetadata.catalog_extract_review &&
      !Array.isArray(existingMetadata.catalog_extract_review)
        ? (existingMetadata.catalog_extract_review as { reason?: string }).reason
        : null;
    const deleteSignals = new Set([
      "social",
      "bot_protection",
      "unreachable",
      "parked_domain",
      "landing_no_store",
      "no_store",
      "no_pdp_candidates",
    ]);
    const shouldDelete =
      profile.risks?.some((risk) => deleteSignals.has(risk)) ||
      ["manual_review_no_products", "manual_review_vtex_no_products"].includes(reviewReason ?? "");

    if (shouldDelete) {
      await prisma.brand.delete({ where: { id: brand.id } });
      return NextResponse.json({
        status: "deleted",
        brandId: brand.id,
        brandName: brand.name,
        platform: profile.platform,
        reasons: {
          risks: profile.risks ?? [],
          reviewReason: reviewReason ?? null,
        },
      });
    }

    const nextMetadata = {
      ...existingMetadata,
      tech_profile: {
        ...profile,
        capturedAt: new Date().toISOString(),
      },
    };
    const shouldManualReview = profile.risks?.some((risk) =>
      ["parked_domain", "unreachable", "missing_site_url"].includes(risk),
    );

    await prisma.brand.update({
      where: { id: brand.id },
      data: {
        ecommercePlatform: profile.platform,
        metadata: nextMetadata,
        manualReview: shouldManualReview ? true : brand.manualReview,
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
