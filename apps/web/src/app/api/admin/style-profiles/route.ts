import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTaxonomyMeta, invalidateTaxonomyCache } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const KEY_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const toString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.styleProfile.findMany({
    orderBy: { key: "asc" },
    select: { key: true, label: true, tags: true, updatedAt: true },
  });

  return NextResponse.json({
    ok: true,
    styleProfiles: rows.map((row) => ({
      key: row.key,
      label: row.label,
      tags: row.tags ?? [],
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const key = toString(body?.key);
  const label = toString(body?.label);
  const tags = Array.from(new Set(toStringArray(body?.tags))).sort();

  if (!key || !KEY_REGEX.test(key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "missing_label" }, { status: 400 });
  }

  const taxonomy = await getPublishedTaxonomyMeta();
  const allowedStyleTags = new Set(
    taxonomy.data.styleTags.filter((t) => t.isActive !== false).map((t) => t.key),
  );
  const invalid = tags.filter((tag) => !allowedStyleTags.has(tag));
  if (invalid.length > 0) {
    return NextResponse.json({ error: "invalid_style_tags", invalid }, { status: 400 });
  }

  try {
    await prisma.styleProfile.create({
      data: { key, label, tags },
      select: { key: true },
    });
  } catch (err) {
    console.warn("[style-profiles] create.failed", err);
    return NextResponse.json({ error: "create_failed" }, { status: 400 });
  }

  invalidateTaxonomyCache();
  return NextResponse.json({ ok: true });
}

