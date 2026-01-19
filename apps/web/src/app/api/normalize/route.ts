import { NextResponse } from "next/server";
import { normalizeProductWithOpenAI } from "@/lib/openai";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.productHtml !== "string" || !Array.isArray(body.images)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    const result = await normalizeProductWithOpenAI({
      productHtml: body.productHtml,
      images: body.images,
      sourceUrl: body.sourceUrl,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("normalize error", error);
    return NextResponse.json({ error: "normalization_failed" }, { status: 500 });
  }
}
