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

function resolvePricingConfig(valueJson, fallbackUsdTrm) {
  const parsed = parseJson(valueJson);
  const usdRoot = Number(parsed?.usd_cop_trm);
  const fallbackUsd =
    Number.isFinite(usdRoot) && usdRoot > 0
      ? usdRoot
      : fallbackUsdTrm;

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
  const connectionString = readEnvValue("NEON_DATABASE_URL") || readEnvValue("DATABASE_URL") || readEnvValue("POSTGRES_URL");
  if (!connectionString) {
    throw new Error("Missing NEON_DATABASE_URL/DATABASE_URL/POSTGRES_URL in .env/.env.local/process.env");
  }

  const trmFallback = parsePositiveNumber(readEnvValue("FX_USD_COP_TRM_DEFAULT"), DEFAULT_TRM_USD_COP);
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

    const pricing = resolvePricingConfig(pricingRow.rows[0]?.valueJson ?? null, trmFallback);
    const effectivePriceExpr = buildEffectivePriceExpr({
      priceExpr: "v.price",
      currencyExpr: "upper(coalesce(v.currency, ''))",
      brandOverrideExpr: "upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', ''))",
      fxRatesToCop: pricing.fxRatesToCop,
      supportedCurrencies: pricing.supportedCurrencies,
    });

    console.log(
      JSON.stringify(
        {
          step: "backfill-product-price-rollups:start",
          fxRatesToCop: pricing.fxRatesToCop,
          supportedCurrencies: pricing.supportedCurrencies,
          maxValidPrice,
        },
        null,
        2,
      ),
    );

    const startedAt = performance.now();

    const result = await client.query(
      `
        with variant_prices as (
          select
            p.id as product_id,
            ((coalesce(v.stock, 0) > 0) or coalesce(v."stockStatus" in ('in_stock','preorder'), false)) as in_stock,
            ${effectivePriceExpr} as effective_price
          from products p
          join brands b on b.id = p."brandId"
          left join variants v on v."productId" = p.id
        ),
        rollups as (
          select
            product_id,
            bool_or(in_stock) as has_in_stock,
            min(case when in_stock and effective_price > 0 and effective_price <= $1::numeric then effective_price end) as min_price,
            max(case when in_stock and effective_price > 0 and effective_price <= $1::numeric then effective_price end) as max_price
          from variant_prices
          group by product_id
        )
        update products p
        set
          "hasInStock" = coalesce(r.has_in_stock, false),
          "minPriceCop" = r.min_price,
          "maxPriceCop" = r.max_price,
          "priceRollupUpdatedAt" = now()
        from rollups r
        where r.product_id = p.id
      `,
      [maxValidPrice],
    );

    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    console.log(
      JSON.stringify(
        {
          step: "backfill-product-price-rollups:done",
          updatedProducts: result.rowCount ?? 0,
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
