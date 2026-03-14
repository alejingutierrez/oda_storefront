import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { centroidIds, level = "subcategory" } = body as {
      centroidIds: string[];
      level?: "category" | "subcategory";
    };

    if (!Array.isArray(centroidIds) || centroidIds.length < 2 || centroidIds.length > 10) {
      return NextResponse.json(
        { error: "centroidIds must be an array of 2-10 IDs" },
        { status: 400 },
      );
    }

    const table = level === "category" ? "category_centroids" : "subcategory_centroids";
    const labelCol = level === "category" ? "category" : "subcategory";

    const distances = await prisma.$queryRawUnsafe<
      {
        a_id: string;
        b_id: string;
        a_label: string;
        b_label: string;
        distance: number;
      }[]
    >(
      `SELECT
         a.id AS a_id,
         b.id AS b_id,
         a."${labelCol}" AS a_label,
         b."${labelCol}" AS b_label,
         (a.centroid_embedding <=> b.centroid_embedding) AS distance
       FROM ${table} a
       CROSS JOIN ${table} b
       WHERE a.id = ANY($1)
         AND b.id = ANY($1)
         AND a.id < b.id
       ORDER BY distance ASC`,
      centroidIds,
    );

    return NextResponse.json({
      distances: distances.map((d) => ({
        a: d.a_id,
        b: d.b_id,
        aLabel: d.a_label,
        bLabel: d.b_label,
        distance: d.distance,
      })),
    });
  } catch (error) {
    console.error("[vector-map/distances] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
