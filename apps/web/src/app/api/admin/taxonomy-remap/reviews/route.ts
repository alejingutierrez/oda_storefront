import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTaxonomyAutoReseedPhaseState } from "@/lib/taxonomy-remap/auto-reseed";

export const runtime = "nodejs";

type StatusFilter = "pending" | "accepted" | "rejected" | "all";
type ChangeTypeFilter = "all" | "taxonomy" | "gender_only";

type ReviewRow = {
  id: string;
  status: string;
  source: string | null;
  runKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  decisionError: string | null;
  fromCategory: string | null;
  fromSubcategory: string | null;
  fromGender: string | null;
  toCategory: string | null;
  toSubcategory: string | null;
  toGender: string | null;
  confidence: number | null;
  reasons: unknown;
  seoCategoryHints: unknown;
  sourceCount: number | null;
  scoreSupport: number | null;
  marginRatio: number | null;
  imageCoverUrl: string | null;
  sourceUrl: string | null;
  productId: string;
  productName: string;
  brandId: string;
  brandName: string | null;
  changeType: string;
};

type CountRow = {
  status: string;
  total: number;
};

type ChangeCountRow = {
  changeType: string;
  total: number;
};

type CatalogCounters = {
  totalProducts: number;
  reviewedProducts: number;
  pendingProducts: number;
  eligibleProducts: number;
  eligibleReviewedProducts: number;
  eligiblePendingProducts: number;
};

type ProposalInput = {
  productId: string;
  fromCategory?: string | null;
  fromSubcategory?: string | null;
  fromGender?: string | null;
  toCategory?: string | null;
  toSubcategory?: string | null;
  toGender?: string | null;
  confidence?: number | null;
  reasons?: string[];
  seoCategoryHints?: string[];
  sourceCount?: number | null;
  scoreSupport?: number | null;
  marginRatio?: number | null;
  imageCoverUrl?: string | null;
  sourceUrl?: string | null;
  source?: string | null;
  runKey?: string | null;
};

const parseStatus = (raw: string | null): StatusFilter => {
  if (!raw) return "pending";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "pending" || normalized === "accepted" || normalized === "rejected" || normalized === "all") {
    return normalized;
  }
  return "pending";
};

const parseChangeType = (raw: string | null): ChangeTypeFilter => {
  if (!raw) return "all";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all" || normalized === "taxonomy" || normalized === "gender_only") {
    return normalized;
  }
  return "all";
};

const parseIntParam = (raw: string | null, fallback: number, max: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 60);
};

const toNullableText = (value: unknown) => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 4000) : null;
};

const toNullableNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const changeType = parseChangeType(url.searchParams.get("changeType"));
  const brandId = toNullableText(url.searchParams.get("brandId"));
  const search = toNullableText(url.searchParams.get("search"));
  const page = parseIntParam(url.searchParams.get("page"), 1, 100000);
  const limit = parseIntParam(url.searchParams.get("limit"), 40, 200);
  const offset = (page - 1) * limit;

  const taxonomyChangedSql = Prisma.sql`(
    COALESCE(r."toCategory", '') <> COALESCE(r."fromCategory", '')
    OR COALESCE(r."toSubcategory", '') <> COALESCE(r."fromSubcategory", '')
  )`;
  const genderChangedSql = Prisma.sql`(
    COALESCE(r."toGender", '') <> COALESCE(r."fromGender", '')
  )`;

  const filters: Prisma.Sql[] = [];
  if (status !== "all") {
    filters.push(Prisma.sql`r."status" = ${status}`);
  }
  if (changeType === "taxonomy") {
    filters.push(taxonomyChangedSql);
  } else if (changeType === "gender_only") {
    filters.push(Prisma.sql`(${genderChangedSql}) AND NOT (${taxonomyChangedSql})`);
  }
  if (brandId) {
    filters.push(Prisma.sql`b.id = ${brandId}`);
  }
  if (search) {
    const like = `%${search}%`;
    filters.push(
      Prisma.sql`(
        p.name ILIKE ${like}
        OR b.name ILIKE ${like}
        OR COALESCE(r."toCategory", '') ILIKE ${like}
        OR COALESCE(r."toSubcategory", '') ILIKE ${like}
        OR COALESCE(r."toGender", '') ILIKE ${like}
      )`,
    );
  }

  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const [rows, totalRows, groupedCounts, groupedByChangeType, phaseState, catalogCountersRow] = await Promise.all([
    prisma.$queryRaw<ReviewRow[]>(Prisma.sql`
      SELECT
        r.id,
        r."status",
        r."source",
        r."runKey",
        r."createdAt",
        r."updatedAt",
        r."decidedAt",
        r."decisionNote",
        r."decisionError",
        r."fromCategory",
        r."fromSubcategory",
        r."fromGender",
        r."toCategory",
        r."toSubcategory",
        r."toGender",
        r."confidence",
        r."reasons",
        r."seoCategoryHints",
        r."sourceCount",
        r."scoreSupport",
        r."marginRatio",
        COALESCE(r."imageCoverUrl", p."imageCoverUrl") AS "imageCoverUrl",
        COALESCE(r."sourceUrl", p."sourceUrl") AS "sourceUrl",
        p.id AS "productId",
        p.name AS "productName",
        b.id AS "brandId",
        b.name AS "brandName",
        CASE
          WHEN ${taxonomyChangedSql} THEN 'taxonomy'
          WHEN ${genderChangedSql} THEN 'gender_only'
          ELSE 'none'
        END AS "changeType"
      FROM "taxonomy_remap_reviews" r
      JOIN "products" p ON p.id = r."productId"
      JOIN "brands" b ON b.id = p."brandId"
      ${whereSql}
      ORDER BY
        CASE r."status" WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
        r."createdAt" DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "taxonomy_remap_reviews" r
      JOIN "products" p ON p.id = r."productId"
      JOIN "brands" b ON b.id = p."brandId"
      ${whereSql}
    `),
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT r."status", COUNT(*)::int AS total
      FROM "taxonomy_remap_reviews" r
      GROUP BY r."status"
    `),
    prisma.$queryRaw<ChangeCountRow[]>(Prisma.sql`
      SELECT
        CASE
          WHEN ${taxonomyChangedSql} THEN 'taxonomy'
          WHEN ${genderChangedSql} THEN 'gender_only'
          ELSE 'none'
        END AS "changeType",
        COUNT(*)::int AS total
      FROM "taxonomy_remap_reviews" r
      JOIN "products" p ON p.id = r."productId"
      JOIN "brands" b ON b.id = p."brandId"
      ${whereSql}
      GROUP BY 1
    `),
    getTaxonomyAutoReseedPhaseState(),
    prisma.$queryRaw<CatalogCounters[]>(Prisma.sql`
      WITH review_by_product AS (
        SELECT
          r."productId",
          BOOL_OR(r."status" = 'pending') AS has_pending,
          BOOL_OR(r."status" IN ('accepted', 'rejected')) AS has_decision
        FROM "taxonomy_remap_reviews" r
        GROUP BY r."productId"
      ),
      eligible_products AS (
        SELECT p.id
        FROM "products" p
        WHERE (p.metadata -> 'enrichment') IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM "products") AS "totalProducts",
        COALESCE((SELECT COUNT(*)::int FROM review_by_product WHERE has_decision), 0) AS "reviewedProducts",
        COALESCE((SELECT COUNT(*)::int FROM review_by_product WHERE has_pending), 0) AS "pendingProducts"
        ,
        (SELECT COUNT(*)::int FROM eligible_products) AS "eligibleProducts",
        COALESCE((
          SELECT COUNT(*)::int
          FROM review_by_product rb
          JOIN eligible_products e ON e.id = rb."productId"
          WHERE rb.has_decision
        ), 0) AS "eligibleReviewedProducts",
        COALESCE((
          SELECT COUNT(*)::int
          FROM review_by_product rb
          JOIN eligible_products e ON e.id = rb."productId"
          WHERE rb.has_pending
        ), 0) AS "eligiblePendingProducts"
    `),
  ]);

  const total = totalRows[0]?.total ?? 0;
  const statusCounts = {
    pending: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const row of groupedCounts) {
    if (row.status === "pending" || row.status === "accepted" || row.status === "rejected") {
      statusCounts[row.status] = Number(row.total || 0);
    }
  }
  const changeSummary = {
    taxonomy: 0,
    gender_only: 0,
    none: 0,
  };
  for (const row of groupedByChangeType) {
    if (row.changeType === "taxonomy" || row.changeType === "gender_only" || row.changeType === "none") {
      changeSummary[row.changeType] = Number(row.total || 0);
    }
  }

  const catalogCounters = catalogCountersRow[0] ?? {
    totalProducts: 0,
    reviewedProducts: 0,
    pendingProducts: 0,
    eligibleProducts: 0,
    eligibleReviewedProducts: 0,
    eligiblePendingProducts: 0,
  };
  const catalogRemaining = Math.max(
    0,
    Number(catalogCounters.totalProducts || 0) - Number(catalogCounters.reviewedProducts || 0),
  );
  const eligibleRemaining = Math.max(
    0,
    Number(catalogCounters.eligibleProducts || 0) - Number(catalogCounters.eligibleReviewedProducts || 0),
  );

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      source: row.source,
      runKey: row.runKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
      decisionError: row.decisionError,
      fromCategory: row.fromCategory,
      fromSubcategory: row.fromSubcategory,
      fromGender: row.fromGender,
      toCategory: row.toCategory,
      toSubcategory: row.toSubcategory,
      toGender: row.toGender,
      confidence: row.confidence,
      reasons: toStringArray(row.reasons),
      seoCategoryHints: toStringArray(row.seoCategoryHints),
      sourceCount: row.sourceCount,
      scoreSupport: row.scoreSupport,
      marginRatio: row.marginRatio,
      imageCoverUrl: row.imageCoverUrl,
      sourceUrl: row.sourceUrl,
      productId: row.productId,
      productName: row.productName,
      brandId: row.brandId,
      brandName: row.brandName,
      changeType: row.changeType,
    })),
    summary: statusCounts,
    pagination: {
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    },
    filters: {
      status,
      changeType,
      brandId,
      search,
    },
    changeSummary,
    phase: phaseState,
    catalog: {
      totalProducts: Number(catalogCounters.totalProducts || 0),
      reviewedProducts: Number(catalogCounters.reviewedProducts || 0),
      pendingProducts: Number(catalogCounters.pendingProducts || 0),
      remainingProducts: catalogRemaining,
      eligibleProducts: Number(catalogCounters.eligibleProducts || 0),
      eligibleReviewedProducts: Number(catalogCounters.eligibleReviewedProducts || 0),
      eligiblePendingProducts: Number(catalogCounters.eligiblePendingProducts || 0),
      eligibleRemainingProducts: eligibleRemaining,
    },
  });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { items?: ProposalInput[]; source?: string | null; runKey?: string | null }
    | null;

  const rawItems = Array.isArray(body?.items) ? body?.items : [];
  if (!rawItems.length) {
    return NextResponse.json({ error: "items is required" }, { status: 400 });
  }

  const items = rawItems
    .map((item) => ({
      productId: toNullableText(item.productId),
      fromCategory: toNullableText(item.fromCategory),
      fromSubcategory: toNullableText(item.fromSubcategory),
      fromGender: toNullableText(item.fromGender),
      toCategory: toNullableText(item.toCategory),
      toSubcategory: toNullableText(item.toSubcategory),
      toGender: toNullableText(item.toGender),
      confidence: toNullableNumber(item.confidence),
      reasons: toStringArray(item.reasons),
      seoCategoryHints: toStringArray(item.seoCategoryHints),
      sourceCount: toNullableNumber(item.sourceCount),
      scoreSupport: toNullableNumber(item.scoreSupport),
      marginRatio: toNullableNumber(item.marginRatio),
      imageCoverUrl: toNullableText(item.imageCoverUrl),
      sourceUrl: toNullableText(item.sourceUrl),
      source: toNullableText(item.source),
      runKey: toNullableText(item.runKey),
    }))
    .filter((item) => item.productId)
    .slice(0, 3000);

  if (!items.length) {
    return NextResponse.json({ error: "no valid items" }, { status: 400 });
  }

  const defaultSource = toNullableText(body?.source) ?? "taxonomy_remap";
  const defaultRunKey = toNullableText(body?.runKey);

  const createdIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.$executeRaw(
        Prisma.sql`
          DELETE FROM "taxonomy_remap_reviews"
          WHERE "productId" = ${item.productId}
            AND "status" = 'pending'
        `,
      );

      const inserted = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          INSERT INTO "taxonomy_remap_reviews" (
            "id", "status", "source", "runKey", "productId",
            "fromCategory", "fromSubcategory", "fromGender",
            "toCategory", "toSubcategory", "toGender",
            "confidence", "reasons", "seoCategoryHints",
            "sourceCount", "scoreSupport", "marginRatio",
            "imageCoverUrl", "sourceUrl", "createdAt", "updatedAt"
          )
          VALUES (
            ${randomUUID()},
            'pending',
            ${item.source ?? defaultSource},
            ${item.runKey ?? defaultRunKey},
            ${item.productId},
            ${item.fromCategory},
            ${item.fromSubcategory},
            ${item.fromGender},
            ${item.toCategory},
            ${item.toSubcategory},
            ${item.toGender},
            ${item.confidence},
            ${item.reasons},
            ${item.seoCategoryHints},
            ${item.sourceCount === null ? null : Math.floor(item.sourceCount)},
            ${item.scoreSupport},
            ${item.marginRatio},
            ${item.imageCoverUrl},
            ${item.sourceUrl},
            NOW(),
            NOW()
          )
          RETURNING "id"
        `,
      );
      if (inserted[0]?.id) createdIds.push(inserted[0].id);
    }
  });

  return NextResponse.json({
    ok: true,
    created: createdIds.length,
    skipped: rawItems.length - createdIds.length,
  });
}
