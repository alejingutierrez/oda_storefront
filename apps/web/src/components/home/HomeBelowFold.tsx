import Image from "next/image";
import Link from "next/link";
import BrandMarquee from "@/components/home/BrandMarquee";
import CategoryGallery from "@/components/home/CategoryGallery";
import ColorSwatchPalette from "@/components/home/ColorSwatchPalette";
import ConversionCoverageBlock from "@/components/home/ConversionCoverageBlock";
import CuratedStyleShowcase from "@/components/home/CuratedStyleShowcase";
import HomeSmartPicks from "@/components/home/HomeSmartPicks";
import HomeTrendingGrid from "@/components/home/HomeTrendingGrid";
import ProductCarousel from "@/components/home/ProductCarousel";
import StyleQuickNav from "@/components/home/StyleQuickNav";
import { proxiedImageUrl } from "@/lib/image-proxy";
import {
  collectUniqueProducts,
  createHomeSelectionRegistry,
  getBrandLogos,
  getColorCombos,
  getHomeCoverageStats,
  getMostFavoritedPicks,
  getResilientCategoryHighlights,
  getResilientDailyTrendingPicks,
  getResilientFocusPicks,
  getResilientNewArrivals,
  getResilientPriceDropPicks,
  getStyleGroups,
  getTrendingPicks,
  HOME_CONFIG_DEFAULTS,
  type HomeConfigMap,
} from "@/lib/home-data";
import type { HomeCoverageStats } from "@/lib/home-types";

function cfgVal(config: HomeConfigMap | undefined, key: string): string {
  return (config?.[key] ?? HOME_CONFIG_DEFAULTS[key]) as string;
}

function cfgInt(config: HomeConfigMap | undefined, key: string): number {
  const raw = config?.[key] ?? HOME_CONFIG_DEFAULTS[key];
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : parseInt(HOME_CONFIG_DEFAULTS[key] ?? "0", 10);
}

const FOLD_SECTION_CLASS = "[content-visibility:auto] [contain-intrinsic-size:960px]";
const HOME_FETCH_TIMEOUT_MS = 24_000;

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = HOME_FETCH_TIMEOUT_MS): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

const DEFAULT_COVERAGE_STATS: HomeCoverageStats = {
  productCount: 0,
  brandCount: 0,
  categoryCount: 0,
  lastUpdatedAt: null,
};

export default async function HomeBelowFold({
  seed,
  heroIds,
  config,
}: {
  seed: number;
  heroIds: string[];
  config?: HomeConfigMap;
}) {
  const registry = createHomeSelectionRegistry(heroIds);
  const initialExcludeIds = Array.from(registry.usedIds);

  const newArrivalsLimit = cfgInt(config, "section.new_arrivals.limit");
  const priceDropsLimit = cfgInt(config, "section.price_drops.limit");
  const dailyTrendingLimit = cfgInt(config, "section.daily_trending.limit");

  const [
    categoryHighlightsResult,
    colorCombos,
    brandLogos,
    coverageStats,
    newArrivalsResult,
    focusResult,
    styleGroupsRaw,
    priceDropResult,
    dailyTrendingResult,
    storyCandidatesRaw,
    mostFavoritedRaw,
  ] = await Promise.all([
    getResilientCategoryHighlights(seed, { limit: 24, preferBlob: true }),
    withTimeout(getColorCombos(seed, 3), []),
    withTimeout(getBrandLogos(seed, 12), []),
    withTimeout(getHomeCoverageStats(), DEFAULT_COVERAGE_STATS),
    getResilientNewArrivals(seed, { limit: Math.max(18, newArrivalsLimit * 2) }),
    getResilientFocusPicks(seed, {
        limit: 24,
        subcategoryLimit: 12,
        excludeIds: initialExcludeIds,
      }),
    withTimeout(getStyleGroups(seed, 3, config), []),
    getResilientPriceDropPicks(seed, {
        limit: priceDropsLimit,
        excludeIds: initialExcludeIds,
      }),
    getResilientDailyTrendingPicks(seed, {
        limit: dailyTrendingLimit,
        excludeIds: initialExcludeIds,
      }),
    withTimeout(getTrendingPicks(seed + 19, 48), []),
    withTimeout(
      getMostFavoritedPicks(seed, {
        windowDays: 30,
        limit: 12,
        excludeIds: initialExcludeIds,
      }),
      [],
    ),
  ]);

  const categoryHighlights = categoryHighlightsResult.items;

  const newArrivals = collectUniqueProducts(newArrivalsResult.items, registry, newArrivalsLimit);

  const focusProducts = collectUniqueProducts(focusResult.items, registry, 24);

  const styleGroups = styleGroupsRaw
    .map((group) => ({
      ...group,
      products: collectUniqueProducts(group.products, registry, group.products.length),
    }))
    .filter((group) => group.products.length > 0);

  const priceDrop = collectUniqueProducts(priceDropResult.items, registry, 12);

  let dailyTrending = collectUniqueProducts(dailyTrendingResult.items, registry, 12);
  let dailyTrendingSource = dailyTrendingResult.source;
  let dailyTrendingDegraded = dailyTrendingResult.degraded;
  let dailyTrendingDurationMs = dailyTrendingResult.durationMs;

  if (dailyTrending.length === 0) {
    const localFallbackPool = [
      ...mostFavoritedRaw,
      ...focusResult.items,
      ...newArrivalsResult.items,
    ];
    const localFallback = collectUniqueProducts(localFallbackPool, registry, 12).map((item) => ({
      ...item,
      clickCount: 0,
      snapshotDate: null,
    }));
    if (localFallback.length > 0) {
      dailyTrending = localFallback;
      dailyTrendingSource = "home_local_pool";
      dailyTrendingDegraded = true;
      dailyTrendingDurationMs = dailyTrendingResult.durationMs;
    }
  }

  const storyProductUnique = collectUniqueProducts(storyCandidatesRaw, registry, 1)[0] ?? null;
  const storyProduct = storyProductUnique
    ?? storyCandidatesRaw.find((p) => p.imageCoverUrl && p.imageCoverUrl.trim() !== "")
    ?? [...mostFavoritedRaw, ...focusResult.items, ...newArrivalsResult.items]
        .find((p) => p.imageCoverUrl && p.imageCoverUrl.trim() !== "")
    ?? null;

  const favoritesExcludeIds = Array.from(registry.usedIds);
  const mostFavorited = collectUniqueProducts(mostFavoritedRaw, registry, 12);

  const criticalSectionStats = [
    {
      section: "new_arrivals",
      source: newArrivalsResult.source,
      degraded: newArrivalsResult.degraded,
      durationMs: newArrivalsResult.durationMs,
      count: newArrivals.length,
    },
    {
      section: "categories",
      source: categoryHighlightsResult.source,
      degraded: categoryHighlightsResult.degraded,
      durationMs: categoryHighlightsResult.durationMs,
      count: categoryHighlights.length,
    },
    {
      section: "focus",
      source: focusResult.source,
      degraded: focusResult.degraded,
      durationMs: focusResult.durationMs,
      count: focusProducts.length,
    },
    {
      section: "price_drop",
      source: priceDropResult.source,
      degraded: priceDropResult.degraded,
      durationMs: priceDropResult.durationMs,
      count: priceDrop.length,
    },
    {
      section: "daily_trending",
      source: dailyTrendingSource,
      degraded: dailyTrendingDegraded,
      durationMs: dailyTrendingDurationMs,
      count: dailyTrending.length,
    },
  ];

  for (const stat of criticalSectionStats) {
    console.info("home.section", stat);
  }

  const softSections = new Set(["price_drop", "daily_trending"]);
  const emptyCriticalSections = criticalSectionStats
    .filter((stat) => stat.count === 0 && !softSections.has(stat.section))
    .map((stat) => stat.section);
  const emptySoftSections = criticalSectionStats
    .filter((stat) => stat.count === 0 && softSections.has(stat.section))
    .map((stat) => stat.section);

  if (emptySoftSections.length > 0) {
    console.warn("home.guard.soft_sections_empty", {
      seed,
      emptySoftSections,
      productCount: coverageStats?.productCount ?? 0,
    });
  }

  if ((coverageStats?.productCount ?? 0) > 0 && emptyCriticalSections.length > 0) {
    console.error("home.guard.core_empty", {
      code: "HOME_CORE_EMPTY",
      seed,
      productCount: coverageStats?.productCount ?? 0,
      emptySections: emptyCriticalSections,
      criticalSectionStats,
    });
    throw new Error(`HOME_CORE_EMPTY:${emptyCriticalSections.join(",")}`);
  }

  const storyImageSrc = proxiedImageUrl(storyProduct?.imageCoverUrl ?? null, {
    productId: storyProduct?.id ?? null,
    kind: "cover",
  });

  /*
   * REDESIGNED SECTION ORDER:
   *
   * 1. StyleQuickNav — horizontal style pill navigation (sticky feel)
   * 2. CuratedStyleShowcase — full-width immersive Real Style (hero prominence)
   * 3. New Arrivals carousel
   * 4. Category Gallery
   * 5. Brand Marquee
   * 6. Trending Grid (Focus Picks)
   * 7. Smart Picks — tabbed: Price Drops | Trending | Favorites
   * 8. Color Swatches
   * 9. Coverage/Conversion Block
   * 10. Story/Inspirational Block
   *
   * Consolidation: Price Drops, Daily Trending, and Favorites merged into SmartPicks.
   * Real Style moved from position 3 to position 1-2 (right after hero).
   */

  return (
    <>
      {/* 1. Style Quick Nav — lets users jump into styles immediately */}
      <StyleQuickNav styleGroups={styleGroups} />

      {/* 2. Real Style Showcase — full-width immersive, hero-level prominence */}
      <CuratedStyleShowcase styleGroups={styleGroups} />

      {/* 3. New Arrivals */}
      <section className={`oda-container py-14 sm:py-18 ${FOLD_SECTION_CLASS}`}>
        <ProductCarousel
          title={cfgVal(config, "section.new_arrivals.heading")}
          subtitle={cfgVal(config, "section.new_arrivals.subheading")}
          ctaHref={cfgVal(config, "section.new_arrivals.cta_href")}
          ctaLabel={cfgVal(config, "section.new_arrivals.cta_label")}
          products={newArrivals}
          ariaLabel="Carrusel de novedades"
          surface="home_new_arrivals"
        />
      </section>

      {/* 4. Category Gallery */}
      <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
        <CategoryGallery categories={categoryHighlights} />
      </section>

      {/* 5. Brands */}
      <section className={`oda-container pb-14 sm:pb-20 ${FOLD_SECTION_CLASS}`}>
        <BrandMarquee brands={brandLogos} />
      </section>

      {/* 6. Focus Picks / Trending Grid */}
      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <HomeTrendingGrid products={focusProducts} />
      </section>

      {/* 7. Smart Picks — unified tab: Price Drops | Trending Today | Favorites */}
      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <HomeSmartPicks
          priceDrops={priceDrop}
          dailyTrending={dailyTrending}
          initialFavorites={mostFavorited}
          favoritesExcludeIds={favoritesExcludeIds}
        />
      </section>

      {/* 8. Color Swatches */}
      <section className={`oda-container pb-14 sm:pb-20 ${FOLD_SECTION_CLASS}`}>
        <ColorSwatchPalette colorCombos={colorCombos} />
      </section>

      {/* 9. Coverage/Conversion Block */}
      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <ConversionCoverageBlock stats={coverageStats} seed={seed} />
      </section>

      {/* 10. Story/Inspirational Block */}
      <section className={`border-y border-[color:var(--oda-border)] bg-white ${FOLD_SECTION_CLASS}`}>
        <div className="oda-container grid gap-8 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="flex flex-col gap-4 lg:pr-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">{cfgVal(config, "section.story.eyebrow")}</p>
            <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
              {cfgVal(config, "section.story.heading")}
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
              {cfgVal(config, "section.story.body")}
            </p>
            <Link
              href={cfgVal(config, "section.story.cta_href")}
              prefetch={false}
              className="mt-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              {cfgVal(config, "section.story.cta_label")}
            </Link>
          </div>

          <div>
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[1.45rem] bg-[color:var(--oda-stone)] shadow-[0_32px_90px_rgba(23,21,19,0.16)]">
              {storyImageSrc ? (
                <Image
                  src={storyImageSrc}
                  alt={storyProduct?.name ?? "Producto curado"}
                  fill
                  quality={58}
                  sizes="(max-width: 1024px) 80vw, 42vw"
                  className="object-cover"
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
