import { NextResponse } from "next/server";
import { normalizeProductWithOpenAI } from "@/lib/openai";

export const runtime = "nodejs";

// Temporary auth: reuse NEXTAUTH_SECRET as bearer
function isAuthorized(req: Request) {
  const header = req.headers.get("authorization");
  if (!header) return false;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return !!token && token === process.env.NEXTAUTH_SECRET;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
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
