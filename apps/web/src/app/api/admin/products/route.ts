import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { buildEffectiveVariantPriceCopExpr } from "@/lib/catalog-query";
import { CATALOG_MAX_VALID_PRICE } from "@/lib/catalog-price";
import { getBrandCurrencyOverride, getDisplayRoundingUnitCop, getPricingConfig, getUsdCopTrm } from "@/lib/pricing";
import { shouldApplyMarketingRounding, toDisplayedCop } from "@/lib/price-display";

export const runtime = "nodejs";

const MAX_GALLERY_IMAGES = 8;

const toNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pricingConfig = await getPricingConfig();
  const pricing = { trmUsdCop: getUsdCopTrm(pricingConfig) };
  const displayUnitCop = getDisplayRoundingUnitCop(pricingConfig);
  const priceCopExpr = buildEffectiveVariantPriceCopExpr(pricing);

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(30, Math.max(1, Number(url.searchParams.get("pageSize") ?? 15)));
  const brandId = url.searchParams.get("brandId");

  const where = brandId ? { brandId } : {};

  const totalCount = await prisma.product.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const products = await prisma.product.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      brand: { select: { id: true, name: true, logoUrl: true, metadata: true } },
    },
  });

  const productIds = products.map((product) => product.id);
  const variantImages = productIds.length
    ? await prisma.variant.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, images: true },
      })
    : [];
  const variantAgg = productIds.length
    ? await prisma.$queryRaw<
        Array<{ productId: string; minPrice: string | null; maxPrice: string | null; count: bigint }>
      >(Prisma.sql`
        select
          v."productId" as "productId",
          min(case when ${priceCopExpr} > 0 and ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} then ${priceCopExpr} end) as "minPrice",
          max(case when ${priceCopExpr} > 0 and ${priceCopExpr} <= ${CATALOG_MAX_VALID_PRICE} then ${priceCopExpr} end) as "maxPrice",
          count(*) as "count"
        from variants v
        join products p on p.id = v."productId"
        join brands b on b.id = p."brandId"
        where v."productId" in (${Prisma.join(productIds)})
        group by v."productId"
      `)
    : [];

  const stockAgg = productIds.length
    ? await prisma.variant.groupBy({
        by: ["productId", "stockStatus"],
        where: { productId: { in: productIds } },
        _count: { _all: true },
      })
    : [];

  const variantMap = new Map<
    string,
    { minPrice: number | null; maxPrice: number | null; count: number }
  >();
  variantAgg.forEach((row) => {
    const minRaw = toNumber(row.minPrice);
    const maxRaw = toNumber(row.maxPrice);
    variantMap.set(row.productId, {
      minPrice: minRaw,
      maxPrice: maxRaw,
      count: Number(row.count ?? 0),
    });
  });

  const stockMap = new Map<string, number>();
  stockAgg.forEach((row) => {
    if (row.stockStatus !== "in_stock") return;
    const current = stockMap.get(row.productId) ?? 0;
    stockMap.set(row.productId, current + (row._count._all ?? 0));
  });

  const imageMap = new Map<string, string[]>();
  const imageSetMap = new Map<string, Set<string>>();
  variantImages.forEach((row) => {
    if (!row.images.length) return;
    let set = imageSetMap.get(row.productId);
    if (!set) {
      set = new Set();
      imageSetMap.set(row.productId, set);
    }
    if (set.size >= MAX_GALLERY_IMAGES) return;
    for (const url of row.images) {
      if (!url || set.has(url)) continue;
      set.add(url);
      if (set.size >= MAX_GALLERY_IMAGES) break;
    }
  });
  imageSetMap.forEach((set, productId) => {
    imageMap.set(productId, Array.from(set));
  });

  const payload = products.map((product) => {
    const stats = variantMap.get(product.id);
    const brandOverride = getBrandCurrencyOverride(product.brand?.metadata);
    const applyMarketingRounding = shouldApplyMarketingRounding({
      brandOverride,
      sourceCurrency: product.currency,
    });
    const minPrice = toDisplayedCop({
      effectiveCop: stats?.minPrice ?? null,
      applyMarketingRounding,
      unitCop: displayUnitCop,
    });
    const maxPrice = toDisplayedCop({
      effectiveCop: stats?.maxPrice ?? null,
      applyMarketingRounding,
      unitCop: displayUnitCop,
    });
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      subcategory: product.subcategory,
      styleTags: product.styleTags,
      materialTags: product.materialTags,
      patternTags: product.patternTags,
      occasionTags: product.occasionTags,
      gender: product.gender,
      season: product.season,
      care: product.care,
      origin: product.origin,
      status: product.status,
      sourceUrl: product.sourceUrl,
      currency: "COP",
      imageCoverUrl: product.imageCoverUrl,
      imageGallery: imageMap.get(product.id) ?? [],
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      brand: product.brand ? { id: product.brand.id, name: product.brand.name, logoUrl: product.brand.logoUrl } : null,
      variantCount: stats?.count ?? 0,
      inStockCount: stockMap.get(product.id) ?? 0,
      minPrice,
      maxPrice,
    };
  });

  return NextResponse.json({
    page,
    pageSize,
    totalPages,
    totalCount,
    products: payload,
  });
}
