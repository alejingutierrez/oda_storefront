import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "pending";
    const modelType = searchParams.get("modelType") || undefined;
    const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("limit")) || 40)));
    const search = searchParams.get("search")?.trim() || undefined;
    const brand = searchParams.get("brand")?.trim() || undefined;
    const toSubcategory = searchParams.get("toSubcategory")?.trim() || undefined;
    const material = searchParams.get("material")?.trim() || undefined;
    const occasion = searchParams.get("occasion")?.trim() || undefined;

    const where = {
      status: status || undefined,
      modelType: modelType || undefined,
      ...(toSubcategory ? { toSubcategory } : {}),
      product: {
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
        ...(brand
          ? { brand: { name: { contains: brand, mode: "insensitive" as const } } }
          : {}),
        ...(material ? { materialTags: { has: material } } : {}),
        ...(occasion ? { occasionTags: { has: occasion } } : {}),
      },
    };

    const [suggestions, total, pendingCount, acceptedCount, rejectedCount] =
      await Promise.all([
        prisma.vectorReclassificationSuggestion.findMany({
          where,
          include: {
            product: {
              select: {
                name: true,
                imageCoverUrl: true,
                sourceUrl: true,
                brand: { select: { name: true } },
                materialTags: true,
                occasionTags: true,
              },
            },
          },
          orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.vectorReclassificationSuggestion.count({ where }),
        prisma.vectorReclassificationSuggestion.count({
          where: { status: "pending" },
        }),
        prisma.vectorReclassificationSuggestion.count({
          where: { status: "accepted" },
        }),
        prisma.vectorReclassificationSuggestion.count({
          where: { status: "rejected" },
        }),
      ]);

    return NextResponse.json({
      suggestions,
      total,
      page,
      hasMore: page * limit < total,
      counts: {
        pending: pendingCount,
        accepted: acceptedCount,
        rejected: rejectedCount,
      },
    });
  } catch (error) {
    console.error(
      "[vector-classification/reclassification/suggestions] GET error:",
      error,
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
