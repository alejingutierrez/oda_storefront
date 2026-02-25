"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { HomePriceDropCardData } from "@/lib/home-types";
import { logExperienceEvent } from "@/lib/experience-events";
import { proxiedImageUrl } from "@/lib/image-proxy";

const INITIAL_VISIBLE = 8;
const LOAD_STEP = 4;

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

export default function HomePriceDropRail({ products }: { products: HomePriceDropCardData[] }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  if (products.length === 0) {
    return (
      <section className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Rebajas</p>
        <h3 className="mt-3 font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
          Aún no detectamos rebajas recientes.
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
          Seguimos revisando cambios de precio para ayudarte a encontrar mejores oportunidades. Vuelve pronto.
        </p>
      </section>
    );
  }

  const visibleProducts = products.slice(0, visibleCount);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Rebajas</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
          Bajaron de precio esta semana
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {visibleProducts.map((product) => {
          const imageSrc = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });
          const dropLabel = product.dropPercent ? `-${Math.round(product.dropPercent)}%` : null;
          return (
            <Link
              key={product.id}
              href={product.sourceUrl ?? "#"}
              target={product.sourceUrl ? "_blank" : undefined}
              rel={product.sourceUrl ? "noreferrer" : undefined}
              prefetch={false}
              onClick={() => {
                logExperienceEvent({
                  type: "product_click",
                  productId: product.id,
                  path: typeof window !== "undefined" ? window.location.pathname : "/",
                  properties: {
                    surface: "home_price_drop",
                  },
                });
              }}
              className="group flex min-w-0 flex-col gap-3"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[1.1rem] bg-[color:var(--oda-stone)]">
                {imageSrc ? (
                  <Image
                    src={imageSrc}
                    alt={product.name}
                    fill
                    quality={58}
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
                    className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                  />
                ) : null}

                {dropLabel ? (
                  <span className="absolute left-3 top-3 rounded-full border border-white/60 bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                    {dropLabel}
                  </span>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {product.brandName}
                </span>
                <span className="line-clamp-2 text-sm text-[color:var(--oda-ink)]">{product.name}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
                    {formatPrice(product.minPrice, product.currency)}
                  </span>
                  {product.previousPrice ? (
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--oda-taupe)] line-through">
                      {formatPrice(product.previousPrice, product.currency)}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {products.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + LOAD_STEP)}
          className="self-start rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
        >
          Ver más rebajas
        </button>
      ) : null}
    </section>
  );
}
