import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ bucket: string; count: bigint }>
    >(Prisma.sql`
      SELECT
        COALESCE(p.gender, 'sin_asignar') AS bucket,
        COUNT(*)::bigint AS count
      FROM products p
      WHERE (p.status = 'active' OR p.status IS NULL)
        AND p."imageCoverUrl" IS NOT NULL
      GROUP BY bucket
      ORDER BY count DESC
    `);

    const stats: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const count = Number(row.count);
      stats[row.bucket] = count;
      total += count;
    }
    stats.total = total;

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[gender/stats] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
