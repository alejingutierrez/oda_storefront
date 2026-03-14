import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { previewMerge } from "@/lib/vector-classification/merge";
import type { MergeType } from "@/lib/vector-classification/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { mergeType, sourceKeys, targetKey, targetCategory } = body as {
      mergeType: MergeType;
      sourceKeys: string[];
      targetKey: string;
      targetCategory?: string;
    };

    if (!mergeType || !["subcategory", "category"].includes(mergeType)) {
      return NextResponse.json(
        { error: "mergeType must be 'subcategory' or 'category'" },
        { status: 400 },
      );
    }

    if (!Array.isArray(sourceKeys) || sourceKeys.length === 0) {
      return NextResponse.json({ error: "sourceKeys is required" }, { status: 400 });
    }

    if (!targetKey) {
      return NextResponse.json({ error: "targetKey is required" }, { status: 400 });
    }

    if (sourceKeys.includes(targetKey)) {
      return NextResponse.json(
        { error: "targetKey cannot be in sourceKeys" },
        { status: 400 },
      );
    }

    const preview = await previewMerge({
      mergeType,
      sourceKeys,
      targetKey,
      targetCategory,
    });

    return NextResponse.json(preview);
  } catch (error) {
    console.error("[vector-map/merge/preview] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
