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
    const [subcategoryRun, genderRun, subcategoryCentroidCount, genderCentroidCount] =
      await Promise.all([
        prisma.vectorModelRun.findFirst({
          where: { modelType: "subcategory" },
          orderBy: { startedAt: "desc" },
        }),
        prisma.vectorModelRun.findFirst({
          where: { modelType: "gender" },
          orderBy: { startedAt: "desc" },
        }),
        prisma.subcategoryCentroid.count(),
        prisma.genderCentroid.count(),
      ]);

    return NextResponse.json({
      subcategoryModel: {
        lastRun: subcategoryRun,
        centroidCount: subcategoryCentroidCount,
        totalSamples: subcategoryRun?.totalSamples ?? 0,
      },
      genderModel: {
        lastRun: genderRun,
        centroidCount: genderCentroidCount,
        totalSamples: genderRun?.totalSamples ?? 0,
      },
    });
  } catch (error) {
    console.error("[vector-classification/model/status] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
