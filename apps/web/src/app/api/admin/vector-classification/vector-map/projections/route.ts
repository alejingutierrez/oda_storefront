import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";
import { getProjectedCentroids } from "@/lib/vector-classification/projections";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const level = searchParams.get("level") as "category" | "subcategory" | null;
    const category = searchParams.get("category") || null;

    if (!level || !["category", "subcategory"].includes(level)) {
      return NextResponse.json(
        { error: "level must be 'category' or 'subcategory'" },
        { status: 400 },
      );
    }

    const taxonomy = await getPublishedTaxonomyOptions();

    const allLabels: Record<string, string> = {
      ...taxonomy.categoryLabels,
      ...taxonomy.subcategoryLabels,
    };

    const projections = await getProjectedCentroids({
      level,
      category,
      taxonomyLabels: allLabels,
      categoryMenuGroups: taxonomy.categoryMenuGroups,
    });

    return NextResponse.json({ projections });
  } catch (error) {
    console.error("[vector-map/projections] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
