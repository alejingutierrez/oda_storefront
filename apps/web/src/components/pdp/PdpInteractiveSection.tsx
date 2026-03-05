"use client";

import type { ReactNode } from "react";
import { useState, useMemo, useCallback } from "react";
import PdpGallery from "@/components/pdp/PdpGallery";
import PdpVariantSelector from "@/components/pdp/PdpVariantSelector";
import PdpPriceDisplay from "@/components/pdp/PdpPriceDisplay";
import PdpCtaButton from "@/components/pdp/PdpCtaButton";
import FavoriteToggle from "@/components/FavoriteToggle";
import Link from "next/link";
import { Share2, Check } from "lucide-react";
import type { PdpProduct } from "@/lib/pdp-data";
import { stripHtml } from "@/lib/utils";

type Props = {
  product: PdpProduct;
  accordionContent?: ReactNode;
};

function formatPriceCop(amount: string | null, currency: string) {
  if (!amount || Number(amount) <= 0) return null;
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toFixed(0)}`;
  }
}

export default function PdpInteractiveSection({
  product,
  accordionContent,
}: Props) {
  const { colorGroups } = product;
  const defaultColorKey = colorGroups[0]?.colorKey ?? null;

  const [selectedColorKey, setSelectedColorKey] = useState<string | null>(
    defaultColorKey,
  );
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeColorGroup = useMemo(
    () =>
      colorGroups.find((g) => g.colorKey === selectedColorKey) ??
      colorGroups[0] ??
      null,
    [colorGroups, selectedColorKey],
  );

  const images = useMemo(() => {
    if (activeColorGroup?.images.length) return activeColorGroup.images;
    return product.imageCoverUrl ? [product.imageCoverUrl] : [];
  }, [activeColorGroup, product.imageCoverUrl]);

  // Get price for selected variant, or fall back to product-level price
  const selectedVariant = useMemo(() => {
    if (!activeColorGroup || !selectedSize) return null;
    return (
      activeColorGroup.sizes.find((s) => s.size === selectedSize) ?? null
    );
  }, [activeColorGroup, selectedSize]);

  const displayPrice = selectedVariant?.price ?? product.minPriceCop;
  const displayCurrency =
    selectedVariant?.currency ?? product.currency ?? "COP";
  const hasRange =
    !selectedVariant &&
    product.minPriceCop &&
    product.maxPriceCop &&
    product.minPriceCop !== product.maxPriceCop;

  // Clean description: prefer seoDescription, fall back to description
  const displayDescription =
    stripHtml(product.seoDescription) ?? stripHtml(product.description);

  // Format price for mobile sticky bar
  const mobilePriceText = formatPriceCop(displayPrice, displayCurrency);

  const handleShare = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, []);

  return (
    <>
      <div className="lg:grid lg:grid-cols-[1fr_420px] lg:gap-14 xl:gap-20">
        {/* Left column: Gallery */}
        <div className={!product.hasInStock ? "relative" : undefined}>
          <PdpGallery
            images={images}
            productName={product.name}
            productId={product.id}
          />
          {/* Out-of-stock overlay */}
          {!product.hasInStock && (
            <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
              <span className="rounded-full bg-black/50 px-6 py-2.5 text-xs font-medium uppercase tracking-[0.2em] text-white backdrop-blur-sm">
                Agotado
              </span>
            </div>
          )}
        </div>

        {/* Right column: Product info (sticky on desktop) */}
        <div className="mt-6 lg:mt-0">
          <div className="relative lg:sticky lg:top-[calc(var(--oda-header-h,72px)+1rem)] lg:max-h-[calc(100vh-var(--oda-header-h,72px)-2rem)] lg:overflow-y-auto lg:pr-1 oda-no-scrollbar">
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

            {/* Short description (SEO) */}
            {displayDescription && (
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">
                {displayDescription}
              </p>
            )}

            {/* SEO Tags as non-clickable chips */}
            {product.seoTags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {product.seoTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[color:var(--oda-stone)] px-3 py-1 text-[11px] tracking-[0.1em] text-[color:var(--oda-taupe)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Availability badge */}
            {!product.hasInStock && (
              <span className="mt-3 inline-block rounded-full bg-[color:var(--oda-stone)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--oda-taupe)]">
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

            {/* CTA + Favorite + Share */}
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
              <button
                type="button"
                onClick={handleShare}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] transition hover:border-[color:var(--oda-ink)] hover:text-[color:var(--oda-ink)]"
                aria-label="Compartir"
                title="Copiar enlace"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* SEO Title before accordions (if different from product name) */}
            {product.seoTitle &&
              product.seoTitle !== product.name && (
                <p className="mt-6 text-xs leading-relaxed text-[color:var(--oda-ink-soft)] italic">
                  {product.seoTitle}
                </p>
              )}

            {/* Accordions (desktop only — mobile rendered by PdpLayout) */}
            {accordionContent && (
              <div className="mt-4 hidden border-t border-[color:var(--oda-border)] pt-2 lg:block">
                {accordionContent}
              </div>
            )}

            {/* Scroll indicator — desktop sidebar fade */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-8 bg-gradient-to-t from-[color:var(--oda-cream)] to-transparent lg:block" />
          </div>
        </div>
      </div>

      {/* Sticky CTA bar — mobile only */}
      {product.sourceUrl && (
        <div className="fixed inset-x-0 bottom-[var(--oda-mobile-fixed-bottom-offset,0px)] z-40 border-t border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden">
          <div className="flex items-center gap-3">
            {/* Price in mobile bar */}
            {mobilePriceText && (
              <div className="flex shrink-0 flex-col">
                <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--oda-taupe)]">
                  {hasRange ? "Desde" : "Precio"}
                </span>
                <span className="text-sm font-medium text-[color:var(--oda-ink)]">
                  {mobilePriceText}
                </span>
              </div>
            )}
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
      )}
    </>
  );
}
