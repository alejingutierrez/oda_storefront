"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomePriceDropCardData, HomeTrendingDailyCardData, HomeUtilityTab } from "@/lib/home-types";
import { logExperienceEvent } from "@/lib/experience-events";
import { proxiedImageUrl } from "@/lib/image-proxy";

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
  const href = product.brandSlug && product.slug
    ? `/producto/${product.brandSlug}/${product.slug}`
    : (product.sourceUrl ?? "#");
  const isExternal = !(product.brandSlug && product.slug) && !!product.sourceUrl;

  return (
    <Link
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      prefetch={false}
      onClick={() => {
        logExperienceEvent({
          type: "product_click",
          productId: product.id,
          path: typeof window !== "undefined" ? window.location.pathname : "/",
          properties: { surface: "home_utility_price_drop" },
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

function MomentumCard({
  product,
  behaviorQualified,
}: {
  product: HomeTrendingDailyCardData;
  behaviorQualified: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="rounded-full border border-[color:var(--oda-border)] bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--oda-ink-soft)]">
          {behaviorQualified && product.clickCount > 0
            ? `${new Intl.NumberFormat("es-CO").format(product.clickCount)} clics`
            : "Descubriendo"}
        </span>
      </div>
      <HomeProductCard
        product={product}
        surface={behaviorQualified ? "home_utility_momentum_live" : "home_utility_momentum_fallback"}
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
      />
    </div>
  );
}

type UtilityTabKey = HomeUtilityTab["key"];

export default function SmartRails({
  tabs,
  defaultTab = "price_drops",
}: {
  tabs: HomeUtilityTab[];
  defaultTab?: string;
}) {
  const availableTabs = tabs.filter((tab) => tab.products.length > 0);
  const fallbackKey = availableTabs[0]?.key ?? "price_drops";
  const initialTab = (availableTabs.find((tab) => tab.key === defaultTab)?.key ?? fallbackKey) as UtilityTabKey;
  const [activeTab, setActiveTab] = useState<UtilityTabKey>(initialTab);

  const currentTab = useMemo(
    () => availableTabs.find((tab) => tab.key === activeTab) ?? availableTabs[0] ?? null,
    [activeTab, availableTabs],
  );

  if (!currentTab) return null;

  const snapshotDate =
    currentTab.key === "momentum" ? formatSnapshot(currentTab.snapshotDate) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Para ti hoy</p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            {currentTab.heading}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            {currentTab.description}
          </p>
          {snapshotDate ? (
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
              Actualizado {snapshotDate}
            </p>
          ) : null}
        </div>
      </div>

      <div className="home-hide-scroll flex gap-2 overflow-x-auto pb-1">
        {availableTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
              currentTab.key === tab.key
                ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
            }`}
          >
            {tab.label} ({tab.products.length})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {currentTab.kind === "price_drop" &&
          currentTab.products.slice(0, 8).map((product) => (
            <PriceDropCard key={product.id} product={product} />
          ))}

        {currentTab.kind === "product" &&
          currentTab.products.slice(0, 8).map((product) => (
            <HomeProductCard
              key={product.id}
              product={product}
              surface="home_utility_new_with_stock"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 24vw"
            />
          ))}

        {currentTab.kind === "momentum" &&
          currentTab.products.slice(0, 8).map((product) => (
            <MomentumCard
              key={product.id}
              product={product}
              behaviorQualified={currentTab.behaviorQualified}
            />
          ))}
      </div>
    </div>
  );
}
