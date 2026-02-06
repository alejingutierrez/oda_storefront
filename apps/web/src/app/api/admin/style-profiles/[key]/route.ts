import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTaxonomyMeta, invalidateTaxonomyCache } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const toString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export async function PATCH(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = await ctx.params;
  const key = params.key;
  if (!key) {
    return NextResponse.json({ error: "missing_key" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const label = toString(body?.label);
  const tags = body?.tags === undefined ? undefined : Array.from(new Set(toStringArray(body.tags))).sort();

  if (tags) {
    const taxonomy = await getPublishedTaxonomyMeta();
    const allowedStyleTags = new Set(
      taxonomy.data.styleTags.filter((t) => t.isActive !== false).map((t) => t.key),
    );
    const invalid = tags.filter((tag) => !allowedStyleTags.has(tag));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "invalid_style_tags", invalid }, { status: 400 });
    }
  }

  try {
    const updated = await prisma.styleProfile.update({
      where: { key },
      data: {
        ...(label ? { label } : {}),
        ...(tags ? { tags } : {}),
      },
      select: { key: true, label: true, tags: true, updatedAt: true },
    });
    invalidateTaxonomyCache();
    return NextResponse.json({
      ok: true,
      styleProfile: {
        key: updated.key,
        label: updated.label,
        tags: updated.tags ?? [],
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.warn("[style-profiles] update.failed", err);
    return NextResponse.json({ error: "update_failed" }, { status: 400 });
  }
}

