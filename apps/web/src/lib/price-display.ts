const DEFAULT_MARKETING_UNIT_COP = 10_000;
const DEFAULT_DYNAMIC_STEP_COP = 1_000;

function normalizeCurrency(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function normalizeMarketingUnit(unitCop: number | null | undefined) {
  if (typeof unitCop !== "number" || !Number.isFinite(unitCop) || unitCop <= 0) {
    return DEFAULT_MARKETING_UNIT_COP;
  }
  return Math.max(1, Math.round(unitCop));
}

export function shouldApplyMarketingRounding(input: {
  brandOverride: "USD" | null | boolean | string | undefined;
  sourceCurrency: string | null | undefined;
}) {
  if (input.brandOverride === true) return true;
  if (typeof input.brandOverride === "string" && normalizeCurrency(input.brandOverride) === "USD") return true;
  return normalizeCurrency(input.sourceCurrency) === "USD";
}

export function toDisplayedCop(input: {
  effectiveCop: number | null | undefined;
  applyMarketingRounding: boolean;
  unitCop?: number | null;
}) {
  const value = input.effectiveCop;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;

  if (!input.applyMarketingRounding) {
    return Math.round(value);
  }

  const unit = normalizeMarketingUnit(input.unitCop);
  return Math.round(Math.round(value / unit) * unit);
}

export function getDynamicPriceStepCop(input: {
  min: number | null | undefined;
  max: number | null | undefined;
}) {
  const min = input.min;
  const max = input.max;
  if (
    typeof min !== "number" ||
    !Number.isFinite(min) ||
    typeof max !== "number" ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return DEFAULT_DYNAMIC_STEP_COP;
  }

  const range = max - min;
  if (range <= 100_000) return 1_000;
  if (range <= 500_000) return 5_000;
  if (range <= 2_000_000) return 10_000;
  if (range <= 10_000_000) return 50_000;
  return 100_000;
}
