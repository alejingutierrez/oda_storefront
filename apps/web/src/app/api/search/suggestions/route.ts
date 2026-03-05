import { NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/search-suggestions";
import { readJsonCache, writeJsonCache } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 10;

const CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX = "oda:search:suggestions:";

function normalizeForCache(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

const headers = {
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q || q.length < 2) {
    return NextResponse.json(
      { query: q, groups: { terms: [], brands: [], products: [] } },
      { headers },
    );
  }

  const cacheKey = `${CACHE_PREFIX}${normalizeForCache(q)}`;

  // Check Redis cache first
  try {
    const cached = await readJsonCache(cacheKey);
    if (cached) return NextResponse.json(cached, { headers });
  } catch {
    // Redis unavailable; continue without cache.
  }

  const result = await getSearchSuggestions(q, 12);

  // Write to Redis (fire and forget)
  writeJsonCache(cacheKey, result, CACHE_TTL_SECONDS).catch(() => {});

  return NextResponse.json(result, { headers });
}
