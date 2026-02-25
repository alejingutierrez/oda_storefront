import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStyleProfiles } from "@/lib/taxonomy/server";
import {
  REAL_STYLE_KEYS,
  REAL_STYLE_LABELS,
  REAL_STYLE_OPTIONS,
  type RealStyleKey,
} from "./constants";
import { buildRealStyleSuggestionContext, suggestRealStyle } from "./suggestion";

export type RealStyleQueueItem = {
  id: string;
  name: string;
  brandName: string;
  imageCoverUrl: string | null;
  category: string | null;
  subcategory: string | null;
  stylePrimary: string | null;
  styleSecondary: string | null;
  styleTags: string[];
  sourceUrl: string | null;
  createdAt: string;
  suggestedRealStyle: RealStyleKey | null;
  suggestionSource: "style_primary" | "style_tags" | null;
  suggestionScore: number;
};

export type RealStyleQueueSummary = {
  eligibleTotal: number;
  pendingCount: number;
  assignedCount: number;
  byRealStyle: Array<{ key: RealStyleKey; label: string; order: number; count: number }>;
};

export type RealStyleCursor = {
  id: string;
  createdAt: string;
};

const ELIGIBLE_WHERE_SQL = Prisma.sql`
  p."imageCoverUrl" is not null
  and (p."metadata" -> 'enrichment') is not null
  and exists (
    select 1
    from variants v
    where v."productId" = p.id
      and (v.stock > 0 or v."stockStatus" in ('in_stock','preorder'))
  )
`;

function toNumber(value: bigint | number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parseQueueLimit(value: string | null) {
  const parsed = value ? Number(value) : 30;
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(80, Math.floor(parsed)));
}

export function encodeRealStyleCursor(cursor: RealStyleCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeRealStyleCursor(raw: string | null): RealStyleCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const id = (parsed as { id?: unknown }).id;
    const createdAt = (parsed as { createdAt?: unknown }).createdAt;
    if (typeof id !== "string" || typeof createdAt !== "string") return null;
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return { id, createdAt: date.toISOString() };
  } catch {
    return null;
  }
}

export async function getRealStyleSummary(): Promise<RealStyleQueueSummary> {
  const [totalsRows, byStyleRows] = await Promise.all([
    prisma.$queryRaw<Array<{ eligible: bigint; pending: bigint; assigned: bigint }>>(Prisma.sql`
      select
        count(*)::bigint as eligible,
        count(*) filter (where p."real_style" is null)::bigint as pending,
        count(*) filter (where p."real_style" is not null)::bigint as assigned
      from products p
      where ${ELIGIBLE_WHERE_SQL}
    `),
    prisma.$queryRaw<Array<{ realStyle: string; cnt: bigint }>>(Prisma.sql`
      select p."real_style" as "realStyle", count(*)::bigint as cnt
      from products p
      where ${ELIGIBLE_WHERE_SQL}
        and p."real_style" in (${Prisma.join(REAL_STYLE_KEYS)})
      group by p."real_style"
    `),
  ]);

  const totals = totalsRows[0];
  const byStyleMap = new Map(byStyleRows.map((row) => [row.realStyle, toNumber(row.cnt)]));

  return {
    eligibleTotal: toNumber(totals?.eligible),
    pendingCount: toNumber(totals?.pending),
    assignedCount: toNumber(totals?.assigned),
    byRealStyle: REAL_STYLE_OPTIONS.map((option) => ({
      key: option.key,
      label: REAL_STYLE_LABELS[option.key],
      order: option.order,
      count: byStyleMap.get(option.key) ?? 0,
    })),
  };
}

export async function getRealStyleQueue(params: {
  limit: number;
  cursor: RealStyleCursor | null;
}): Promise<{ items: RealStyleQueueItem[]; nextCursor: string | null; summary: RealStyleQueueSummary }> {
  const cursorClause = params.cursor
    ? Prisma.sql`
      and (
        p."createdAt" < ${new Date(params.cursor.createdAt)}
        or (p."createdAt" = ${new Date(params.cursor.createdAt)} and p.id < ${params.cursor.id})
      )
    `
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      brandName: string;
      imageCoverUrl: string | null;
      category: string | null;
      subcategory: string | null;
      stylePrimary: string | null;
      styleSecondary: string | null;
      styleTags: string[];
      sourceUrl: string | null;
      createdAt: Date;
    }>
  >(Prisma.sql`
    select
      p.id,
      p.name,
      b.name as "brandName",
      p."imageCoverUrl",
      p.category,
      p.subcategory,
      p."stylePrimary",
      p."styleSecondary",
      p."styleTags",
      p."sourceUrl",
      p."createdAt"
    from products p
    join brands b on b.id = p."brandId"
    where ${ELIGIBLE_WHERE_SQL}
      and p."real_style" is null
      ${cursorClause}
    order by p."createdAt" desc, p.id desc
    limit ${params.limit}
  `);

  const styleProfiles = await getStyleProfiles();
  const suggestionContext = buildRealStyleSuggestionContext(styleProfiles);

  const items = rows.map((row) => {
    const suggestion = suggestRealStyle({
      stylePrimary: row.stylePrimary,
      styleTags: Array.isArray(row.styleTags) ? row.styleTags : [],
      context: suggestionContext,
    });

    return {
      id: row.id,
      name: row.name,
      brandName: row.brandName,
      imageCoverUrl: row.imageCoverUrl,
      category: row.category,
      subcategory: row.subcategory,
      stylePrimary: row.stylePrimary,
      styleSecondary: row.styleSecondary,
      styleTags: Array.isArray(row.styleTags) ? row.styleTags : [],
      sourceUrl: row.sourceUrl,
      createdAt: row.createdAt.toISOString(),
      suggestedRealStyle: suggestion.realStyle,
      suggestionSource: suggestion.source,
      suggestionScore: suggestion.score,
    } satisfies RealStyleQueueItem;
  });

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length >= params.limit && last
      ? encodeRealStyleCursor({ id: last.id, createdAt: last.createdAt.toISOString() })
      : null;

  const summary = await getRealStyleSummary();

  return { items, nextCursor, summary };
}

export async function isEligibleRealStyleProduct(productId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    select p.id
    from products p
    where p.id = ${productId}
      and ${ELIGIBLE_WHERE_SQL}
    limit 1
  `);
  return rows.length > 0;
}
