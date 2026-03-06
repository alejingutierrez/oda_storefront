"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { StyleGroup } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

/**
 * CuratedStyleShowcase — Full-width immersive Real Style section.
 *
 * Replaces the old CuratedStickyEdit with a more prominent layout:
 * - Full-bleed hero image for the active style
 * - Horizontal style tab selector
 * - Products displayed in a scrollable rail below
 * - Designed to sit right after the hero as the #1 below-fold section
 */

const PRODUCTS_PER_STYLE = 6;

export default function CuratedStyleShowcase({ styleGroups }: { styleGroups: StyleGroup[] }) {
  const groups = useMemo(() => styleGroups.filter((g) => g.products.length > 0), [styleGroups]);
  const [activeIndex, setActiveIndex] = useState(0);
  const productScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset scroll when switching styles
    productScrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [activeIndex]);

  if (groups.length === 0) return null;

  const safeIndex = Math.min(activeIndex, groups.length - 1);
  const active = groups[safeIndex];

  // Use the 2nd product as the hero background (1st shows in the rail)
  const heroProduct = active.products[1] ?? active.products[0] ?? null;
  const heroImageSrc = proxiedImageUrl(heroProduct?.imageCoverUrl ?? null, {
    productId: heroProduct?.id ?? null,
    kind: "cover",
  });

  // Secondary product for the floating card
  const featuredProduct = active.products[0] ?? null;
  const featuredImageSrc = featuredProduct
    ? proxiedImageUrl(featuredProduct.imageCoverUrl, { productId: featuredProduct.id, kind: "cover" })
    : null;

  return (
    <section className="relative overflow-hidden bg-[color:var(--oda-ink)]">
      {/* Hero background */}
      <div className="absolute inset-0">
        {groups.map((group, idx) => {
          const bgProduct = group.products[1] ?? group.products[0];
          const bgSrc = bgProduct
            ? proxiedImageUrl(bgProduct.imageCoverUrl, { productId: bgProduct.id, kind: "cover" })
            : null;
          return (
            <div
              key={group.styleKey}
              className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                idx === safeIndex ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden={idx !== safeIndex}
            >
              {bgSrc ? (
                <Image
                  src={bgSrc}
                  alt=""
                  fill
                  quality={48}
                  sizes="100vw"
                  className="object-cover scale-105 blur-[2px]"
                />
              ) : null}
            </div>
          );
        })}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />
      </div>

      <div className="relative">
        {/* Header + Style tabs */}
        <div className="oda-container pt-12 sm:pt-16 lg:pt-20">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--oda-gold)]">Real Style</p>
              <h2 className="font-display text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
                Looks curados para ti
              </h2>
              <p className="max-w-lg text-sm leading-relaxed text-white/70 sm:text-base">
                Estilos reales armados con piezas de marcas colombianas. Descubre, inspírate y compra cada prenda.
              </p>
            </div>

            <Link
              href="/estilo"
              prefetch={false}
              className="hidden shrink-0 rounded-full border border-white/40 px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-white transition hover:bg-white/10 sm:inline-flex"
            >
              Ver todos los estilos
            </Link>
          </div>

          {/* Style tab selector */}
          <div className="home-hide-scroll mt-8 flex gap-2 overflow-x-auto pb-1">
            {groups.map((group, idx) => {
              const isActive = idx === safeIndex;
              const thumbProduct = group.products[0];
              const thumbSrc = thumbProduct
                ? proxiedImageUrl(thumbProduct.imageCoverUrl, { productId: thumbProduct.id, kind: "cover" })
                : null;

              return (
                <button
                  key={group.styleKey}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`group flex shrink-0 items-center gap-3 rounded-full px-2 py-2 pr-5 transition ${
                    isActive
                      ? "bg-white/20 backdrop-blur-sm"
                      : "bg-white/5 hover:bg-white/12"
                  }`}
                >
                  <div className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-full ring-2 transition ${
                    isActive ? "ring-[color:var(--oda-gold)]" : "ring-white/20 group-hover:ring-white/40"
                  }`}>
                    {thumbSrc ? (
                      <Image
                        src={thumbSrc}
                        alt=""
                        fill
                        quality={45}
                        sizes="40px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <span className={`text-[12px] font-medium tracking-wide transition ${
                    isActive ? "text-white" : "text-white/60 group-hover:text-white/80"
                  }`}>
                    {group.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main content: hero image + featured card */}
        <div className="oda-container pb-6 pt-8 sm:pt-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:gap-8">
            {/* Hero style image */}
            <div className="relative aspect-[3/4] overflow-hidden rounded-[1.6rem] border border-white/12 sm:aspect-[4/5] lg:aspect-[3/4]">
              {groups.map((group, idx) => {
                const imgProduct = group.products[1] ?? group.products[0];
                const imgSrc = imgProduct
                  ? proxiedImageUrl(imgProduct.imageCoverUrl, { productId: imgProduct.id, kind: "cover" })
                  : null;
                return (
                  <div
                    key={group.styleKey}
                    className={`absolute inset-0 transition-opacity duration-500 ease-out ${
                      idx === safeIndex ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {imgSrc ? (
                      <Image
                        src={imgSrc}
                        alt={group.label}
                        fill
                        quality={62}
                        sizes="(max-width: 1024px) 100vw, 55vw"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                );
              })}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 sm:bottom-8 sm:left-8 sm:right-8">
                <p className="font-display text-3xl leading-none text-white sm:text-4xl lg:text-5xl">
                  {active.label}
                </p>
                <p className="mt-2 text-sm text-white/75">{active.products.length} piezas para armar este look</p>
              </div>
            </div>

            {/* Right column: featured product + style CTA */}
            <div className="flex flex-col gap-5">
              {featuredProduct ? (
                <div className="overflow-hidden rounded-[1.4rem] border border-white/12 bg-white/8 backdrop-blur-md">
                  <div className="relative aspect-[4/5] w-full">
                    {featuredImageSrc ? (
                      <Image
                        src={featuredImageSrc}
                        alt={featuredProduct.name}
                        fill
                        quality={58}
                        sizes="(max-width: 1024px) 100vw, 40vw"
                        className="object-cover"
                      />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute bottom-5 left-5 right-5 text-white">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--oda-gold)]">
                        Pieza clave del look
                      </p>
                      <p className="mt-1.5 text-lg leading-tight">{featuredProduct.name}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/78">
                        {featuredProduct.brandName}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <Link
                href={`/estilo/${encodeURIComponent(active.styleKey)}`}
                prefetch={false}
                className="flex items-center justify-center rounded-full bg-[color:var(--oda-cream)] px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-white"
              >
                Comprar este look completo
              </Link>
            </div>
          </div>
        </div>

        {/* Product rail */}
        <div className="border-t border-white/10 bg-black/20 backdrop-blur-sm">
          <div className="oda-container py-8 sm:py-10">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.22em] text-white/60">
                Piezas del look · {active.label}
              </p>
              <Link
                href={`/estilo/${encodeURIComponent(active.styleKey)}`}
                prefetch={false}
                className="text-[11px] uppercase tracking-[0.2em] text-white/50 transition hover:text-white/80"
              >
                Ver todo
              </Link>
            </div>

            <div
              ref={productScrollRef}
              className="home-hide-scroll flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 pr-6"
            >
              {active.products.slice(0, PRODUCTS_PER_STYLE).map((product) => (
                <div
                  key={`${active.styleKey}-${product.id}`}
                  className="min-w-[60%] snap-start sm:min-w-[38%] lg:min-w-[22%] xl:min-w-[18%]"
                >
                  <HomeProductCard
                    product={product}
                    surface="home_style_showcase"
                    sizes="(max-width: 640px) 62vw, (max-width: 1024px) 38vw, 22vw"
                    className="[&_span]:text-white/80 [&_span]:hover:text-white"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile CTA */}
        <div className="oda-container pb-8 sm:hidden">
          <Link
            href="/estilo"
            prefetch={false}
            className="block text-center text-[11px] uppercase tracking-[0.2em] text-white/60"
          >
            Ver todos los estilos
          </Link>
        </div>
      </div>
    </section>
  );
}
