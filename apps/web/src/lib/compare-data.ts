import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getBrandCurrencyOverride,
  getDisplayRoundingUnitCop,
  getPricingConfig,
  getUsdCopTrm,
  toCopEffective,
} from "@/lib/pricing";
import { shouldApplyMarketingRounding, toDisplayedCop } from "@/lib/price-display";

export type CompareProductDetails = {
  id: string;
  brandName: string;
  imageCoverUrl: string | null;
  sourceUrl: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  materials: string[];
  sizes: string[];
};

function uniqSorted(values: Array<string | null | undefined>) {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next.sort((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
}

function isVariantAvailable(variant: { stock: number | null; stockStatus: string | null }) {
  const status = (variant.stockStatus ?? "").toLowerCase();
  if (status === "out_of_stock" || status === "oos") return false;
  if (status.includes("out") && status.includes("stock")) return false;
  if (typeof variant.stock === "number") return variant.stock > 0;
  // Sin señal fuerte: asumimos disponible.
  return true;
}

export async function getCompareProductDetails(ids: string[]): Promise<CompareProductDetails[]> {
  const pricingConfig = await getPricingConfig();
  const trmUsdCop = getUsdCopTrm(pricingConfig);
  const displayUnitCop = getDisplayRoundingUnitCop(pricingConfig);

  const orderedUnique = Array.from(
    new Set(
      ids
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ).slice(0, 3);

  if (orderedUnique.length === 0) return [];

  const rows = await prisma.product.findMany({
    where: { id: { in: orderedUnique } },
    select: {
      id: true,
      brand: { select: { name: true, metadata: true } },
      imageCoverUrl: true,
      sourceUrl: true,
      currency: true,
      materialTags: true,
      variants: {
        select: {
          price: true,
          currency: true,
          size: true,
          material: true,
          stock: true,
          stockStatus: true,
        },
      },
    },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  return orderedUnique.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];

    const brandOverride = getBrandCurrencyOverride(row.brand?.metadata);
    let minCop: number | null = null;
    let maxCop: number | null = null;

    const allSizes: string[] = [];
    const inStockSizes: string[] = [];
    const variantMaterials: string[] = [];

    for (const variant of row.variants) {
      const priceRaw = variant.price ? Number(variant.price.toString()) : null;
      const priceCop = toCopEffective({
        price: priceRaw,
        currency: variant.currency ?? row.currency ?? null,
        brandOverride,
        trmUsdCop,
      });
      if (typeof priceCop === "number" && Number.isFinite(priceCop) && priceCop > 0) {
        minCop = minCop === null ? priceCop : Math.min(minCop, priceCop);
        maxCop = maxCop === null ? priceCop : Math.max(maxCop, priceCop);
      }

      if (variant.material) variantMaterials.push(variant.material);

      if (variant.size) {
        allSizes.push(variant.size);
        if (isVariantAvailable({ stock: variant.stock ?? null, stockStatus: variant.stockStatus ?? null })) {
          inStockSizes.push(variant.size);
        }
      }
    }

    const materials =
      Array.isArray(row.materialTags) && row.materialTags.length > 0
        ? uniqSorted(row.materialTags)
        : uniqSorted(variantMaterials);

    const sizesPreferred = uniqSorted(inStockSizes);
    const sizes = sizesPreferred.length > 0 ? sizesPreferred : uniqSorted(allSizes);

    const applyMarketingRounding = shouldApplyMarketingRounding({
      brandOverride,
      sourceCurrency: row.currency,
    });
    const minDisplay = toDisplayedCop({
      effectiveCop: minCop,
      applyMarketingRounding,
      unitCop: displayUnitCop,
    });
    const maxDisplay = toDisplayedCop({
      effectiveCop: maxCop,
      applyMarketingRounding,
      unitCop: displayUnitCop,
    });

    return [
      {
        id: row.id,
        brandName: row.brand?.name ?? "—",
        imageCoverUrl: row.imageCoverUrl,
        sourceUrl: row.sourceUrl,
        minPrice: minDisplay ? String(Math.round(minDisplay)) : null,
        maxPrice: maxDisplay ? String(Math.round(maxDisplay)) : null,
        currency: "COP",
        materials,
        sizes,
      } satisfies CompareProductDetails,
    ];
  });
}
