import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;

function uniq(values: string[]) {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId")?.trim();
  if (!productId) {
    return NextResponse.json({ error: "productId_required" }, { status: 400 });
  }

  const variants = await prisma.variant.findMany({
    where: { productId },
    select: { images: true },
    take: 18,
  });

  const images = uniq(
    variants.flatMap((variant) => (Array.isArray(variant.images) ? variant.images : [])),
  ).slice(0, 8);

  return NextResponse.json(
    { images },
    {
      headers: {
        // Las imagenes cambian poco. Cache agresivo en CDN para mejorar hover/viewport carousel.
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

