import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import { getPricingConfig, toInputJson, type PricingConfig } from "@/lib/pricing";

export const runtime = "nodejs";

const readObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizePositiveNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};

const normalizePercent = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const normalizePositiveInt = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = await getPricingConfig();
  return NextResponse.json({ config });
}

export async function PATCH(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const current = await getPricingConfig();
  const next: PricingConfig = { ...current };

  if ("usd_cop_trm" in body) {
    next.usd_cop_trm = normalizePositiveNumber(body.usd_cop_trm, current.usd_cop_trm);
  }

  if ("auto_usd_brand" in body) {
    const patch = readObject(body.auto_usd_brand);
    if (patch) {
      next.auto_usd_brand = {
        ...next.auto_usd_brand,
        enabled: "enabled" in patch ? normalizeBoolean(patch.enabled, next.auto_usd_brand.enabled) : next.auto_usd_brand.enabled,
        threshold_pct: "threshold_pct" in patch
          ? normalizePercent(patch.threshold_pct, next.auto_usd_brand.threshold_pct)
          : next.auto_usd_brand.threshold_pct,
        cop_price_lt: "cop_price_lt" in patch
          ? normalizePositiveInt(patch.cop_price_lt, next.auto_usd_brand.cop_price_lt)
          : next.auto_usd_brand.cop_price_lt,
        include_usd_variants: "include_usd_variants" in patch
          ? normalizeBoolean(patch.include_usd_variants, next.auto_usd_brand.include_usd_variants)
          : next.auto_usd_brand.include_usd_variants,
      };
    }
  }

  // display_rounding is intentionally not editable via PATCH for now; we always round to 10k with `nearest`.

  await prisma.standardColorConfig.upsert({
    where: { key: "pricing_config" },
    create: { key: "pricing_config", valueJson: toInputJson(next) },
    update: { valueJson: toInputJson(next) },
  });

  invalidateCatalogCache();

  return NextResponse.json({ ok: true, config: next });
}

