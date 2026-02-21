import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import {
  getBrandCurrencyOverride,
  getDisplayRoundingUnitCop,
  getPricingConfig,
  getUsdCopTrm,
  toCopEffective,
} from "@/lib/pricing";
import { shouldApplyMarketingRounding, toDisplayedCop } from "@/lib/price-display";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ productId: string }> }) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { productId } = await context.params;
  if (!productId) {
    return NextResponse.json({ error: "missing_product" }, { status: 400 });
  }

  const pricingConfig = await getPricingConfig();
  const trmUsdCop = getUsdCopTrm(pricingConfig);
  const displayUnitCop = getDisplayRoundingUnitCop(pricingConfig);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      brand: { select: { id: true, name: true, logoUrl: true, metadata: true } },
      variants: true,
    },
  });

  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const brandOverride = getBrandCurrencyOverride(product.brand?.metadata);

  const variants = product.variants
    .map((variant) => {
      const storedCurrency = variant.currency;
      const storedPrice = typeof variant.price === "number" ? variant.price : Number(variant.price);
      const effectiveCop = toCopEffective({
        price: Number.isFinite(storedPrice) ? storedPrice : null,
        currency: storedCurrency,
        brandOverride,
        trmUsdCop,
      });
      const applyMarketingRounding = shouldApplyMarketingRounding({
        brandOverride,
        sourceCurrency: storedCurrency,
      });
      const displayCop = toDisplayedCop({
        effectiveCop,
        applyMarketingRounding,
        unitCop: displayUnitCop,
      });

      return {
        ...variant,
        // Always show prices in COP for admin display.
        price: displayCop,
        currency: "COP",
        // Keep the raw values for debugging / audits in admin.
        priceStored: variant.price,
        currencyStored: storedCurrency,
        priceCopEffective: effectiveCop,
      };
    })
    .sort((a, b) => {
      const aPrice = typeof a.price === "number" ? a.price : Infinity;
      const bPrice = typeof b.price === "number" ? b.price : Infinity;
      return aPrice - bPrice;
    });

  const payload = {
    ...product,
    currency: "COP",
    brand: { id: product.brand.id, name: product.brand.name, logoUrl: product.brand.logoUrl },
    variants,
  };

  return NextResponse.json({ product: payload });
}
