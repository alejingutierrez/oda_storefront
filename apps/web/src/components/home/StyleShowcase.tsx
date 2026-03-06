"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { StyleGroup } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

export default function StyleShowcase({
  styleGroups,
  expandedCount = 3,
}: {
  styleGroups: StyleGroup[];
  expandedCount?: number;
}) {
  const [showAll, setShowAll] = useState(false);

  if (styleGroups.length === 0) return null;

  const visibleGroups = showAll ? styleGroups : styleGroups.slice(0, expandedCount);
  const hasMore = styleGroups.length > expandedCount && !showAll;

  return (
    <div className="flex flex-col">
      {visibleGroups.map((group, index) => {
        // Use 2nd product as hero cover for visual variety
        const coverProduct = group.products[1] ?? group.products[0] ?? null;
        const coverImage = proxiedImageUrl(coverProduct?.imageCoverUrl ?? null, {
          productId: coverProduct?.id ?? null,
          kind: "cover",
        });
        const displayProducts = group.products.slice(0, 4);
        const isOdd = index % 2 === 1;

        return (
          <section
            key={group.styleKey}
            id={`style-${group.styleKey}`}
            className={`py-14 sm:py-20 ${isOdd ? "bg-[color:var(--oda-cream)]" : "bg-white"}`}
            style={index >= expandedCount ? { contentVisibility: "auto", containIntrinsicSize: "auto 960px" } : undefined}
          >
            <div className="oda-container">
              {/* Mobile: full-width image + grid below */}
              <div className="lg:hidden">
                <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[1.35rem] bg-[color:var(--oda-stone)]">
                  {coverImage ? (
                    <Image
                      src={coverImage}
                      alt={group.label}
                      fill
                      quality={58}
                      sizes="100vw"
                      className="object-cover"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.62),rgba(0,0,0,0.12),rgba(0,0,0,0))]" />
                  <div className="absolute bottom-5 left-5 right-5 text-white">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/78">Estilo curado</p>
                    <p className="mt-2 font-display text-2xl">{group.label}</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4">
                  {displayProducts.map((product) => (
                    <HomeProductCard
                      key={`${group.styleKey}-${product.id}`}
                      product={product}
                      surface="home_style_showcase"
                      sizes="(max-width: 640px) 46vw, 44vw"
                    />
                  ))}
                </div>

                <Link
                  href={`/estilo/${encodeURIComponent(group.styleKey)}`}
                  prefetch={false}
                  className="mt-5 inline-flex rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                >
                  Explorar {group.label}
                </Link>
              </div>

              {/* Desktop: 55/45 split */}
              <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10 lg:items-start">
                <div className="relative aspect-[3/4] overflow-hidden rounded-[1.6rem] bg-[color:var(--oda-stone)] shadow-[0_24px_70px_rgba(23,21,19,0.18)]">
                  {coverImage ? (
                    <Image
                      src={coverImage}
                      alt={group.label}
                      fill
                      quality={58}
                      sizes="(max-width: 1280px) 50vw, 42vw"
                      className="object-cover"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.68),rgba(0,0,0,0.14),rgba(0,0,0,0))]" />
                  <div className="absolute bottom-8 left-8 right-8 text-white">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/78">Estilo curado</p>
                    <p className="mt-2 font-display text-4xl leading-none">{group.label}</p>
                    <p className="mt-3 text-sm text-white/82">
                      Descubre piezas seleccionadas para este estilo.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-3xl leading-none text-[color:var(--oda-ink)]">{group.label}</h3>
                    <Link
                      href={`/estilo/${encodeURIComponent(group.styleKey)}`}
                      prefetch={false}
                      className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
                    >
                      Explorar todo
                    </Link>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {displayProducts.map((product) => (
                      <HomeProductCard
                        key={`${group.styleKey}-${product.id}`}
                        product={product}
                        surface="home_style_showcase"
                        sizes="(max-width: 1280px) 22vw, 18vw"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {hasMore ? (
        <div className="flex justify-center py-8">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded-full border border-[color:var(--oda-border)] bg-white px-6 py-3 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
          >
            Ver más estilos ({styleGroups.length - expandedCount} más)
          </button>
        </div>
      ) : null}
    </div>
  );
}
