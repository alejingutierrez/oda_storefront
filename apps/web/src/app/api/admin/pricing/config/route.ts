import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import {
  assertValidConfig,
  getPricingConfig,
  normalizeCurrencyCode,
  toInputJson,
  type PricingConfig,
} from "@/lib/pricing";

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

const parseFxRatesPatch = (
  input: unknown,
  current: Record<string, number>,
): { ok: true; value: Record<string, number> } | { ok: false; error: string } => {
  const patch = readObject(input);
  if (!patch) return { ok: false, error: "fx_rates_to_cop_invalid_payload" };

  const next = { ...current };
  for (const [rawCode, rawRate] of Object.entries(patch)) {
    const code = normalizeCurrencyCode(rawCode);
    if (!code) return { ok: false, error: `fx_rates_to_cop_invalid_currency:${rawCode}` };
    if (rawCode.trim() !== code) return { ok: false, error: `fx_rates_to_cop_currency_not_uppercase:${rawCode}` };
    const rate = typeof rawRate === "number" ? rawRate : Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: `fx_rates_to_cop_invalid_rate:${code}` };
    next[code] = rate;
  }
  return { ok: true, value: next };
};

const parseSupportedCurrencies = (
  input: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } => {
  if (!Array.isArray(input)) return { ok: false, error: "supported_currencies_invalid_payload" };
  if (input.some((value) => typeof value !== "string" || value.trim() !== value.trim().toUpperCase())) {
    return { ok: false, error: "supported_currencies_not_uppercase" };
  }
  if (input.some((value) => !normalizeCurrencyCode(value))) {
    return { ok: false, error: "supported_currencies_invalid_code" };
  }
  const next = Array.from(
    new Set(
      input
        .map((value) => normalizeCurrencyCode(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (!next.length) return { ok: false, error: "supported_currencies_empty" };
  return { ok: true, value: next };
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
  const next: PricingConfig = {
    ...current,
    fx_rates_to_cop: { ...current.fx_rates_to_cop },
    supported_currencies: [...current.supported_currencies],
  };

  let patchUsdCopTrm: number | null = null;

  if ("usd_cop_trm" in body) {
    const parsed = normalizePositiveNumber(body.usd_cop_trm, NaN);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "usd_cop_trm_invalid" }, { status: 400 });
    }
    patchUsdCopTrm = parsed;
    next.usd_cop_trm = parsed;
  }

  if ("fx_rates_to_cop" in body) {
    const parsed = parseFxRatesPatch(body.fx_rates_to_cop, next.fx_rates_to_cop);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    next.fx_rates_to_cop = parsed.value;
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

  if ("supported_currencies" in body) {
    const parsed = parseSupportedCurrencies(body.supported_currencies);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    next.supported_currencies = parsed.value;
  }

  const fxUsd = next.fx_rates_to_cop.USD;
  if (patchUsdCopTrm !== null && Number.isFinite(fxUsd) && fxUsd > 0 && Math.abs(fxUsd - patchUsdCopTrm) > 0.000001) {
    return NextResponse.json({ error: "usd_cop_trm_fx_usd_mismatch" }, { status: 400 });
  }
  if (patchUsdCopTrm !== null) {
    next.fx_rates_to_cop.USD = patchUsdCopTrm;
  } else if (typeof fxUsd === "number" && Number.isFinite(fxUsd) && fxUsd > 0) {
    next.usd_cop_trm = fxUsd;
  } else {
    next.fx_rates_to_cop.USD = next.usd_cop_trm;
  }

  next.supported_currencies = Array.from(
    new Set([
      ...next.supported_currencies,
      "COP",
      "USD",
      ...Object.keys(next.fx_rates_to_cop),
    ]),
  );

  try {
    assertValidConfig(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_pricing_config";
    return NextResponse.json({ error: message }, { status: 400 });
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
