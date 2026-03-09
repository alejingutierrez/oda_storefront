import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import {
  trainCategoryCentroids,
  trainSubcategoryCentroids,
  trainGenderCentroids,
} from "@/lib/vector-classification/centroids";
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
      category?: string;
    } | null;

    const modelType = body?.modelType as ModelType | undefined;
    if (!modelType || !VALID_MODEL_TYPES.includes(modelType)) {
      return NextResponse.json(
        { error: "modelType must be 'category', 'subcategory', or 'gender'" },
        { status: 400 },
      );
    }

    let result;
    if (modelType === "category") {
      result = await trainCategoryCentroids();
    } else if (modelType === "subcategory") {
      result = await trainSubcategoryCentroids(body?.category);
    } else {
      result = await trainGenderCentroids();
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[vector-classification/model/train] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
