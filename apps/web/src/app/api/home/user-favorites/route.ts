import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { getUserFavoritePicks } from "@/lib/home-data";

const parseLimit = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return fallback;
  return Math.min(normalized, 24);
};

const parseExcludeIds = (value: string | null) => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 160);
};

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json(
      { products: [] },
      {
        headers: {
          "cache-control": "private, no-store",
        },
      },
    );
  }

  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 12);
  const excludeIds = parseExcludeIds(url.searchParams.get("excludeIds"));

  const products = await getUserFavoritePicks(session.user.id, {
    limit,
    excludeIds,
  });

  return NextResponse.json(
    {
      products,
      userId: session.user.id,
    },
    {
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );
}
