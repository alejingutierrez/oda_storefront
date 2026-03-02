import { NextResponse } from "next/server";
import {
  runCatalogRefreshBatch,
  type CatalogRefreshBatchMode,
} from "@/lib/catalog/refresh";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const headerToken = req.headers.get("authorization")?.replace(/^Bearer\\s+/i, "").trim();
  if (!headerToken) return false;
  if (process.env.ADMIN_TOKEN && headerToken === process.env.ADMIN_TOKEN) return true;
  return false;
};

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
  const isCron = isCronRequest(req);
  const hasToken = hasAdminToken(req);
  if (!isCron && !hasToken) {
    const admin = await validateAdminRequest(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
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
