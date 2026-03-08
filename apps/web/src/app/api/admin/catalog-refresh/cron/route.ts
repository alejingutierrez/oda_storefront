import { NextResponse } from "next/server";
import {
  runCatalogRefreshBatch,
  type CatalogRefreshBatchMode,
} from "@/lib/catalog/refresh";
import { validateCronOrAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const parseOptionalPositiveInt = (value: string | null) => {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : undefined;
};

const parseMode = (value: string | null): CatalogRefreshBatchMode => {
  if (!value) return "light";
  return value.trim().toLowerCase() === "heavy" ? "heavy" : "light";
};

export async function GET(req: Request) {
  const auth = await validateCronOrAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brandId");
    const force = url.searchParams.get("force") === "true";
    const maxBrands = parseOptionalPositiveInt(url.searchParams.get("maxBrands"));
    const brandConcurrency = parseOptionalPositiveInt(
      url.searchParams.get("brandConcurrency"),
    );
    const maxRuntimeMs = parseOptionalPositiveInt(url.searchParams.get("maxRuntimeMs"));
    const mode = parseMode(url.searchParams.get("mode"));

    const result = await runCatalogRefreshBatch({
      brandId: brandId ?? undefined,
      force,
      maxBrands,
      brandConcurrency,
      maxRuntimeMs,
      mode,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("catalog-refresh.cron_failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
