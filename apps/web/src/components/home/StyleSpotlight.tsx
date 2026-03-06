"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeStyleSpotlight } from "@/lib/home-types";
import type { RealStyleKey } from "@/lib/real-style/constants";

const STYLE_SHORT_NAMES: Partial<Record<RealStyleKey, string>> = {
  "01_minimalismo_neutro_pulido": "Minimal",
  "17_street_clean": "Street",
  "30_tropi_boho_playa": "Boho",
  "21_gym_funcional": "Sporty",
  "15_invitado_evento": "Glam",
  "28_artesanal_contemporaneo": "Artsy",
  "09_coastal_preppy": "Preppy",
  "50_cozy_homewear": "Comfy",
};

function shortName(spotlight: HomeStyleSpotlight): string {
  return STYLE_SHORT_NAMES[spotlight.styleKey as RealStyleKey] ?? spotlight.label;
}

export default function StyleSpotlight({
  spotlights,
}: {
  spotlights: HomeStyleSpotlight[];
}) {
  const [activeKey, setActiveKey] = useState(spotlights[0]?.styleKey ?? "");

  const active = useMemo(
    () => spotlights.find((s) => s.styleKey === activeKey) ?? spotlights[0] ?? null,
    [activeKey, spotlights],
  );

  if (!active || spotlights.length === 0) return null;

  return (
    <div className="flex flex-col gap-6 rounded-[1.7rem] border border-[color:var(--oda-border)] bg-white p-5 shadow-[0_24px_80px_rgba(23,21,19,0.08)] sm:p-7">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              Estilos ODA
            </p>
            <h2 className="font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
              Tu estilo, una palabra
            </h2>
          </div>
          <Link
            href={active.href}
            prefetch={false}
            className="w-fit shrink-0 rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-ink)] hover:text-[color:var(--oda-cream)]"
          >
            Explorar {shortName(active)}
          </Link>
        </div>

        {/* Style pills */}
        <div className="home-hide-scroll flex gap-2 overflow-x-auto pb-1">
          {spotlights.slice(0, 8).map((s) => (
            <button
              key={s.styleKey}
              type="button"
              onClick={() => setActiveKey(s.styleKey)}
              className={`shrink-0 rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.2em] transition ${
                s.styleKey === active.styleKey
                  ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                  : "border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
              }`}
            >
              {shortName(s)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats + Product grid */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-ink-soft)]">
          <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-1.5">
            {new Intl.NumberFormat("es-CO").format(active.productCount)} productos
          </span>
          <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-1.5">
            {new Intl.NumberFormat("es-CO").format(active.brandCount)} marcas
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {active.products.slice(0, 8).map((product) => (
            <HomeProductCard
              key={`${active.styleKey}-${product.id}`}
              product={product}
              surface={`home_style_spotlight_${active.styleKey}`}
              sizes="(max-width: 639px) 44vw, (max-width: 1023px) 30vw, 22vw"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
