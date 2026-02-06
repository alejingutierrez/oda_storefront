import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const updated = await prisma.$executeRaw(Prisma.sql`
      with computed as (
        select p.id,
               res.primary_key,
               res.secondary_key,
               res.primary_count,
               res.secondary_count
        from "products" p
        left join lateral pick_style_assignments(p."styleTags") as res on true
      )
      update "products" p
      set "stylePrimary" = computed.primary_key,
          "styleSecondary" = computed.secondary_key,
          "stylePrimaryCount" = computed.primary_count,
          "styleSecondaryCount" = computed.secondary_count
      from computed
      where p.id = computed.id
        and (
          p."stylePrimary" is distinct from computed.primary_key or
          p."styleSecondary" is distinct from computed.secondary_key or
          p."stylePrimaryCount" is distinct from computed.primary_count or
          p."styleSecondaryCount" is distinct from computed.secondary_count
        );
    `);

    return NextResponse.json({ ok: true, updatedCount: typeof updated === "number" ? updated : null });
  } catch (err) {
    console.warn("[style-profiles] recompute.failed", err);
    return NextResponse.json({ error: "recompute_failed" }, { status: 400 });
  }
}

