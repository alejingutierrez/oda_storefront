"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeProductCardData } from "@/lib/home-types";

export default function ProductCarousel({
  title,
  subtitle,
  ctaHref,
  ctaLabel,
  products,
  ariaLabel,
}: {
  title: string;
  subtitle?: string;
  ctaHref?: string;
  ctaLabel?: string;
  products: HomeProductCardData[];
  ariaLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const scrollByCards = (direction: -1 | 1) => {
    const node = scrollRef.current;
    if (!node) return;
    const amount = Math.max(node.clientWidth * 0.82, 320);
    node.scrollBy({ left: amount * direction, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">{subtitle}</p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">{title}</h2>
        </div>

        <div className="flex items-center gap-3">
          {ctaHref && ctaLabel ? (
            <Link
              href={ctaHref}
              className="hidden text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)] sm:inline"
            >
              {ctaLabel}
            </Link>
          ) : null}

          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => scrollByCards(-1)}
              className="rounded-full border border-[color:var(--oda-border)] bg-white p-2 text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              aria-label="Desplazar a la izquierda"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => scrollByCards(1)}
              className="rounded-full border border-[color:var(--oda-border)] bg-white p-2 text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              aria-label="Desplazar a la derecha"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        data-dragging={isDragging ? "true" : "false"}
        className="home-hide-scroll home-drag-scroll flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 pr-6"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") return;
          const node = scrollRef.current;
          if (!node) return;
          dragState.current = {
            startX: event.clientX,
            startScrollLeft: node.scrollLeft,
          };
          setIsDragging(true);
        }}
        onPointerMove={(event) => {
          const node = scrollRef.current;
          const drag = dragState.current;
          if (!node || !drag) return;
          const delta = event.clientX - drag.startX;
          node.scrollLeft = drag.startScrollLeft - delta;
        }}
        onPointerUp={() => {
          dragState.current = null;
          setIsDragging(false);
        }}
        onPointerCancel={() => {
          dragState.current = null;
          setIsDragging(false);
        }}
        onPointerLeave={() => {
          dragState.current = null;
          setIsDragging(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            scrollByCards(1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            scrollByCards(-1);
          }
        }}
      >
        {products.map((product) => (
          <div key={product.id} className="min-w-[72%] snap-start sm:min-w-[46%] lg:min-w-[29%] xl:min-w-[23.5%]">
            <HomeProductCard
              product={product}
              sizes="(max-width: 640px) 74vw, (max-width: 1024px) 40vw, 25vw"
            />
          </div>
        ))}
      </div>

      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)] sm:hidden">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
