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

function resolveTrmFromConfig(valueJson, fallback) {
  let parsed = valueJson;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const trm = Number(parsed.usd_cop_trm);
  return Number.isFinite(trm) && trm > 0 ? trm : fallback;
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

    const trmUsdCop = resolveTrmFromConfig(pricingRow.rows[0]?.valueJson ?? null, trmFallback);

    console.log(
      JSON.stringify(
        {
          step: "backfill-product-price-rollups:start",
          trmUsdCop,
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
            (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD' then (v.price * $1::numeric)
                when upper(coalesce(v.currency, '')) = 'USD' then (v.price * $1::numeric)
                else v.price
              end
            ) as effective_price
          from products p
          join brands b on b.id = p."brandId"
          left join variants v on v."productId" = p.id
        ),
        rollups as (
          select
            product_id,
            bool_or(in_stock) as has_in_stock,
            min(case when in_stock and effective_price > 0 and effective_price <= $2::numeric then effective_price end) as min_price,
            max(case when in_stock and effective_price > 0 and effective_price <= $2::numeric then effective_price end) as max_price
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
      [trmUsdCop, maxValidPrice],
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
