"use client";

import { useMemo, useState } from "react";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeTrendingDailyCardData } from "@/lib/home-types";

const INITIAL_VISIBLE = 8;
const LOAD_STEP = 4;

function formatSnapshot(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function HomeDailyTrendingRail({ products }: { products: HomeTrendingDailyCardData[] }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const snapshotDate = useMemo(() => {
    const firstWithDate = products.find((product) => product.snapshotDate);
    return formatSnapshot(firstWithDate?.snapshotDate ?? null);
  }, [products]);

  if (products.length === 0) {
    return (
      <section className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Tendencia diaria</p>
        <h3 className="mt-3 font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
          Sin snapshot diario disponible.
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
          Estamos consolidando la primera corrida de clics diarios para esta seccion.
        </p>
      </section>
    );
  }

  const visibleProducts = products.slice(0, visibleCount);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Tendencia diaria</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
          Productos mas cliqueados
        </h2>
        <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
          {snapshotDate ? `Actualizado ${snapshotDate}` : "Actualizando señal diaria"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {visibleProducts.map((product) => (
          <div key={`daily-${product.id}`} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-[color:var(--oda-border)] bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--oda-ink-soft)]">
                {product.clickCount > 0 ? `${new Intl.NumberFormat("es-CO").format(product.clickCount)} clics` : "Tendencia"}
              </span>
            </div>
            <HomeProductCard
              product={product}
              surface="home_daily_trending"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
            />
          </div>
        ))}
      </div>

      {products.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + LOAD_STEP)}
          className="self-start rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
        >
          Ver mas tendencia
        </button>
      ) : null}
    </section>
  );
}
