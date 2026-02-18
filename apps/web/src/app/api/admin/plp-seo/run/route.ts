import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensurePlpSeoTables, normalizePlpPath } from "@/lib/plp-seo/store";
import { enqueuePlpSeoItems, isPlpSeoQueueEnabled } from "@/lib/plp-seo/queue";
import {
  createRunWithItems,
  findActiveRun,
  listPendingItems,
  markItemsQueued,
  resetQueuedItems,
  resetStuckItems,
  summarizeRun,
} from "@/lib/plp-seo/run-store";
import { plpSeoProvider, plpSeoPromptVersion, plpSeoSchemaVersion } from "@/lib/plp-seo/generator";
import { plpSeoBedrockModelId } from "@/lib/plp-seo/bedrock";

export const runtime = "nodejs";
export const maxDuration = 60;

const isAllowedGenderSlug = (value: unknown) => {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return null;
  if (slug !== "femenino" && slug !== "masculino" && slug !== "unisex" && slug !== "infantil") return null;
  return slug;
};

const coerceOptionalKey = (value: unknown) => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isPlpSeoQueueEnabled()) {
    return NextResponse.json({ error: "queue_disabled" }, { status: 503 });
  }

  await ensurePlpSeoTables();

  const body = await req.json().catch(() => null);
  const genderSlug = isAllowedGenderSlug(body?.genderSlug);
  const categoryKey = coerceOptionalKey(body?.categoryKey);
  const onlyMissing = body?.onlyMissing !== false;
  const batchSizeRaw = Number(body?.batchSize ?? body?.limit ?? 20);
  const batchSize = Number.isFinite(batchSizeRaw) ? Math.max(1, Math.min(50, Math.round(batchSizeRaw))) : 20;
  const resumeRequested = Boolean(body?.resume);

  const queuedStaleMs = Math.max(0, Number(process.env.PLP_SEO_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000);
  const stuckMs = Math.max(0, Number(process.env.PLP_SEO_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000);

  const existing = await findActiveRun();
  if (existing) {
    if (existing.status === "processing" && !resumeRequested) {
      const summary = await summarizeRun(existing.id);
      return NextResponse.json({ summary });
    }

    await prisma.plpSeoRun.update({
      where: { id: existing.id },
      data: {
        status: "processing",
        lastError: null,
        updatedAt: new Date(),
      },
    });

    await resetQueuedItems(existing.id, queuedStaleMs);
    await resetStuckItems(existing.id, stuckMs);
    const pending = await listPendingItems(existing.id, batchSize);
    await markItemsQueued(pending.map((item) => item.id));
    await enqueuePlpSeoItems(pending);

    const summary = await summarizeRun(existing.id);
    return NextResponse.json({ summary });
  }

  const filters: Prisma.Sql[] = [];
  if (genderSlug) filters.push(Prisma.sql`ap."genderSlug" = ${genderSlug}`);
  if (categoryKey) filters.push(Prisma.sql`ap."categoryKey" = ${categoryKey}`);
  if (onlyMissing) filters.push(Prisma.sql`page.id is null`);
  const where = filters.length ? Prisma.sql`where ${Prisma.join(filters, " and ")}` : Prisma.sql``;

  const candidates = await prisma.$queryRaw<
    Array<{
      path: string;
      genderSlug: string;
      categoryKey: string | null;
      subcategoryKey: string | null;
      productCount: bigint;
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
    )
    select
      ap.path,
      ap."genderSlug",
      ap."categoryKey",
      ap."subcategoryKey",
      ap."productCount"
    from all_paths ap
    left join plp_seo_pages page on page.path = ap.path
    ${where}
    order by ap."productCount" desc, ap.path asc
    limit ${batchSize}
  `);

  const items = candidates
    .map((row) => ({
      path: normalizePlpPath(row.path),
      genderSlug: row.genderSlug,
      categoryKey: row.categoryKey,
      subcategoryKey: row.subcategoryKey,
    }))
    .filter((row) => row.path !== "/");

  if (!items.length) {
    return NextResponse.json({ error: "no_candidates" }, { status: 409 });
  }

  const run = await createRunWithItems({
    items,
    metadata: {
      provider: plpSeoProvider,
      model: plpSeoBedrockModelId || null,
      prompt_version: plpSeoPromptVersion,
      schema_version: plpSeoSchemaVersion,
      created_by: "admin_run_api",
      requested_items: batchSize,
      selected_items: items.length,
      only_missing: onlyMissing,
      filters: {
        genderSlug: genderSlug ?? null,
        categoryKey: categoryKey ?? null,
      },
    } as Prisma.InputJsonValue,
  });

  const pending = await listPendingItems(run.id, batchSize);
  await markItemsQueued(pending.map((item) => item.id));
  await enqueuePlpSeoItems(pending);

  const summary = await summarizeRun(run.id);
  return NextResponse.json({ summary });
}

