import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getAllCentroids } from "@/lib/vector-classification/centroids";
import type { ModelType } from "@/lib/vector-classification/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const modelType = (searchParams.get("modelType") || "subcategory") as ModelType;

    if (modelType !== "subcategory" && modelType !== "gender") {
      return NextResponse.json(
        { error: "modelType must be 'subcategory' or 'gender'" },
        { status: 400 },
      );
    }

    const centroids = await getAllCentroids(modelType);
    return NextResponse.json({ centroids });
  } catch (error) {
    console.error("[vector-classification/model/centroids] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
