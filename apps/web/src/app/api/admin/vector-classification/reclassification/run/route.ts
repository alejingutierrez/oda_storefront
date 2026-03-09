import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { runReclassificationScan } from "@/lib/vector-classification/reclassification";
import type { ModelType } from "@/lib/vector-classification/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_MODEL_TYPES: ModelType[] = ["category", "subcategory", "gender"];

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      modelType?: string;
      similarityThreshold?: number;
      minMargin?: number;
      category?: string;
    } | null;

    const modelType = body?.modelType as ModelType | undefined;
    if (!modelType || !VALID_MODEL_TYPES.includes(modelType)) {
      return NextResponse.json(
        { error: "modelType must be 'category', 'subcategory', or 'gender'" },
        { status: 400 },
      );
    }

    const result = await runReclassificationScan(modelType, {
      similarityThreshold: body?.similarityThreshold,
      minMargin: body?.minMargin,
      filterCategory: body?.category,
    });

    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      suggested: result.suggested,
    });
  } catch (error) {
    console.error("[vector-classification/reclassification/run] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
