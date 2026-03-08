import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) return NextResponse.json({});

  const ids = idsParam.split(",").slice(0, 10);

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, brand: { select: { slug: true } } },
  });

  const result: Record<string, string> = {};
  for (const p of products) {
    if (p.slug && p.brand.slug) {
      result[p.id] = `/producto/${p.brand.slug}/${p.slug}`;
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
