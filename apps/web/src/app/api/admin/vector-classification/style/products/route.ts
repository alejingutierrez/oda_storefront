import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRealStyleKey, REAL_STYLE_KEYS } from "@/lib/real-style/constants";
import { getStyleProfiles } from "@/lib/taxonomy/server";
import { buildRealStyleSuggestionContext, suggestRealStyle } from "@/lib/real-style/suggestion";

export const runtime = "nodejs";

/* ── Suggestion context cache (module-scoped) ── */
let cachedCtx: { ctx: ReturnType<typeof buildRealStyleSuggestionContext>; expiresAt: number } | null = null;
let ctxInFlight: Promise<ReturnType<typeof buildRealStyleSuggestionContext>> | null = null;

async function getSuggestionCtx() {
  if (cachedCtx && cachedCtx.expiresAt > Date.now()) return cachedCtx.ctx;
  if (ctxInFlight) return ctxInFlight;
  ctxInFlight = (async () => {
    const profiles = await getStyleProfiles();
    const ctx = buildRealStyleSuggestionContext(profiles);
    cachedCtx = { ctx, expiresAt: Date.now() + 5 * 60 * 1000 };
    return ctx;
  })();
  try {
    return await ctxInFlight;
  } finally {
    ctxInFlight = null;
  }
}

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") || "sin_asignar";
    const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
    const limit = Math.min(120, Math.max(1, Math.floor(Number(searchParams.get("limit")) || 60)));
    const offset = (page - 1) * limit;

    const styleFilter =
      filter === "sin_asignar"
        ? Prisma.sql`AND p."real_style" IS NULL`
        : isRealStyleKey(filter)
          ? Prisma.sql`AND p."real_style" = ${filter}`
          : Prisma.sql`AND p."real_style" IS NULL`;

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        imageCoverUrl: string | null;
        brandName: string;
        realStyle: string | null;
        stylePrimary: string | null;
        styleTags: string[];
      }>
    >(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p."imageCoverUrl",
        b.name AS "brandName",
        p."real_style" AS "realStyle",
        p."stylePrimary",
        p."styleTags"
      FROM products p
      JOIN brands b ON b.id = p."brandId"
      WHERE p."hasInStock" = true
        AND p."imageCoverUrl" IS NOT NULL
        AND (p."metadata" -> 'enrichment') IS NOT NULL
        ${styleFilter}
      ORDER BY p."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM products p
        WHERE p."hasInStock" = true
          AND p."imageCoverUrl" IS NOT NULL
          AND (p."metadata" -> 'enrichment') IS NOT NULL
          ${styleFilter}
      `,
    );
    const total = Number(countRows[0]?.total ?? 0);

    /* Generate suggestions for unassigned products */
    const ctx = filter === "sin_asignar" ? await getSuggestionCtx() : null;

    const products = rows.map((row) => {
      let suggestedStyle: string | null = null;
      let suggestionScore = 0;
      if (ctx && !row.realStyle) {
        const suggestion = suggestRealStyle({
          stylePrimary: row.stylePrimary,
          styleTags: Array.isArray(row.styleTags) ? row.styleTags : [],
          context: ctx,
        });
        suggestedStyle = suggestion.realStyle;
        suggestionScore = suggestion.score;
      }
      return {
        id: row.id,
        name: row.name,
        imageCoverUrl: row.imageCoverUrl,
        brandName: row.brandName,
        realStyle: row.realStyle,
        suggestedStyle,
        suggestionScore,
      };
    });

    return NextResponse.json({
      products,
      total,
      page,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("[style/products] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
