import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      slug: string | null;
      currency_override: string | null;
      currency_override_source: string | null;
      currency_override_applied_at: string | null;
      currency_override_reason: string | null;
      currency_override_stats: Prisma.JsonValue | string | null;
    }>
  >(Prisma.sql`
    select
      b.id,
      b.name,
      b.slug,
      (b.metadata -> 'pricing' ->> 'currency_override') as currency_override,
      (b.metadata -> 'pricing' ->> 'currency_override_source') as currency_override_source,
      (b.metadata -> 'pricing' ->> 'currency_override_applied_at') as currency_override_applied_at,
      (b.metadata -> 'pricing' ->> 'currency_override_reason') as currency_override_reason,
      (b.metadata -> 'pricing' -> 'currency_override_stats') as currency_override_stats
    from brands b
    where upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD'
    order by lower(b.name) asc
  `);

  const brands = rows.map((row) => {
    let stats: unknown = row.currency_override_stats ?? null;
    if (typeof stats === "string") {
      try {
        stats = JSON.parse(stats);
      } catch {
        stats = null;
      }
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      pricing: {
        currency_override: row.currency_override ? row.currency_override.toUpperCase() : null,
        currency_override_source: row.currency_override_source ?? null,
        currency_override_applied_at: row.currency_override_applied_at ?? null,
        currency_override_reason: row.currency_override_reason ?? null,
        currency_override_stats: stats,
      },
    };
  });

  return NextResponse.json({ ok: true, brands });
}

