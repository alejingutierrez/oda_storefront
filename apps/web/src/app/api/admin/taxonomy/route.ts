import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getOrCreateDraftTaxonomyMeta, getPublishedTaxonomyMeta, saveDraftTaxonomy } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const stage = (url.searchParams.get("stage") ?? "published").toLowerCase();

  if (stage === "draft") {
    const draft = await getOrCreateDraftTaxonomyMeta({ adminEmail: admin.email });
    return NextResponse.json({
      ok: true,
      stage: "draft",
      source: draft.source,
      version: draft.version,
      updatedAt: draft.updatedAt ? draft.updatedAt.toISOString() : null,
      data: draft.data,
    });
  }

  const published = await getPublishedTaxonomyMeta();
  return NextResponse.json({
    ok: true,
    stage: "published",
    source: published.source,
    version: published.version,
    updatedAt: published.updatedAt ? published.updatedAt.toISOString() : null,
    data: published.data,
  });
}

export async function PUT(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const stage = typeof body?.stage === "string" ? body.stage.toLowerCase() : "draft";
  if (stage !== "draft") {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }

  try {
    const result = await saveDraftTaxonomy({ adminEmail: admin.email, data: body?.data });
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[taxonomy] draft.save.failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid_taxonomy" },
      { status: 400 },
    );
  }
}

