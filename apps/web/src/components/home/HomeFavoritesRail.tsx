"use client";

import { useEffect, useMemo, useState } from "react";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeProductCardData } from "@/lib/home-types";

type UserFavoritesResponse = {
  products?: HomeProductCardData[];
};

const INITIAL_VISIBLE = 8;
const LOAD_STEP = 4;

export default function HomeFavoritesRail({
  initialProducts,
  excludeIds,
}: {
  initialProducts: HomeProductCardData[];
  excludeIds: string[];
}) {
  const [products, setProducts] = useState<HomeProductCardData[]>(initialProducts);
  const [mode, setMode] = useState<"anon" | "user">("anon");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const excludeParam = useMemo(() => (excludeIds.length ? excludeIds.join(",") : ""), [excludeIds]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "12");
        if (excludeParam) qs.set("excludeIds", excludeParam);

        const res = await fetch(`/api/home/user-favorites?${qs.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: {
            "cache-control": "no-store",
          },
        });

        if (!res.ok) return;
        const payload = (await res.json()) as UserFavoritesResponse;
        const next = Array.isArray(payload.products) ? payload.products : [];
        if (cancelled || next.length === 0) return;
        setProducts(next);
        setMode("user");
        setVisibleCount(INITIAL_VISIBLE);
      } catch {
        // Baseline anon permanece cuando no hay sesion o falla el swap.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [excludeParam]);

  if (products.length === 0) {
    return (
      <section className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Favoritos</p>
        <h3 className="mt-3 font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
          Aún no hay favoritos para mostrar.
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
          Cuando tengamos más guardados, aquí verás opciones que te ayuden a decidir más rápido qué comprar.
        </p>
      </section>
    );
  }

  const visibleProducts = products.slice(0, visibleCount);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Favoritos</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
          {mode === "user" ? "Tus favoritos recientes" : "Lo más guardado por la comunidad"}
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {visibleProducts.map((product) => (
          <HomeProductCard
            key={`favorite-${product.id}`}
            product={product}
            surface={mode === "user" ? "home_favorites_user" : "home_favorites_top"}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
          />
        ))}
      </div>

      {products.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + LOAD_STEP)}
          className="self-start rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
        >
          Ver más favoritos
        </button>
      ) : null}
    </section>
  );
}
