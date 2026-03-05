"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ArrowUp } from "lucide-react";
import { proxiedImageUrl } from "@/lib/image-proxy";
import type { PdpRelatedProduct } from "@/lib/pdp-data";

type Props = {
  products: PdpRelatedProduct[];
};

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) return "Consultar";
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? "COP"} ${value.toFixed(0)}`;
  }
}

function productHref(p: PdpRelatedProduct): string {
  if (p.slug && p.brandSlug) return `/producto/${p.brandSlug}/${p.slug}`;
  return p.sourceUrl ?? "#";
}

export default function PdpRelatedProducts({ products }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  const scroll = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.querySelector("a")?.offsetWidth ?? 300;
    el.scrollBy({
      left: direction === "right" ? cardWidth + 16 : -(cardWidth + 16),
      behavior: "smooth",
    });
  }, []);

  if (products.length === 0) return null;

  return (
    <section className="mt-12 pb-16 lg:mt-16">
      {/* Section header with decorative lines */}
      <div className="mb-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-[color:var(--oda-border)]" />
        <h2 className="shrink-0 text-sm uppercase tracking-[0.22em] text-[color:var(--oda-ink)]">
          También te puede gustar
        </h2>
        <div className="h-px flex-1 bg-[color:var(--oda-border)]" />
      </div>

      {/* Carousel with arrows */}
      <div className="relative">
        {/* Left arrow — desktop only */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scroll("left")}
            className="absolute -left-2 top-1/3 z-10 hidden h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur-sm transition hover:bg-white lg:flex"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-5 w-5 text-[color:var(--oda-ink)]" />
          </button>
        )}

        {/* Right arrow — desktop only */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scroll("right")}
            className="absolute -right-2 top-1/3 z-10 hidden h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur-sm transition hover:bg-white lg:flex"
            aria-label="Siguiente"
          >
            <ChevronRight className="h-5 w-5 text-[color:var(--oda-ink)]" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto oda-no-scrollbar pb-2"
        >
          {products.map((product) => {
            const imageSrc = proxiedImageUrl(product.imageCoverUrl, {
              productId: product.id,
              kind: "cover",
            });
            const href = productHref(product);
            const isExternal = !product.slug;

            return (
              <Link
                key={product.id}
                href={href}
                prefetch={false}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noreferrer" : undefined}
                className="group flex w-[44vw] shrink-0 snap-start flex-col gap-3 transition-transform duration-300 hover:-translate-y-1 sm:w-[32vw] lg:w-[23vw] xl:w-[18vw]"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={product.name}
                      fill
                      quality={58}
                      sizes="(max-width: 640px) 44vw, (max-width: 1024px) 32vw, 18vw"
                      className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-4">
                      <span className="text-center text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                        {product.brandName}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    {product.brandName}
                  </span>
                  <span className="line-clamp-2 text-sm leading-snug text-[color:var(--oda-ink)]">
                    {product.name}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
                    {formatPrice(product.minPrice, product.currency)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Back to top */}
      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
        >
          <ArrowUp className="h-3.5 w-3.5" />
          Volver arriba
        </button>
      </div>
    </section>
  );
}
