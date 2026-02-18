import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPricingConfig, toInputJson, type PricingConfig } from "@/lib/pricing";

export type UsdBrandCandidate = {
  brandId: string;
  brandName: string;
  totalProducts: number;
  suspectProducts: number;
  pct: number;
};

type ApplyResult = {
  ok: true;
  config: PricingConfig;
  evaluatedBrands: number;
  candidateBrands: number;
  markedUsd: number;
  skippedManual: number;
  skippedAlreadyUsd: number;
  errors: number;
  candidates: UsdBrandCandidate[];
};

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPricingMetadata(metadata: unknown): Record<string, unknown> {
  const obj = readObject(metadata);
  const pricing = readObject(obj?.pricing);
  return pricing ?? {};
}

function getPricingString(pricing: Record<string, unknown>, key: string): string | null {
  const value = pricing[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isManualOverride(metadata: unknown): boolean {
  const pricing = readPricingMetadata(metadata);
  const source = getPricingString(pricing, "currency_override_source");
  return (source ?? "").toLowerCase() === "manual";
}

function isAlreadyUsdOverride(metadata: unknown): boolean {
  const pricing = readPricingMetadata(metadata);
  const override = getPricingString(pricing, "currency_override");
  return (override ?? "").toUpperCase() === "USD";
}

export async function computeUsdBrandCandidates(config?: PricingConfig): Promise<{
  config: PricingConfig;
  evaluatedBrands: number;
  candidates: UsdBrandCandidate[];
}> {
  const resolved = config ?? (await getPricingConfig());
  const copLt = resolved.auto_usd_brand.cop_price_lt;
  const threshold = resolved.auto_usd_brand.threshold_pct;
  const includeUsd = resolved.auto_usd_brand.include_usd_variants;

  const rows = await prisma.$queryRaw<
    Array<{
      brandId: string;
      brandName: string;
      totalProducts: number;
      suspectProducts: number;
      pct: number;
    }>
  >(Prisma.sql`
    with totals as (
      select p."brandId" as brand_id, count(*)::int as total_products
      from products p
      group by p."brandId"
    ),
    suspect as (
      select p."brandId" as brand_id, count(distinct v."productId")::int as suspect_products
      from variants v
      join products p on p.id = v."productId"
      where (
        ${includeUsd ? Prisma.sql`upper(coalesce(v.currency,'')) = 'USD'` : Prisma.sql`false`}
        or (upper(coalesce(v.currency,'')) = 'COP' and v.price < ${copLt})
      )
      group by p."brandId"
    )
    select
      b.id as "brandId",
      b.name as "brandName",
      t.total_products as "totalProducts",
      coalesce(s.suspect_products, 0)::int as "suspectProducts",
      -- Prisma maps NUMERIC to Decimal-like objects; cast to float8 so JS receives a number.
      round(100.0 * coalesce(s.suspect_products, 0) / nullif(t.total_products, 0), 4)::float8 as pct
    from totals t
    join brands b on b.id = t.brand_id
    left join suspect s on s.brand_id = t.brand_id
    where t.total_products > 0
    order by pct desc, "suspectProducts" desc, b.name asc
  `);

  const evaluatedBrands = rows.length;
  const candidates = rows
    .filter((row) => Number.isFinite(row.pct) && row.pct > threshold)
    .map((row) => ({
      brandId: row.brandId,
      brandName: row.brandName,
      totalProducts: row.totalProducts,
      suspectProducts: row.suspectProducts,
      pct: row.pct,
    }));

  return { config: resolved, evaluatedBrands, candidates };
}

export async function applyUsdBrandOverrides(params?: { config?: PricingConfig }): Promise<ApplyResult> {
  const resolved = params?.config ?? (await getPricingConfig());

  if (!resolved.auto_usd_brand.enabled) {
    return {
      ok: true,
      config: resolved,
      evaluatedBrands: 0,
      candidateBrands: 0,
      markedUsd: 0,
      skippedManual: 0,
      skippedAlreadyUsd: 0,
      errors: 0,
      candidates: [],
    };
  }

  const { evaluatedBrands, candidates } = await computeUsdBrandCandidates(resolved);
  const candidateBrands = candidates.length;
  if (candidateBrands === 0) {
    return {
      ok: true,
      config: resolved,
      evaluatedBrands,
      candidateBrands: 0,
      markedUsd: 0,
      skippedManual: 0,
      skippedAlreadyUsd: 0,
      errors: 0,
      candidates: [],
    };
  }

  const ids = candidates.map((c) => c.brandId);
  const brandRows = await prisma.brand.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, metadata: true },
  });
  const byId = new Map(brandRows.map((row) => [row.id, row]));

  const now = new Date().toISOString();
  const reason = `pct_gt_${resolved.auto_usd_brand.threshold_pct}_sample_${resolved.auto_usd_brand.include_usd_variants ? "usd_or_" : ""}cop_lt_${resolved.auto_usd_brand.cop_price_lt}`;
  let markedUsd = 0;
  let skippedManual = 0;
  let skippedAlreadyUsd = 0;
  let errors = 0;

  const updates: Array<Promise<unknown>> = [];

  for (const candidate of candidates) {
    const brand = byId.get(candidate.brandId);
    if (!brand) continue;
    const existingMetadata = readObject(brand.metadata) ?? {};

    if (isManualOverride(existingMetadata)) {
      skippedManual += 1;
      continue;
    }
    if (isAlreadyUsdOverride(existingMetadata)) {
      skippedAlreadyUsd += 1;
      continue;
    }

    const pricing = { ...(readPricingMetadata(existingMetadata) ?? {}) };
    pricing.currency_override = "USD";
    pricing.currency_override_source = "auto";
    pricing.currency_override_applied_at = now;
    pricing.currency_override_reason = reason;
    pricing.currency_override_stats = {
      pct: candidate.pct,
      suspect_products: candidate.suspectProducts,
      total_products: candidate.totalProducts,
      computed_at: now,
    };

    const nextMetadata = { ...existingMetadata, pricing };

    updates.push(
      prisma.brand
        .update({
          where: { id: brand.id },
          data: { metadata: toInputJson(nextMetadata) },
        })
        .then(() => {
          markedUsd += 1;
        })
        .catch((err) => {
          errors += 1;
          console.error("pricing.auto_usd_brand.update_failed", brand.id, err);
        }),
    );
  }

  // Avoid an unbounded `Promise.all` even though candidate set is small.
  const BATCH = 25;
  for (let i = 0; i < updates.length; i += BATCH) {
    await Promise.allSettled(updates.slice(i, i + BATCH));
  }

  return {
    ok: true,
    config: resolved,
    evaluatedBrands,
    candidateBrands,
    markedUsd,
    skippedManual,
    skippedAlreadyUsd,
    errors,
    candidates,
  };
}
