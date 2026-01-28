import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findLatestRun, summarizeRun } from "@/lib/product-enrichment/run-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const brandId = url.searchParams.get("brandId") ?? undefined;
  const scope = scopeParam === "brand" || scopeParam === "all" ? scopeParam : brandId ? "brand" : "all";

  const run = await findLatestRun({ scope, brandId });
  const summary = run ? await summarizeRun(run.id) : null;
  let itemCounts: Record<string, number> | null = null;
  if (run) {
    const items = await prisma.productEnrichmentItem.groupBy({
      by: ["status"],
      where: { runId: run.id },
      _count: { _all: true },
    });
    const map: Record<string, number> = {};
    let total = 0;
    items.forEach((row) => {
      const count = row._count._all ?? 0;
      map[row.status] = count;
      total += count;
    });
    map.total = total;
    itemCounts = map;
  }
  const filters: Prisma.Sql[] = [];
  if (scope === "brand" && brandId) {
    filters.push(Prisma.sql`"brandId" = ${brandId}`);
  }
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.sql``;
  const [counts] = await prisma.$queryRaw<{ total: number; enriched: number }[]>(
    Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ("metadata" -> 'enrichment') IS NOT NULL)::int AS enriched
      FROM "products"
      ${where}
    `,
  );
  const total = counts?.total ?? 0;
  const enriched = counts?.enriched ?? 0;
  const remaining = Math.max(0, total - enriched);

  return NextResponse.json({
    summary,
    run: run
      ? {
          id: run.id,
          status: run.status,
          scope: run.scope,
          brandId: run.brandId,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          finishedAt: run.finishedAt,
        }
      : null,
    itemCounts,
    counts: {
      total,
      enriched,
      remaining,
    },
  });
}
