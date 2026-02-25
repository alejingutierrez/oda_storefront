"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { HomeProductCardData } from "@/lib/home-types";
import { logExperienceEvent } from "@/lib/experience-events";
import { proxiedImageUrl } from "@/lib/image-proxy";

const MOBILE_INITIAL_VISIBLE = 8;
const DESKTOP_INITIAL_VISIBLE = 12;
const LOAD_STEP = 8;
const MAX_FILTERS = 12;

function toLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount) return "Consultar";
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return "Consultar";
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${currency || "COP"} ${numeric.toFixed(0)}`;
  }
}

function getHref(url: string | null) {
  if (!url) return "#";
  return url;
}

function isExternalUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

export default function HomeTrendingGrid({ products }: { products: HomeProductCardData[] }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("todo");
  const [visibleCount, setVisibleCount] = useState(MOBILE_INITIAL_VISIBLE);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      setIsDesktop(query.matches);
      setVisibleCount(query.matches ? DESKTOP_INITIAL_VISIBLE : MOBILE_INITIAL_VISIBLE);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const raw = (product.subcategory || product.category || "").trim();
      if (!raw) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FILTERS)
      .map(([value, count]) => ({
        value,
        label: toLabel(value),
        count,
      }));
  }, [products]);

  const filteredProducts =
    activeFilter === "todo"
      ? products
      : products.filter((product) => (product.subcategory || product.category || "").trim() === activeFilter);

  const visibleProducts = filteredProducts.slice(0, visibleCount);

  if (products.length === 0) {
    return (
      <div className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Tendencia</p>
        <h3 className="mt-3 font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
          Hoy no hay selección disponible.
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
          Estamos actualizando esta vitrina. Mientras tanto, explora productos para encontrar tu próximo look.
        </p>
        <Link
          href="/buscar"
          prefetch={false}
          className="mt-6 inline-flex rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)] transition hover:bg-[color:var(--oda-ink-soft)]"
        >
          Explorar catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Tendencia</p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            Lo más buscado ahora
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            Una selección pensada para descubrir rápido, comparar opciones y comprar con más confianza.
          </p>
        </div>
      </div>

      <div className="home-hide-scroll overflow-x-auto">
        <div className="flex w-max items-center gap-2 pb-1 pr-6">
          <button
            type="button"
            onClick={() => {
              setActiveFilter("todo");
              setVisibleCount(isDesktop ? DESKTOP_INITIAL_VISIBLE : MOBILE_INITIAL_VISIBLE);
            }}
            className={`rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
              activeFilter === "todo"
                ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
            }`}
          >
            Todo ({products.length})
          </button>

          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setActiveFilter(option.value);
                setVisibleCount(isDesktop ? DESKTOP_INITIAL_VISIBLE : MOBILE_INITIAL_VISIBLE);
              }}
              className={`rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
                activeFilter === option.value
                  ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                  : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
              }`}
            >
              {option.label} ({option.count})
            </button>
          ))}
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="rounded-[1.1rem] border border-[color:var(--oda-border)] bg-white p-6">
          <p className="text-sm text-[color:var(--oda-ink-soft)]">
            No encontramos productos para este filtro. Prueba con otra subcategoría.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {visibleProducts.map((product) => {
            const href = getHref(product.sourceUrl);
            const external = isExternalUrl(href);
            const imageSrc = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });
            return (
              <a
                key={product.id}
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
                onClick={() => {
                  logExperienceEvent({
                    type: "product_click",
                    productId: product.id,
                    path: typeof window !== "undefined" ? window.location.pathname : "/",
                    properties: {
                      surface: "home_focus_v2",
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
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                    {product.brandName}
                  </span>
                  <span className="line-clamp-2 text-sm leading-snug text-[color:var(--oda-ink)] sm:text-[15px]">
                    {product.name}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
                    {formatPrice(product.minPrice, product.currency)}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {filteredProducts.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + LOAD_STEP)}
          className="self-start rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
        >
          Ver más productos
        </button>
      ) : null}
    </div>
  );
}
