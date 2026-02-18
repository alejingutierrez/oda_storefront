import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensurePlpSeoTables } from "@/lib/plp-seo/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const isAllowedGenderSlug = (value: string | null) => {
  const slug = (value ?? "").trim().toLowerCase();
  if (!slug) return null;
  if (slug !== "femenino" && slug !== "masculino" && slug !== "unisex" && slug !== "infantil") return null;
  return slug;
};

const coerceOptionalKey = (value: string | null) => {
  const cleaned = (value ?? "").trim();
  return cleaned.length ? cleaned : null;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await ensurePlpSeoTables();

    const url = new URL(req.url);
    const genderSlug = isAllowedGenderSlug(url.searchParams.get("genderSlug"));
    const categoryKey = coerceOptionalKey(url.searchParams.get("categoryKey"));
    const onlyMissing = url.searchParams.get("onlyMissing") !== "false";
    const limitRaw = Number(url.searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.round(limitRaw))) : 200;

    const filters: Prisma.Sql[] = [];
    if (genderSlug) filters.push(Prisma.sql`ap."genderSlug" = ${genderSlug}`);
    if (categoryKey) filters.push(Prisma.sql`ap."categoryKey" = ${categoryKey}`);
    if (onlyMissing) filters.push(Prisma.sql`page.id is null`);
    const where = filters.length ? Prisma.sql`where ${Prisma.join(filters, " and ")}` : Prisma.sql``;

    const rows = await prisma.$queryRaw<
      Array<{
        path: string;
        genderSlug: string;
        categoryKey: string | null;
        subcategoryKey: string | null;
        productCount: bigint;
        pageUpdatedAt: Date | null;
        provider: string | null;
        model: string | null;
        itemStatus: string | null;
        itemError: string | null;
        itemUpdatedAt: Date | null;
      }>
    >(Prisma.sql`
    with base as (
      select
        case
          when lower(coalesce(p.gender,'')) in ('femenino','mujer') then 'femenino'
          when lower(coalesce(p.gender,'')) in ('masculino','hombre','male') then 'masculino'
          when lower(coalesce(p.gender,'')) in ('infantil','nino') then 'infantil'
          else 'unisex'
        end as "genderSlug",
        nullif(btrim(p.category), '') as "categoryKey",
        nullif(btrim(p.subcategory), '') as "subcategoryKey"
      from products p
      where p."imageCoverUrl" is not null
    ),
    gender_paths as (
      select
        concat('/', "genderSlug") as path,
        "genderSlug",
        null::text as "categoryKey",
        null::text as "subcategoryKey",
        count(*) as "productCount"
      from base
      group by "genderSlug"
    ),
    category_paths as (
      select
        concat('/', "genderSlug", '/', "categoryKey") as path,
        "genderSlug",
        "categoryKey",
        null::text as "subcategoryKey",
        count(*) as "productCount"
      from base
      where "categoryKey" is not null
      group by "genderSlug","categoryKey"
    ),
    subcategory_paths as (
      select
        concat('/', "genderSlug", '/', "categoryKey", '/', "subcategoryKey") as path,
        "genderSlug",
        "categoryKey",
        "subcategoryKey",
        count(*) as "productCount"
      from base
      where "categoryKey" is not null and "subcategoryKey" is not null
      group by "genderSlug","categoryKey","subcategoryKey"
    ),
    all_paths as (
      select * from gender_paths
      union all
      select * from category_paths
      union all
      select * from subcategory_paths
    ),
    latest_items as (
      select distinct on (i.path)
        i.path,
        i.status as "itemStatus",
        i."lastError" as "itemError",
        i."updatedAt" as "itemUpdatedAt"
      from plp_seo_items i
      order by i.path, i."updatedAt" desc
    )
    select
      ap.path,
      ap."genderSlug",
      ap."categoryKey",
      ap."subcategoryKey",
      ap."productCount",
      page."updatedAt" as "pageUpdatedAt",
      page.provider as provider,
      page.model as model,
      li."itemStatus",
      li."itemError",
      li."itemUpdatedAt"
    from all_paths ap
    left join plp_seo_pages page on page.path = ap.path
    left join latest_items li on li.path = ap.path
    ${where}
    order by ap."productCount" desc, ap.path asc
    limit ${limit}
  `);

    const pages = rows.map((row) => {
      const hasPage = Boolean(row.pageUpdatedAt);
      const status = hasPage ? "ready" : row.itemStatus === "failed" ? "failed" : "missing";
      return {
        path: row.path,
        genderSlug: row.genderSlug,
        categoryKey: row.categoryKey,
        subcategoryKey: row.subcategoryKey,
        productCount: Number(row.productCount ?? 0),
        status,
        page: hasPage
          ? {
              updatedAt: row.pageUpdatedAt,
              provider: row.provider,
              model: row.model,
            }
          : null,
        lastAttempt: row.itemUpdatedAt
          ? {
              status: row.itemStatus,
              updatedAt: row.itemUpdatedAt,
              error: row.itemError,
            }
          : null,
      };
    });

    return NextResponse.json({ pages });
  } catch (err) {
    console.error("[plp-seo] /pages failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
