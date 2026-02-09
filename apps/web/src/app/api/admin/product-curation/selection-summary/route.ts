import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PRODUCT_IDS = 1200;

const toUniqueStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const productIdsRaw = body?.productIds;
  const productIds = toUniqueStringArray(productIdsRaw);

  if (productIds.length === 0) {
    return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
  }
  if (productIds.length > MAX_PRODUCT_IDS) {
    return NextResponse.json({ error: "too_many_product_ids", limit: MAX_PRODUCT_IDS }, { status: 400 });
  }

  const taxonomy = await getPublishedTaxonomyOptions();

  const rows = await prisma.$queryRaw<Array<{ category: string | null; cnt: bigint }>>(Prisma.sql`
    select p.category as category, count(*) as cnt
    from products p
    where p.id in (${Prisma.join(productIds)})
    group by p.category
    order by cnt desc
  `);

  const categories = rows.map((row) => {
    const key = row.category;
    const label = key ? taxonomy.categoryLabels[key] ?? key : "Sin categoría";
    return { key, label, count: Number(row.cnt ?? 0) };
  });

  const foundCount = categories.reduce((sum, entry) => sum + entry.count, 0);
  const missingCount = Math.max(0, productIds.length - foundCount);

  return NextResponse.json({
    ok: true,
    foundCount,
    missingCount,
    limit: MAX_PRODUCT_IDS,
    categories,
  });
}

