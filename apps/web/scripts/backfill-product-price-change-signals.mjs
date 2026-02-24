import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..", "..", "..");
const envPath = path.join(rootDir, ".env");
const envLocalPath = path.join(rootDir, ".env.local");

const DEFAULT_TRM_USD_COP = 4200;
const DEFAULT_MAX_VALID_PRICE = 100_000_000;
const DEFAULT_DISPLAY_UNIT_COP = 10_000;
const DEFAULT_SUPPORTED_CURRENCIES = ["COP", "USD", "EUR", "ARS"];

function readEnvValueFromFile(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    if (k !== key) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

function readEnvValue(key) {
  return process.env[key] || readEnvValueFromFile(envLocalPath, key) || readEnvValueFromFile(envPath, key);
}

function parsePositiveNumber(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}

function normalizeCurrencyCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
}

function resolvePricingConfig(valueJson, fallbackTrm, fallbackUnit) {
  const parsed = parseJson(valueJson);
  const trmRoot = Number(parsed?.usd_cop_trm);
  const unit = Number(parsed?.display_rounding?.unit_cop);
  const fallbackUsd = Number.isFinite(trmRoot) && trmRoot > 0 ? trmRoot : fallbackTrm;

  const fxRatesToCop = {};
  const fxObj =
    parsed?.fx_rates_to_cop && typeof parsed.fx_rates_to_cop === "object" && !Array.isArray(parsed.fx_rates_to_cop)
      ? parsed.fx_rates_to_cop
      : null;
  if (fxObj) {
    for (const [rawCode, rawRate] of Object.entries(fxObj)) {
      const code = normalizeCurrencyCode(rawCode);
      const rate = Number(rawRate);
      if (!code) continue;
      if (!Number.isFinite(rate) || rate <= 0) continue;
      fxRatesToCop[code] = rate;
    }
  }
  if (!Number.isFinite(fxRatesToCop.USD) || fxRatesToCop.USD <= 0) {
    fxRatesToCop.USD = fallbackUsd;
  }

  const supportedRaw = Array.isArray(parsed?.supported_currencies)
    ? parsed.supported_currencies
    : DEFAULT_SUPPORTED_CURRENCIES;
  const supportedCurrencies = Array.from(
    new Set(
      supportedRaw
        .map((value) => normalizeCurrencyCode(value))
        .filter(Boolean),
    ),
  );
  supportedCurrencies.push("COP");
  supportedCurrencies.push("USD");
  Object.keys(fxRatesToCop).forEach((code) => supportedCurrencies.push(code));

  return {
    fxRatesToCop,
    supportedCurrencies: Array.from(new Set(supportedCurrencies)),
    displayUnitCop: Number.isFinite(unit) && unit > 0 ? unit : fallbackUnit,
  };
}

function buildEffectivePriceExpr({
  priceExpr,
  currencyExpr,
  brandOverrideExpr,
  fxRatesToCop,
  supportedCurrencies,
}) {
  const supported = new Set(
    (supportedCurrencies ?? [])
      .map((value) => normalizeCurrencyCode(value))
      .filter(Boolean),
  );
  supported.add("COP");
  supported.add("USD");
  const rates = Object.entries(fxRatesToCop ?? {})
    .map(([rawCode, rawRate]) => ({ code: normalizeCurrencyCode(rawCode), rate: Number(rawRate) }))
    .filter((entry) => entry.code && entry.code !== "COP" && supported.has(entry.code) && Number.isFinite(entry.rate) && entry.rate > 0);

  const caseForCurrency = (expr) => {
    const rateWhens = rates
      .map((entry) => `when ${expr} = '${entry.code}' then (${priceExpr} * ${entry.rate})`)
      .join(" ");
    return `(case when ${expr} = 'COP' then ${priceExpr} ${rateWhens} else null end)`;
  };

  return `(case when ${brandOverrideExpr} <> '' then ${caseForCurrency(brandOverrideExpr)} else ${caseForCurrency(currencyExpr)} end)`;
}

async function main() {
  const connectionString =
    readEnvValue("NEON_DATABASE_URL") || readEnvValue("DATABASE_URL") || readEnvValue("POSTGRES_URL");
  if (!connectionString) {
    throw new Error("Missing NEON_DATABASE_URL/DATABASE_URL/POSTGRES_URL in .env/.env.local/process.env");
  }

  const trmFallback = parsePositiveNumber(readEnvValue("FX_USD_COP_TRM_DEFAULT"), DEFAULT_TRM_USD_COP);
  const displayUnitFallback = parsePositiveNumber(
    readEnvValue("CATALOG_PRICE_DISPLAY_ROUNDING_UNIT_COP"),
    DEFAULT_DISPLAY_UNIT_COP,
  );
  const maxValidPrice = parsePositiveNumber(readEnvValue("CATALOG_PRICE_MAX_VALID"), DEFAULT_MAX_VALID_PRICE);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("set statement_timeout = 0;");
    await client.query("set lock_timeout = 0;");

    const pricingRow = await client.query(
      `
        select "valueJson"
        from "standard_color_config"
        where key = $1
        limit 1
      `,
      ["pricing_config"],
    );
    const pricing = resolvePricingConfig(pricingRow.rows[0]?.valueJson ?? null, trmFallback, displayUnitFallback);
    const effectivePriceVariantExpr = buildEffectivePriceExpr({
      priceExpr: "v.price",
      currencyExpr: "upper(coalesce(v.currency, ''))",
      brandOverrideExpr: "upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', ''))",
      fxRatesToCop: pricing.fxRatesToCop,
      supportedCurrencies: pricing.supportedCurrencies,
    });
    const effectivePriceHistoryExpr = buildEffectivePriceExpr({
      priceExpr: "ph.price",
      currencyExpr: "upper(coalesce(ph.currency, ''))",
      brandOverrideExpr: "upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', ''))",
      fxRatesToCop: pricing.fxRatesToCop,
      supportedCurrencies: pricing.supportedCurrencies,
    });

    console.log(
      JSON.stringify(
        {
          step: "backfill-product-price-change-signals:start",
          fxRatesToCop: pricing.fxRatesToCop,
          supportedCurrencies: pricing.supportedCurrencies,
          displayUnitCop: pricing.displayUnitCop,
          maxValidPrice,
        },
        null,
        2,
      ),
    );

    const startedAt = performance.now();

    const updated = await client.query(
      `
        with ranked_variants as (
          select
            p.id as product_id,
            v.id as variant_id,
            ${effectivePriceVariantExpr} as effective_price_cop,
            row_number() over (
              partition by p.id
              order by
                ${effectivePriceVariantExpr} asc,
                v.id asc
            ) as rn
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
          where (coalesce(v.stock, 0) > 0 or coalesce(v."stockStatus" in ('in_stock', 'preorder'), false))
            and ${effectivePriceVariantExpr} > 0
            and ${effectivePriceVariantExpr} <= $1::numeric
        ),
        base_variant as (
          select product_id, variant_id
          from ranked_variants
          where rn = 1
        ),
        history_ranked as (
          select
            bv.product_id,
            ph."capturedAt" as captured_at,
            ${effectivePriceHistoryExpr} as effective_price_cop,
            row_number() over (
              partition by bv.product_id
              order by ph."capturedAt" desc, ph.id desc
            ) as rn
          from base_variant bv
          join products p on p.id = bv.product_id
          join brands b on b.id = p."brandId"
          join price_history ph on ph."variantId" = bv.variant_id
        ),
        pairs as (
          select
            current.product_id,
            current.captured_at as change_at,
            (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD'
                  or upper(coalesce(p.currency, '')) = 'USD'
                then round(current.effective_price_cop / $2::numeric) * $2::numeric
                else round(current.effective_price_cop)
              end
            ) as current_display,
            (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD'
                  or upper(coalesce(p.currency, '')) = 'USD'
                then round(previous.effective_price_cop / $2::numeric) * $2::numeric
                else round(previous.effective_price_cop)
              end
            ) as previous_display
          from history_ranked current
          join history_ranked previous
            on previous.product_id = current.product_id
           and previous.rn = 2
          join products p on p.id = current.product_id
          join brands b on b.id = p."brandId"
          where current.rn = 1
        ),
        signals as (
          select
            product_id,
            case
              when current_display < previous_display then 'down'
              when current_display > previous_display then 'up'
              else null
            end as direction,
            case
              when current_display <> previous_display then change_at
              else null
            end as change_at
          from pairs
        ),
        recomputed as (
          select p.id as product_id, s.direction, s.change_at
          from products p
          left join signals s on s.product_id = p.id
        )
        update products p
        set
          "priceChangeDirection" = r.direction,
          "priceChangeAt" = r.change_at
        from recomputed r
        where p.id = r.product_id
          and (
            p."priceChangeDirection" is distinct from r.direction
            or p."priceChangeAt" is distinct from r.change_at
          )
        returning p.id, p."priceChangeDirection" as direction
      `,
      [maxValidPrice, pricing.displayUnitCop],
    );

    const upCount = updated.rows.filter((row) => row.direction === "up").length;
    const downCount = updated.rows.filter((row) => row.direction === "down").length;
    const nullCount = updated.rows.length - upCount - downCount;
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));

    console.log(
      JSON.stringify(
        {
          step: "backfill-product-price-change-signals:done",
          updatedProducts: updated.rowCount ?? 0,
          upCount,
          downCount,
          clearedOrUnchangedToNullCount: nullCount,
          elapsedMs,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
