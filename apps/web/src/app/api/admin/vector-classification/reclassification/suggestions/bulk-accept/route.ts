import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { acceptSuggestion } from "@/lib/vector-classification/reclassification";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 300;

const resolveAdminUserId = (admin: unknown): string | null => {
  if (!admin || typeof admin !== "object") return null;
  if (!("id" in admin)) return null;
  const id = (admin as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      modelType?: string;
      toSubcategory?: string;
      search?: string;
      material?: string;
      occasion?: string;
    } | null;

    const userId = resolveAdminUserId(admin) ?? "unknown";

    // Build filter matching the GET suggestions endpoint
    const productWhere: Record<string, unknown> = {};
    if (body?.search) productWhere.name = { contains: body.search, mode: "insensitive" as const };
    if (body?.material) productWhere.materialTags = { has: body.material };
    if (body?.occasion) productWhere.occasionTags = { has: body.occasion };

    const where: Prisma.VectorReclassificationSuggestionWhereInput = {
      status: "pending",
      ...(body?.modelType ? { modelType: body.modelType } : {}),
      ...(body?.toSubcategory ? { toSubcategory: body.toSubcategory } : {}),
      ...(Object.keys(productWhere).length > 0 ? { product: productWhere } : {}),
    };

    const suggestions = await prisma.vectorReclassificationSuggestion.findMany({
      where,
      select: { id: true },
      orderBy: { confidence: "desc" },
    });

    let accepted = 0;
    let failed = 0;

    for (const { id } of suggestions) {
      try {
        await acceptSuggestion(id, userId, true);
        accepted++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      accepted,
      failed,
      total: suggestions.length,
    });
  } catch (error) {
    console.error(
      "[vector-classification/reclassification/suggestions/bulk-accept] POST error:",
      error,
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
