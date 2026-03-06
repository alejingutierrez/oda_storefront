"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeProductCardData, HomePriceDropCardData, HomeTrendingDailyCardData } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

type SmartTab = "price_drops" | "trending" | "favorites";

type UserFavoritesResponse = {
  products?: HomeProductCardData[];
};

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

const TAB_CONFIG: Record<SmartTab, { label: string; eyebrow: string; heading: string; icon: string }> = {
  price_drops: {
    label: "Rebajas",
    eyebrow: "Precio inteligente",
    heading: "Bajaron de precio",
    icon: "↓",
  },
  trending: {
    label: "Trending hoy",
    eyebrow: "En tendencia",
    heading: "Lo que más está gustando",
    icon: "↗",
  },
  favorites: {
    label: "Favoritos",
    eyebrow: "Más guardados",
    heading: "Lo más guardado",
    icon: "♡",
  },
};

function PriceDropCard({ product }: { product: HomePriceDropCardData }) {
  const imageSrc = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });
  const dropLabel = product.dropPercent ? `-${Math.round(product.dropPercent)}%` : null;

  return (
    <Link
      href={product.sourceUrl ?? "#"}
      target={product.sourceUrl ? "_blank" : undefined}
      rel={product.sourceUrl ? "noreferrer" : undefined}
      prefetch={false}
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
          <span className="absolute left-3 top-3 rounded-full bg-red-600/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm">
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
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
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
}

export default function HomeSmartPicks({
  priceDrops,
  dailyTrending,
  initialFavorites,
  favoritesExcludeIds,
}: {
  priceDrops: HomePriceDropCardData[];
  dailyTrending: HomeTrendingDailyCardData[];
  initialFavorites: HomeProductCardData[];
  favoritesExcludeIds: string[];
}) {
  // Determine first available tab
  const availableTabs = useMemo(() => {
    const tabs: SmartTab[] = [];
    if (priceDrops.length > 0) tabs.push("price_drops");
    if (dailyTrending.length > 0) tabs.push("trending");
    tabs.push("favorites"); // Always show (has fallback)
    return tabs;
  }, [priceDrops.length, dailyTrending.length]);

  const [activeTab, setActiveTab] = useState<SmartTab>(availableTabs[0] ?? "favorites");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [favorites, setFavorites] = useState<HomeProductCardData[]>(initialFavorites);
  const [favMode, setFavMode] = useState<"anon" | "user">("anon");

  // Try to load user favorites
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "12");
        if (favoritesExcludeIds.length) qs.set("excludeIds", favoritesExcludeIds.join(","));
        const res = await fetch(`/api/home/user-favorites?${qs.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: { "cache-control": "no-store" },
        });
        if (!res.ok) return;
        const payload = (await res.json()) as UserFavoritesResponse;
        const next = Array.isArray(payload.products) ? payload.products : [];
        if (cancelled || next.length === 0) return;
        setFavorites(next);
        setFavMode("user");
      } catch { /* keep anon */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [favoritesExcludeIds]);

  // Reset visible count on tab switch
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [activeTab]);

  const tabInfo = TAB_CONFIG[activeTab];

  // Current product list for the active tab
  const currentProducts: Array<HomeProductCardData | HomePriceDropCardData | HomeTrendingDailyCardData> =
    activeTab === "price_drops" ? priceDrops :
    activeTab === "trending" ? dailyTrending :
    favorites;

  const visible = currentProducts.slice(0, visibleCount);

  if (availableTabs.length === 0 || currentProducts.length === 0) {
    // If active tab empty, try switching
    if (currentProducts.length === 0 && availableTabs.length > 0) {
      const nextTab = availableTabs.find((t) => t !== activeTab);
      if (nextTab) {
        // Will re-render with a valid tab
        setActiveTab(nextTab);
      }
    }
    if (availableTabs.length === 0) return null;
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Header with tabs */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
            {tabInfo.eyebrow}
          </p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            {activeTab === "favorites" && favMode === "user" ? "Tus favoritos recientes" : tabInfo.heading}
          </h2>
        </div>

        {/* Tabs */}
        <div className="home-hide-scroll flex gap-2 overflow-x-auto pb-1">
          {availableTabs.map((tab) => {
            const config = TAB_CONFIG[tab];
            const isActive = tab === activeTab;
            const count =
              tab === "price_drops" ? priceDrops.length :
              tab === "trending" ? dailyTrending.length :
              favorites.length;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] transition ${
                  isActive
                    ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
                }`}
              >
                <span className="text-sm">{config.icon}</span>
                {config.label}
                <span className={`text-[10px] ${isActive ? "text-white/60" : "text-[color:var(--oda-taupe)]"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Product grid */}
      {visible.length === 0 ? (
        <div className="rounded-[1.1rem] border border-[color:var(--oda-border)] bg-white p-6">
          <p className="text-sm text-[color:var(--oda-ink-soft)]">
            No hay productos disponibles en esta sección por ahora.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((product) =>
            activeTab === "price_drops" ? (
              <PriceDropCard key={product.id} product={product as HomePriceDropCardData} />
            ) : (
              <HomeProductCard
                key={`smart-${activeTab}-${product.id}`}
                product={product}
                surface={`home_smart_${activeTab}`}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
              />
            )
          )}
        </div>
      )}

      {currentProducts.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + LOAD_STEP)}
          className="self-start rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
        >
          Ver más
        </button>
      ) : null}
    </div>
  );
}
