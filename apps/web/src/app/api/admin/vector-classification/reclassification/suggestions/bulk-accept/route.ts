import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { acceptSuggestion } from "@/lib/vector-classification/reclassification";
import { prisma } from "@/lib/prisma";

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
      minConfidence?: number;
    } | null;

    const minConfidence = body?.minConfidence;
    if (typeof minConfidence !== "number" || minConfidence < 0.5 || minConfidence > 1) {
      return NextResponse.json(
        { error: "minConfidence must be a number between 0.5 and 1.0" },
        { status: 400 },
      );
    }

    const userId = resolveAdminUserId(admin) ?? "unknown";

    // Find all pending suggestions with confidence >= threshold
    const suggestions = await prisma.vectorReclassificationSuggestion.findMany({
      where: {
        status: "pending",
        confidence: { gte: minConfidence },
      },
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
