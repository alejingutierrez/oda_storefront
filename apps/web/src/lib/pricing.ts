import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DEFAULT_SUPPORTED_CURRENCIES = ["COP", "USD", "EUR", "ARS"] as const;

export type FxRatesToCop = Record<string, number>;

export type PricingConfig = {
  usd_cop_trm: number;
  fx_rates_to_cop: FxRatesToCop;
  supported_currencies: string[];
  display_rounding: {
    unit_cop: number;
    mode: "nearest";
  };
  auto_usd_brand: {
    enabled: boolean;
    threshold_pct: number;
    cop_price_lt: number;
    include_usd_variants: boolean;
  };
};

const DEFAULT_TRM = (() => {
  const raw = process.env.FX_USD_COP_TRM_DEFAULT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4200;
})();

const DEFAULT_CONFIG: PricingConfig = {
  usd_cop_trm: DEFAULT_TRM,
  fx_rates_to_cop: {
    USD: DEFAULT_TRM,
  },
  supported_currencies: [...DEFAULT_SUPPORTED_CURRENCIES],
  display_rounding: { unit_cop: 10_000, mode: "nearest" },
  auto_usd_brand: {
    enabled: true,
    threshold_pct: 75,
    cop_price_lt: 1999,
    include_usd_variants: true,
  },
};

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
}

function normalizeFxRatesToCop(value: unknown, fallbackUsdRate: number): FxRatesToCop {
  const obj = readObject(value);
  const rates: FxRatesToCop = {};

  if (obj) {
    for (const [rawCurrency, rawRate] of Object.entries(obj)) {
      const code = normalizeCurrencyCode(rawCurrency);
      const rate = typeof rawRate === "number" ? rawRate : Number(rawRate);
      if (!code || !Number.isFinite(rate) || rate <= 0) continue;
      rates[code] = rate;
    }
  }

  const usdFromMap = rates.USD;
  if (typeof usdFromMap === "number" && Number.isFinite(usdFromMap) && usdFromMap > 0) {
    rates.USD = usdFromMap;
  } else {
    rates.USD = fallbackUsdRate;
  }

  return rates;
}

function normalizeSupportedCurrencies(
  value: unknown,
  fallback: readonly string[] = DEFAULT_SUPPORTED_CURRENCIES,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const next = Array.from(new Set(value.map((entry) => normalizeCurrencyCode(entry)).filter(Boolean) as string[]));
  return next.length ? next : [...fallback];
}

function ensureCurrencyCoverage(codes: string[], fxRatesToCop: FxRatesToCop): string[] {
  const next = new Set(codes);
  next.add("COP");
  next.add("USD");
  for (const code of Object.keys(fxRatesToCop)) {
    const normalized = normalizeCurrencyCode(code);
    if (!normalized) continue;
    next.add(normalized);
  }
  if (!next.size) return [...DEFAULT_SUPPORTED_CURRENCIES];
  return Array.from(next);
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function normalizeNonNegativeInt(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function assertValidConfig(config: PricingConfig) {
  if (!Number.isFinite(config.usd_cop_trm) || config.usd_cop_trm <= 0) {
    throw new Error("pricing_config.usd_cop_trm invalid");
  }
  if (!config.fx_rates_to_cop || typeof config.fx_rates_to_cop !== "object" || Array.isArray(config.fx_rates_to_cop)) {
    throw new Error("pricing_config.fx_rates_to_cop invalid");
  }
  for (const [rawCode, rawRate] of Object.entries(config.fx_rates_to_cop)) {
    const code = normalizeCurrencyCode(rawCode);
    const rate = typeof rawRate === "number" ? rawRate : Number(rawRate);
    if (!code) {
      throw new Error(`pricing_config.fx_rates_to_cop.${rawCode} invalid_currency`);
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`pricing_config.fx_rates_to_cop.${code} invalid_rate`);
    }
  }
  if (!Array.isArray(config.supported_currencies) || config.supported_currencies.length === 0) {
    throw new Error("pricing_config.supported_currencies invalid");
  }
  for (const rawCode of config.supported_currencies) {
    const code = normalizeCurrencyCode(rawCode);
    if (!code) {
      throw new Error(`pricing_config.supported_currencies.${String(rawCode)} invalid_currency`);
    }
  }
  if (!config.supported_currencies.includes("COP")) {
    throw new Error("pricing_config.supported_currencies missing_COP");
  }
  if (!config.supported_currencies.includes("USD")) {
    throw new Error("pricing_config.supported_currencies missing_USD");
  }
  const usdRate = config.fx_rates_to_cop.USD;
  if (!Number.isFinite(usdRate) || usdRate <= 0) {
    throw new Error("pricing_config.fx_rates_to_cop.USD invalid");
  }
  if (Math.abs(usdRate - config.usd_cop_trm) > 0.000001) {
    throw new Error("pricing_config.usd_cop_trm_out_of_sync");
  }
  if (
    !Number.isFinite(config.display_rounding.unit_cop) ||
    config.display_rounding.unit_cop <= 0
  ) {
    throw new Error("pricing_config.display_rounding.unit_cop invalid");
  }
  if (
    !Number.isFinite(config.auto_usd_brand.threshold_pct) ||
    config.auto_usd_brand.threshold_pct < 0 ||
    config.auto_usd_brand.threshold_pct > 100
  ) {
    throw new Error("pricing_config.auto_usd_brand.threshold_pct invalid");
  }
  if (
    !Number.isFinite(config.auto_usd_brand.cop_price_lt) ||
    config.auto_usd_brand.cop_price_lt <= 0
  ) {
    throw new Error("pricing_config.auto_usd_brand.cop_price_lt invalid");
  }
}

export async function getPricingConfig(): Promise<PricingConfig> {
  const row = await prisma.standardColorConfig.findUnique({
    where: { key: "pricing_config" },
    select: { valueJson: true },
  });

  let stored: unknown = row?.valueJson ?? null;
  if (typeof stored === "string") {
    try {
      stored = JSON.parse(stored);
    } catch {
      stored = null;
    }
  }

  const obj = readObject(stored);
  const usdRoot = normalizePositiveNumber(obj?.usd_cop_trm, DEFAULT_CONFIG.usd_cop_trm);
  const fxRatesToCop = normalizeFxRatesToCop(obj?.fx_rates_to_cop, usdRoot);
  const usdCopTrm = fxRatesToCop.USD;
  const supportedCurrencies = ensureCurrencyCoverage(
    normalizeSupportedCurrencies(obj?.supported_currencies, DEFAULT_CONFIG.supported_currencies),
    fxRatesToCop,
  );
  const next: PricingConfig = {
    usd_cop_trm: usdCopTrm,
    fx_rates_to_cop: fxRatesToCop,
    supported_currencies: supportedCurrencies,
    display_rounding: {
      unit_cop: normalizePositiveNumber(
        readObject(obj?.display_rounding)?.unit_cop,
        DEFAULT_CONFIG.display_rounding.unit_cop,
      ),
      mode: "nearest",
    },
    auto_usd_brand: {
      enabled: normalizeBoolean(
        readObject(obj?.auto_usd_brand)?.enabled,
        DEFAULT_CONFIG.auto_usd_brand.enabled,
      ),
      threshold_pct: Math.max(
        0,
        Math.min(
          100,
          normalizePositiveNumber(
            readObject(obj?.auto_usd_brand)?.threshold_pct,
            DEFAULT_CONFIG.auto_usd_brand.threshold_pct,
          ),
        ),
      ),
      cop_price_lt: normalizeNonNegativeInt(
        readObject(obj?.auto_usd_brand)?.cop_price_lt,
        DEFAULT_CONFIG.auto_usd_brand.cop_price_lt,
      ),
      include_usd_variants: normalizeBoolean(
        readObject(obj?.auto_usd_brand)?.include_usd_variants,
        DEFAULT_CONFIG.auto_usd_brand.include_usd_variants,
      ),
    },
  };

  assertValidConfig(next);
  return next;
}

export function getUsdCopTrm(config: PricingConfig): number {
  const usdFromFx = config.fx_rates_to_cop?.USD;
  if (typeof usdFromFx === "number" && Number.isFinite(usdFromFx) && usdFromFx > 0) {
    return usdFromFx;
  }
  return config.usd_cop_trm;
}

export function getFxRatesToCop(config: PricingConfig): FxRatesToCop {
  const parsed = normalizeFxRatesToCop(config.fx_rates_to_cop, getUsdCopTrm(config));
  return parsed;
}

export function getSupportedCurrencies(config: PricingConfig): string[] {
  const supported = normalizeSupportedCurrencies(config.supported_currencies, DEFAULT_SUPPORTED_CURRENCIES);
  return ensureCurrencyCoverage(supported, getFxRatesToCop(config));
}

export function getDisplayRoundingUnitCop(config: PricingConfig): number {
  return config.display_rounding.unit_cop;
}

export function getBrandCurrencyOverride(metadata: unknown): string | null {
  const obj = readObject(metadata);
  const pricing = readObject(obj?.pricing);
  const raw = typeof pricing?.currency_override === "string" ? pricing.currency_override : null;
  if (!raw) return null;
  return normalizeCurrencyCode(raw);
}

export function toCopEffective(input: {
  price: number | null | undefined;
  currency: string | null | undefined;
  brandOverride: string | null;
  fxRatesToCop: FxRatesToCop;
}): number | null {
  const price = input.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

  const effectiveCurrency = normalizeCurrencyCode(input.brandOverride) ?? normalizeCurrencyCode(input.currency);
  if (!effectiveCurrency) return null;
  if (effectiveCurrency === "COP") return price;

  const rate = input.fxRatesToCop[effectiveCurrency];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return price * rate;
}

export function toCopDisplayMarketing(valueCop: number | null | undefined, unitCop = 10_000): number | null {
  if (typeof valueCop !== "number" || !Number.isFinite(valueCop) || valueCop <= 0) return null;
  const unit = Number.isFinite(unitCop) && unitCop > 0 ? unitCop : 10_000;
  return Math.round(valueCop / unit) * unit;
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  // Ensure `Prisma.InputJsonValue` compatibility.
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
