import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PricingConfig = {
  usd_cop_trm: number;
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
  const next: PricingConfig = {
    usd_cop_trm: normalizePositiveNumber(obj?.usd_cop_trm, DEFAULT_CONFIG.usd_cop_trm),
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
  return config.usd_cop_trm;
}

export function getDisplayRoundingUnitCop(config: PricingConfig): number {
  return config.display_rounding.unit_cop;
}

export function getBrandCurrencyOverride(metadata: unknown): "USD" | null {
  const obj = readObject(metadata);
  const pricing = readObject(obj?.pricing);
  const raw = typeof pricing?.currency_override === "string" ? pricing.currency_override : null;
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  if (normalized === "USD") return "USD";
  return null;
}

export function toCopEffective(input: {
  price: number | null | undefined;
  currency: string | null | undefined;
  brandOverride: "USD" | null;
  trmUsdCop: number;
}): number | null {
  const price = input.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

  const effectiveCurrency = input.brandOverride ?? (input.currency ? input.currency.trim().toUpperCase() : null);
  if (effectiveCurrency === "USD") return price * input.trmUsdCop;
  return price;
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

