import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findLatestRun, summarizeRun } from "@/lib/product-enrichment/run-store";
import { finalizeRunIfDone } from "@/lib/product-enrichment/processor";

export const runtime = "nodejs";

const readJsonRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const brandId = url.searchParams.get("brandId") ?? undefined;
  const scope = scopeParam === "brand" || scopeParam === "all" ? scopeParam : brandId ? "brand" : "all";

  let run = await findLatestRun({ scope, brandId });
  if (run && run.status === "processing") {
    await finalizeRunIfDone(run.id);
    run = await findLatestRun({ scope, brandId });
  }
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
  const [counts] = await prisma.$queryRaw<
    Array<{ total: number; enriched: number; low_confidence: number; review_required: number }>
  >(
    Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ("metadata" -> 'enrichment') IS NOT NULL)::int AS enriched,
        COUNT(*) FILTER (
          WHERE ("metadata" -> 'enrichment' ->> 'review_required') = 'true'
        )::int AS review_required,
        COUNT(*) FILTER (
          WHERE
            ("metadata" -> 'enrichment' -> 'confidence' ->> 'overall') ~ '^[0-9]+(\\.[0-9]+)?$'
            AND (("metadata" -> 'enrichment' -> 'confidence' ->> 'overall')::double precision) < 0.70
        )::int AS low_confidence
      FROM "products"
      ${where}
    `,
  );
  const total = counts?.total ?? 0;
  const enriched = counts?.enriched ?? 0;
  const remaining = Math.max(0, total - enriched);
  const lowConfidence = counts?.low_confidence ?? 0;
  const reviewRequired = counts?.review_required ?? 0;

  return NextResponse.json({
    summary,
    run: run
      ? (() => {
          const metadata = readJsonRecord(run.metadata);
          const provider = typeof metadata.provider === "string" ? metadata.provider : null;
          const model = typeof metadata.model === "string" ? metadata.model : null;
          const promptVersion =
            typeof metadata.prompt_version === "string" ? metadata.prompt_version : null;
          const schemaVersion =
            typeof metadata.schema_version === "string" ? metadata.schema_version : null;
          const createdBy = typeof metadata.created_by === "string" ? metadata.created_by : null;
          const autoStart = metadata.auto_start;
          const requestedItems =
            typeof metadata.requested_items === "number"
              ? metadata.requested_items
              : Number(metadata.requested_items ?? 0) || null;
          const selectedItems =
            typeof metadata.selected_items === "number"
              ? metadata.selected_items
              : Number(metadata.selected_items ?? 0) || null;
          const insufficientPending =
            typeof metadata.insufficient_pending === "boolean"
              ? metadata.insufficient_pending
              : metadata.insufficient_pending === "true";
          return {
            id: run.id,
            status: run.status,
            scope: run.scope,
            brandId: run.brandId,
            startedAt: run.startedAt,
            updatedAt: run.updatedAt,
            finishedAt: run.finishedAt,
            provider,
            model,
            promptVersion,
            schemaVersion,
            createdBy,
            autoStart: typeof autoStart === "boolean" ? autoStart : autoStart === "true",
            requestedItems,
            selectedItems,
            insufficientPending,
          };
        })()
      : null,
    itemCounts,
    counts: {
      total,
      enriched,
      remaining,
      lowConfidence,
      reviewRequired,
    },
  });
}
