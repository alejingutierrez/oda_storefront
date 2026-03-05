import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { buildEffectiveVariantPriceCopExpr } from "@/lib/catalog-query";
import {
  getDisplayRoundingUnitCop,
  getFxRatesToCop,
  getPricingConfig,
  getSupportedCurrencies,
} from "@/lib/pricing";
import { CATALOG_MAX_VALID_PRICE } from "@/lib/catalog-price";
import { shouldApplyMarketingRounding, toDisplayedCop } from "@/lib/price-display";
import { isRealStyleKey } from "@/lib/real-style/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const parsePositiveInt = (value: string | null, fallback: number) => {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  const realStyle = params.get("realStyle");
  if (!realStyle || !isRealStyleKey(realStyle)) {
    return NextResponse.json({ error: "invalid_real_style" }, { status: 400 });
  }

  const pricingConfig = await getPricingConfig();
  const pricing = {
    fxRatesToCop: getFxRatesToCop(pricingConfig),
    supportedCurrencies: getSupportedCurrencies(pricingConfig),
  };
  const displayUnitCop = getDisplayRoundingUnitCop(pricingConfig);
  const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricing);

  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = Math.min(60, Math.max(1, parsePositiveInt(params.get("pageSize"), 36)));
  const offset = Math.max(0, (page - 1) * pageSize);

  const searchQuery = params.get("q")?.trim() || null;

  const searchCondition = searchQuery
    ? Prisma.sql`AND (p.name ILIKE ${"%" + searchQuery + "%"} OR b.name ILIKE ${"%" + searchQuery + "%"})`
    : Prisma.empty;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        category: string | null;
        realStyle: string;
        editorialFavoriteRank: number | null;
        editorialTopPickRank: number | null;
        sourceUrl: string | null;
        minPrice: string | null;
        maxPrice: string | null;
        currency: string | null;
        brandOverrideUsd: boolean;
      }>
    >(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name AS "brandName",
        p.category,
        p."real_style" AS "realStyle",
        p."editorialFavoriteRank",
        p."editorialTopPickRank",
        p."sourceUrl",
        (
          SELECT min(CASE WHEN ${priceCopExpr} > 0 AND ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} THEN ${priceCopExpr} END)
          FROM variants v
          WHERE v."productId" = p.id
        ) AS "minPrice",
        (
          SELECT max(CASE WHEN ${priceCopExpr} > 0 AND ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} THEN ${priceCopExpr} END)
          FROM variants v
          WHERE v."productId" = p.id
        ) AS "maxPrice",
        p.currency AS currency,
        (upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD') AS "brandOverrideUsd"
      FROM products p
      JOIN brands b ON b.id = p."brandId"
      WHERE p."real_style" = ${realStyle}
        AND p."hasInStock" = true
        AND p."imageCoverUrl" IS NOT NULL
        ${searchCondition}
      ORDER BY
        CASE WHEN p."editorialTopPickRank" IS NOT NULL THEN 0 WHEN p."editorialFavoriteRank" IS NOT NULL THEN 1 ELSE 2 END,
        COALESCE(p."editorialTopPickRank", p."editorialFavoriteRank", 999999),
        p.name ASC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT count(*) AS total
      FROM products p
      JOIN brands b ON b.id = p."brandId"
      WHERE p."real_style" = ${realStyle}
        AND p."hasInStock" = true
        AND p."imageCoverUrl" IS NOT NULL
        ${searchCondition}
    `),
  ]);

  const totalCount = Number(countRows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasMore = page < totalPages;

  const toDisplay = (input: { value: string | null; sourceCurrency: string | null; brandOverrideUsd: boolean }) => {
    const numeric = input.value ? Number(input.value) : null;
    const applyMarketingRounding = shouldApplyMarketingRounding({
      brandOverride: input.brandOverrideUsd,
      sourceCurrency: input.sourceCurrency,
    });
    const displayed = toDisplayedCop({
      effectiveCop: numeric,
      applyMarketingRounding,
      unitCop: displayUnitCop,
    });
    return displayed ? String(displayed) : null;
  };

  return NextResponse.json({
    page,
    pageSize,
    totalCount,
    totalPages,
    hasMore,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      imageCoverUrl: row.imageCoverUrl,
      brandName: row.brandName,
      category: row.category,
      realStyle: row.realStyle,
      editorialFavoriteRank: row.editorialFavoriteRank,
      editorialTopPickRank: row.editorialTopPickRank,
      sourceUrl: row.sourceUrl,
      minPrice: toDisplay({
        value: row.minPrice,
        sourceCurrency: row.currency,
        brandOverrideUsd: row.brandOverrideUsd,
      }),
      maxPrice: toDisplay({
        value: row.maxPrice,
        sourceCurrency: row.currency,
        brandOverrideUsd: row.brandOverrideUsd,
      }),
      currency: "COP",
    })),
  });
}
