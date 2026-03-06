"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeProductCardData, HomePriceDropCardData, HomeTrendingDailyCardData } from "@/lib/home-types";
import { logExperienceEvent } from "@/lib/experience-events";
import { proxiedImageUrl } from "@/lib/image-proxy";

type UserFavoritesResponse = {
  products?: HomeProductCardData[];
};

type Tab = "price_drops" | "favorites" | "trending";

const TAB_CONFIG: Array<{ key: Tab; label: string }> = [
  { key: "price_drops", label: "Rebajas" },
  { key: "favorites", label: "Favoritos" },
  { key: "trending", label: "Tendencia hoy" },
];

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

function PriceDropCard({ product }: { product: HomePriceDropCardData }) {
  const imageSrc = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });
  const dropLabel = product.dropPercent ? `-${Math.round(product.dropPercent)}%` : null;

  return (
    <Link
      href={product.sourceUrl ?? "#"}
      target={product.sourceUrl ? "_blank" : undefined}
      rel={product.sourceUrl ? "noreferrer" : undefined}
      prefetch={false}
      onClick={() => {
        logExperienceEvent({
          type: "product_click",
          productId: product.id,
          path: typeof window !== "undefined" ? window.location.pathname : "/",
          properties: { surface: "home_smart_rails_price_drop" },
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
}

function TrendingCard({ product }: { product: HomeTrendingDailyCardData }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="rounded-full border border-[color:var(--oda-border)] bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--oda-ink-soft)]">
          {product.clickCount > 0 ? `${new Intl.NumberFormat("es-CO").format(product.clickCount)} clics` : "Tendencia"}
        </span>
      </div>
      <HomeProductCard
        product={product}
        surface="home_smart_rails_trending"
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
      />
    </div>
  );
}

export default function SmartRails({
  priceDropProducts,
  initialFavorites,
  dailyTrendingProducts,
  favoritesExcludeIds,
  defaultTab = "price_drops",
}: {
  priceDropProducts: HomePriceDropCardData[];
  initialFavorites: HomeProductCardData[];
  dailyTrendingProducts: HomeTrendingDailyCardData[];
  favoritesExcludeIds: string[];
  defaultTab?: string;
}) {
  const [activeTab, setActiveTab] = useState<Tab>((defaultTab as Tab) || "price_drops");
  const [favorites, setFavorites] = useState<HomeProductCardData[]>(initialFavorites);
  const [favoritesMode, setFavoritesMode] = useState<"anon" | "user">("anon");

  const excludeParam = useMemo(
    () => (favoritesExcludeIds.length ? favoritesExcludeIds.join(",") : ""),
    [favoritesExcludeIds],
  );

  // Fetch user favorites on mount (same pattern as HomeFavoritesRail)
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
          headers: { "cache-control": "no-store" },
        });

        if (!res.ok) return;
        const payload = (await res.json()) as UserFavoritesResponse;
        const next = Array.isArray(payload.products) ? payload.products : [];
        if (cancelled || next.length === 0) return;
        setFavorites(next);
        setFavoritesMode("user");
      } catch {
        // Baseline anon stays when no session or fetch fails.
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [excludeParam]);

  const snapshotDate = useMemo(() => {
    const first = dailyTrendingProducts.find((p) => p.snapshotDate);
    return formatSnapshot(first?.snapshotDate ?? null);
  }, [dailyTrendingProducts]);

  // Determine if we have any content to show
  const hasContent = priceDropProducts.length > 0 || favorites.length > 0 || dailyTrendingProducts.length > 0;
  if (!hasContent) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Para ti</p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            {activeTab === "price_drops" && "Bajaron de precio esta semana"}
            {activeTab === "favorites" && (favoritesMode === "user" ? "Tus favoritos recientes" : "Lo más guardado por la comunidad")}
            {activeTab === "trending" && "Lo que más está gustando hoy"}
          </h2>
          {activeTab === "trending" && snapshotDate ? (
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
              Actualizado {snapshotDate}
            </p>
          ) : null}
        </div>
      </div>

      {/* Tab bar */}
      <div className="home-hide-scroll flex gap-2 overflow-x-auto pb-1">
        {TAB_CONFIG.map((tab) => {
          const count =
            tab.key === "price_drops"
              ? priceDropProducts.length
              : tab.key === "favorites"
                ? favorites.length
                : dailyTrendingProducts.length;
          if (count === 0) return null;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
                activeTab === tab.key
                  ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                  : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {activeTab === "price_drops" &&
          priceDropProducts.slice(0, 8).map((product) => (
            <PriceDropCard key={product.id} product={product} />
          ))}

        {activeTab === "favorites" &&
          favorites.slice(0, 8).map((product) => (
            <HomeProductCard
              key={`fav-${product.id}`}
              product={product}
              surface={favoritesMode === "user" ? "home_smart_rails_favorites_user" : "home_smart_rails_favorites_top"}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
            />
          ))}

        {activeTab === "trending" &&
          dailyTrendingProducts.slice(0, 8).map((product) => (
            <TrendingCard key={`trending-${product.id}`} product={product} />
          ))}
      </div>
    </div>
  );
}
