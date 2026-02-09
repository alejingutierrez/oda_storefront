import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

function decimalToString(value: Prisma.Decimal | null | undefined) {
  if (!value) return null;
  try {
    const str = value.toString();
    return str;
  } catch {
    return null;
  }
}

export async function getCompareProductDetails(ids: string[]): Promise<CompareProductDetails[]> {
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
      brand: { select: { name: true } },
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

  return orderedUnique
    .map((id) => {
      const row = byId.get(id);
      if (!row) return null;

      let min: Prisma.Decimal | null = null;
      let max: Prisma.Decimal | null = null;
      let currency: string | null = row.currency ?? null;

      const allSizes: string[] = [];
      const inStockSizes: string[] = [];
      const variantMaterials: string[] = [];

      for (const variant of row.variants) {
        if (!currency) currency = variant.currency ?? null;
        const price = variant.price;
        if (price && price.greaterThan(0)) {
          min = !min || price.lessThan(min) ? price : min;
          max = !max || price.greaterThan(max) ? price : max;
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

      return {
        id: row.id,
        brandName: row.brand?.name ?? "—",
        imageCoverUrl: row.imageCoverUrl,
        sourceUrl: row.sourceUrl,
        minPrice: decimalToString(min),
        maxPrice: decimalToString(max),
        currency,
        materials,
        sizes,
      } satisfies CompareProductDetails;
    })
    .filter((item): item is CompareProductDetails => Boolean(item));
}

