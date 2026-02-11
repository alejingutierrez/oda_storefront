import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ReviewRow = {
  id: string;
  name: string;
  brandId: string;
  brandName: string | null;
  category: string | null;
  subcategory: string | null;
  imageCoverUrl: string | null;
  sourceUrl: string | null;
  updatedAt: Date;
  confidence_overall: string | null;
  review_reasons: unknown;
  review_required: boolean;
};

const parseBool = (value: string | null, fallback: boolean) => {
  if (value === null) return fallback;
  return value === "true";
};

const parseLimit = (value: string | null, fallback = 30) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(200, Math.floor(parsed));
};

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const brandId = url.searchParams.get("brandId");
  const scope = scopeParam === "brand" || scopeParam === "all" ? scopeParam : brandId ? "brand" : "all";
  const limit = parseLimit(url.searchParams.get("limit"), 30);
  const includeLowConfidence = parseBool(url.searchParams.get("includeLowConfidence"), true);
  const onlyReviewRequired = parseBool(url.searchParams.get("onlyReviewRequired"), false);

  const filters: Prisma.Sql[] = [Prisma.sql`(p."metadata" -> 'enrichment') IS NOT NULL`];
  if (scope === "brand" && brandId) {
    filters.push(Prisma.sql`p."brandId" = ${brandId}`);
  }

  const reviewRequiredFilter = Prisma.sql`(p."metadata" -> 'enrichment' ->> 'review_required') = 'true'`;
  const lowConfidenceFilter = Prisma.sql`
    (p."metadata" -> 'enrichment' -> 'confidence' ->> 'overall') ~ '^[0-9]+(\\.[0-9]+)?$'
    AND (p."metadata" -> 'enrichment' -> 'confidence' ->> 'overall')::double precision < 0.70
  `;

  if (onlyReviewRequired && !includeLowConfidence) {
    filters.push(reviewRequiredFilter);
  } else if (!onlyReviewRequired && includeLowConfidence) {
    filters.push(Prisma.sql`(${reviewRequiredFilter} OR (${lowConfidenceFilter}))`);
  } else if (onlyReviewRequired && includeLowConfidence) {
    filters.push(Prisma.sql`(${reviewRequiredFilter} OR (${lowConfidenceFilter}))`);
  }

  const rows = await prisma.$queryRaw<ReviewRow[]>(
    Prisma.sql`
      SELECT
        p.id,
        p.name,
        p."brandId",
        b.name AS "brandName",
        p.category,
        p.subcategory,
        p."imageCoverUrl",
        p."sourceUrl",
        p."updatedAt",
        p."metadata" -> 'enrichment' -> 'confidence' ->> 'overall' AS confidence_overall,
        COALESCE(p."metadata" -> 'enrichment' -> 'review_reasons', '[]'::jsonb) AS review_reasons,
        COALESCE((p."metadata" -> 'enrichment' ->> 'review_required') = 'true', false) AS review_required
      FROM "products" p
      LEFT JOIN "brands" b ON b.id = p."brandId"
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY
        COALESCE((p."metadata" -> 'enrichment' ->> 'review_required') = 'true', false) DESC,
        CASE
          WHEN (p."metadata" -> 'enrichment' -> 'confidence' ->> 'overall') ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN (p."metadata" -> 'enrichment' -> 'confidence' ->> 'overall')::double precision
          ELSE 999
        END ASC,
        p."updatedAt" DESC
      LIMIT ${limit}
    `,
  );

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      brandId: row.brandId,
      brandName: row.brandName,
      category: row.category,
      subcategory: row.subcategory,
      imageCoverUrl: row.imageCoverUrl,
      sourceUrl: row.sourceUrl,
      updatedAt: row.updatedAt,
      confidenceOverall:
        typeof row.confidence_overall === "string" && row.confidence_overall !== ""
          ? Number(row.confidence_overall)
          : null,
      reviewRequired: Boolean(row.review_required),
      reviewReasons: toStringArray(row.review_reasons),
    })),
    scope,
    brandId: scope === "brand" ? brandId : null,
    onlyReviewRequired,
    includeLowConfidence,
    limit,
  });
}
