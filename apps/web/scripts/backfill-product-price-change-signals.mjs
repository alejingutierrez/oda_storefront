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

function resolvePricingConfig(valueJson, fallbackTrm, fallbackUnit) {
  const parsed = parseJson(valueJson);
  const trm = Number(parsed?.usd_cop_trm);
  const unit = Number(parsed?.display_rounding?.unit_cop);
  return {
    trmUsdCop: Number.isFinite(trm) && trm > 0 ? trm : fallbackTrm,
    displayUnitCop: Number.isFinite(unit) && unit > 0 ? unit : fallbackUnit,
  };
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

    console.log(
      JSON.stringify(
        {
          step: "backfill-product-price-change-signals:start",
          trmUsdCop: pricing.trmUsdCop,
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
            (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD' then (v.price * $1::numeric)
                when upper(coalesce(v.currency, '')) = 'USD' then (v.price * $1::numeric)
                else v.price
              end
            ) as effective_price_cop,
            row_number() over (
              partition by p.id
              order by
                (
                  case
                    when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD' then (v.price * $1::numeric)
                    when upper(coalesce(v.currency, '')) = 'USD' then (v.price * $1::numeric)
                    else v.price
                  end
                ) asc,
                v.id asc
            ) as rn
          from products p
          join brands b on b.id = p."brandId"
          join variants v on v."productId" = p.id
          where (coalesce(v.stock, 0) > 0 or coalesce(v."stockStatus" in ('in_stock', 'preorder'), false))
            and (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD' then (v.price * $1::numeric)
                when upper(coalesce(v.currency, '')) = 'USD' then (v.price * $1::numeric)
                else v.price
              end
            ) > 0
            and (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD' then (v.price * $1::numeric)
                when upper(coalesce(v.currency, '')) = 'USD' then (v.price * $1::numeric)
                else v.price
              end
            ) <= $2::numeric
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
            (
              case
                when upper(coalesce(b.metadata -> 'pricing' ->> 'currency_override', '')) = 'USD' then (ph.price * $1::numeric)
                when upper(coalesce(ph.currency, '')) = 'USD' then (ph.price * $1::numeric)
                else ph.price
              end
            ) as effective_price_cop,
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
            round(current.effective_price_cop / $3::numeric) * $3::numeric as current_display,
            round(previous.effective_price_cop / $3::numeric) * $3::numeric as previous_display
          from history_ranked current
          join history_ranked previous
            on previous.product_id = current.product_id
           and previous.rn = 2
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
      [pricing.trmUsdCop, maxValidPrice, pricing.displayUnitCop],
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
