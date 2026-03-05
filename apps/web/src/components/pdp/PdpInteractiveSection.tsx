"use client";

import { useState, useMemo } from "react";
import PdpGallery from "@/components/pdp/PdpGallery";
import PdpVariantSelector from "@/components/pdp/PdpVariantSelector";
import PdpPriceDisplay from "@/components/pdp/PdpPriceDisplay";
import PdpCtaButton from "@/components/pdp/PdpCtaButton";
import FavoriteToggle from "@/components/FavoriteToggle";
import Link from "next/link";
import type { PdpProduct } from "@/lib/pdp-data";

type Props = {
  product: PdpProduct;
};

export default function PdpInteractiveSection({ product }: Props) {
  const { colorGroups } = product;
  const defaultColorKey = colorGroups[0]?.colorKey ?? null;

  const [selectedColorKey, setSelectedColorKey] = useState<string | null>(
    defaultColorKey,
  );
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  const activeColorGroup = useMemo(
    () => colorGroups.find((g) => g.colorKey === selectedColorKey) ?? colorGroups[0] ?? null,
    [colorGroups, selectedColorKey],
  );

  const images = useMemo(() => {
    if (activeColorGroup?.images.length) return activeColorGroup.images;
    return product.imageCoverUrl ? [product.imageCoverUrl] : [];
  }, [activeColorGroup, product.imageCoverUrl]);

  // Get price for selected variant, or fall back to product-level price
  const selectedVariant = useMemo(() => {
    if (!activeColorGroup || !selectedSize) return null;
    return activeColorGroup.sizes.find((s) => s.size === selectedSize) ?? null;
  }, [activeColorGroup, selectedSize]);

  const displayPrice = selectedVariant?.price ?? product.minPriceCop;
  const displayCurrency = selectedVariant?.currency ?? product.currency ?? "COP";
  const hasRange =
    !selectedVariant &&
    product.minPriceCop &&
    product.maxPriceCop &&
    product.minPriceCop !== product.maxPriceCop;

  return (
    <div className="lg:grid lg:grid-cols-[1fr_420px] lg:gap-10 xl:gap-14">
      {/* Left column: Gallery */}
      <PdpGallery images={images} productName={product.name} productId={product.id} />

      {/* Right column: Product info (sticky on desktop) */}
      <div className="mt-6 lg:mt-0">
        <div className="lg:sticky lg:top-[calc(var(--oda-header-h,72px)+1rem)] lg:max-h-[calc(100vh-var(--oda-header-h,72px)-2rem)] lg:overflow-y-auto lg:pr-1">
          {/* Brand */}
          <Link
            href={`/marca/${product.brand.slug}`}
            prefetch={false}
            className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
          >
            {product.brand.name}
          </Link>

          {/* Product name */}
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-xl leading-snug text-[color:var(--oda-ink)] sm:text-2xl">
            {product.name}
          </h1>

          {/* Price */}
          <div className="mt-3">
            <PdpPriceDisplay
              price={displayPrice}
              currency={displayCurrency}
              hasRange={!!hasRange}
              priceChangeDirection={product.priceChangeDirection}
            />
          </div>

          {/* Availability badge */}
          {!product.hasInStock && (
            <span className="mt-2 inline-block rounded-full bg-[color:var(--oda-stone)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--oda-taupe)]">
              Agotado
            </span>
          )}

          {/* Variant selector */}
          {colorGroups.length > 0 && (
            <div className="mt-6">
              <PdpVariantSelector
                colorGroups={colorGroups}
                selectedColorKey={selectedColorKey}
                selectedSize={selectedSize}
                onColorChange={(key) => {
                  setSelectedColorKey(key);
                  setSelectedSize(null);
                }}
                onSizeChange={setSelectedSize}
              />
            </div>
          )}

          {/* CTA + Favorite */}
          <div className="mt-6 flex items-center gap-3">
            <div className="flex-1">
              <PdpCtaButton
                sourceUrl={product.sourceUrl}
                brandName={product.brand.name}
                productId={product.id}
                hasInStock={product.hasInStock}
              />
            </div>
            <FavoriteToggle
              productId={product.id}
              productName={product.name}
              className="shrink-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
