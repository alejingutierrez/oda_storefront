import { NextResponse } from "next/server";
import { getCompareProductDetails } from "@/lib/compare-data";

export const revalidate = 60;

function parseIds(searchParams: URLSearchParams) {
  const next: string[] = [];

  const idsCsv = searchParams.get("ids");
  if (idsCsv) {
    for (const part of idsCsv.split(",")) {
      const trimmed = part.trim();
      if (trimmed) next.push(trimmed);
    }
  }

  // Opcional: soportar `id=...&id=...`
  for (const id of searchParams.getAll("id")) {
    const trimmed = id.trim();
    if (trimmed) next.push(trimmed);
  }

  return next;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = parseIds(searchParams).slice(0, 3);

  if (ids.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const items = await getCompareProductDetails(ids);
  return NextResponse.json({ items });
}

