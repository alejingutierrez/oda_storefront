import { NextResponse } from "next/server";
import { type CatalogFilters, getCatalogPriceInsightsFixedPlp } from "@/lib/catalog-data";
import { type GenderKey } from "@/lib/navigation";
import { parsePlpPath, safeListPlpSeoPaths } from "@/lib/plp-seo/store";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const parsePositiveInt = (value: string | null | undefined, fallback: number, max: number) => {
  const raw = Number(value ?? "");
  if (!Number.isFinite(raw)) return fallback;
  const normalized = Math.floor(raw);
  if (normalized <= 0) return fallback;
  return Math.min(max, normalized);
};

const SLOT_COUNT_DEFAULT = parsePositiveInt(process.env.CATALOG_FIXED_PLP_PRECOMPUTE_SLOT_COUNT, 168, 2000);
const MAX_PATHS_PER_RUN_DEFAULT = parsePositiveInt(process.env.CATALOG_FIXED_PLP_PRECOMPUTE_MAX_PATHS_PER_RUN, 12, 200);

const isCronRequest = (req: Request) => {
  const cronHeader = (req.headers.get("x-vercel-cron") ?? "").toLowerCase();
  const userAgent = req.headers.get("user-agent") ?? "";
  return (
    cronHeader === "1" ||
    cronHeader === "true" ||
    userAgent.toLowerCase().includes("vercel-cron")
  );
};

const hasAdminToken = (req: Request) => {
  const headerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!headerToken) return false;
  return Boolean(process.env.ADMIN_TOKEN && headerToken === process.env.ADMIN_TOKEN);
};

const resolveCurrentSlot = (slotCount: number) => {
  const epochHour = Math.floor(Date.now() / (60 * 60 * 1000));
  const slot = epochHour % slotCount;
  return slot >= 0 ? slot : slot + slotCount;
};

const hashPath = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const GENDER_BY_SLUG: Record<string, GenderKey> = {
  femenino: "Femenino",
  masculino: "Masculino",
  unisex: "Unisex",
  infantil: "Infantil",
};

const buildFiltersForPath = (path: string): CatalogFilters | null => {
  const parsed = parsePlpPath(path);
  if (!parsed) return null;
  const gender = GENDER_BY_SLUG[parsed.genderSlug];
  if (!gender) return null;
  return {
    genders: [gender],
    ...(parsed.categoryKey ? { categories: [parsed.categoryKey] } : {}),
    ...(parsed.subcategoryKey ? { subcategories: [parsed.subcategoryKey] } : {}),
    inStock: true,
    enrichedOnly: true,
  };
};

export async function GET(req: Request) {
  const cron = isCronRequest(req);
  const token = hasAdminToken(req);
  if (!cron && !token) {
    const admin = await validateAdminRequest(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const slotCount = parsePositiveInt(url.searchParams.get("slotCount"), SLOT_COUNT_DEFAULT, 2000);
    const maxPathsPerRun = parsePositiveInt(url.searchParams.get("maxPaths"), MAX_PATHS_PER_RUN_DEFAULT, 200);
    const slotRaw = Number(url.searchParams.get("slot"));
    const slot = Number.isFinite(slotRaw) ? Math.max(0, Math.min(slotCount - 1, Math.floor(slotRaw))) : resolveCurrentSlot(slotCount);

    const allRows = await safeListPlpSeoPaths();
    const uniqueRows = Array.from(new Map(allRows.map((row) => [row.path, row])).values());
    const candidates = uniqueRows
      .filter((row) => hashPath(row.path) % slotCount === slot)
      .slice(0, maxPathsPerRun);

    let okCount = 0;
    let failCount = 0;
    const okSample: string[] = [];
    const failedSample: string[] = [];

    for (const row of candidates) {
      const filters = buildFiltersForPath(row.path);
      if (!filters) {
        failCount += 1;
        if (failedSample.length < 5) failedSample.push(row.path);
        continue;
      }
      try {
        await getCatalogPriceInsightsFixedPlp(filters);
        okCount += 1;
        if (okSample.length < 5) okSample.push(row.path);
      } catch (error) {
        failCount += 1;
        if (failedSample.length < 5) failedSample.push(row.path);
        console.error("catalog-price-insights.cron_path_failed", {
          path: row.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const durationMs = Date.now() - startedAt;
    console.info("catalog-price-insights.cron_completed", {
      slot,
      slotCount,
      totalPaths: uniqueRows.length,
      candidates: candidates.length,
      processed: candidates.length,
      okCount,
      failCount,
      durationMs,
      pathsSample: okSample,
      failedSample,
    });

    return NextResponse.json({
      ok: true,
      slot,
      slotCount,
      processed: candidates.length,
      okCount,
      failCount,
      durationMs,
      pathsSample: okSample,
      failedSample,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error("catalog-price-insights.cron_failed", { error: message, durationMs });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
