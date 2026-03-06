"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeStyleSpotlight } from "@/lib/home-types";

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function StyleSpotlight({
  spotlights,
}: {
  spotlights: HomeStyleSpotlight[];
}) {
  const [activeKey, setActiveKey] = useState(spotlights[0]?.styleKey ?? "");

  const active = useMemo(
    () => spotlights.find((item) => item.styleKey === activeKey) ?? spotlights[0] ?? null,
    [activeKey, spotlights],
  );

  if (!active || spotlights.length === 0) return null;

  return (
    <div className="flex flex-col gap-6 rounded-[1.7rem] border border-[color:var(--oda-border)] bg-white p-5 shadow-[0_24px_80px_rgba(23,21,19,0.08)] sm:p-7">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Estilos ODA</p>
            <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
              Un acceso compacto, no una pared de vitrinas
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
              El spotlight mezcla curación manual con estilos inferidos del catálogo para no depender de una cobertura mínima.
            </p>
          </div>
          <Link
            href={active.href}
            prefetch={false}
            className="w-fit rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-ink)] hover:text-[color:var(--oda-cream)]"
          >
            Explorar {active.label}
          </Link>
        </div>

        <div className="home-hide-scroll flex gap-2 overflow-x-auto pb-1">
          {spotlights.slice(0, 8).map((spotlight) => (
            <button
              key={spotlight.styleKey}
              type="button"
              onClick={() => setActiveKey(spotlight.styleKey)}
              className={`shrink-0 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
                spotlight.styleKey === active.styleKey
                  ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                  : "border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
              }`}
            >
              {spotlight.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.84fr)_minmax(0,1.16fr)] lg:items-start">
        <div className="rounded-[1.4rem] bg-[linear-gradient(160deg,#f4eee5_0%,#fbf8f2_100%)] p-5 sm:p-6">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Spotlight activo</p>
              <h3 className="font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
                {active.label}
              </h3>
              <p className="text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">{active.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[1rem] border border-[color:var(--oda-border)] bg-white px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">Productos</p>
                <p className="mt-1 font-display text-2xl leading-none text-[color:var(--oda-ink)]">
                  {new Intl.NumberFormat("es-CO").format(active.productCount)}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[color:var(--oda-border)] bg-white px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">Marcas</p>
                <p className="mt-1 font-display text-2xl leading-none text-[color:var(--oda-ink)]">
                  {new Intl.NumberFormat("es-CO").format(active.brandCount)}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[color:var(--oda-border)] bg-white px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">Precio visible</p>
                <p className="mt-1 font-display text-2xl leading-none text-[color:var(--oda-ink)]">
                  {pct(active.priceCoverage)}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[color:var(--oda-border)] bg-white px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">Disponibilidad</p>
                <p className="mt-1 font-display text-2xl leading-none text-[color:var(--oda-ink)]">
                  {pct(active.availabilityRatio)}
                </p>
              </div>
            </div>

            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-ink-soft)]">
              Frescura reciente: {pct(active.freshnessRatio)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {active.products.slice(0, 4).map((product) => (
            <HomeProductCard
              key={`${active.styleKey}-${product.id}`}
              product={product}
              surface={`home_style_spotlight_${active.styleKey}`}
              sizes="(max-width: 767px) 46vw, (max-width: 1279px) 28vw, 16vw"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
