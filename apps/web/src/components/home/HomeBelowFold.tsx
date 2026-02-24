import Image from "next/image";
import Link from "next/link";
import BrandMarquee from "@/components/home/BrandMarquee";
import CategoryGallery from "@/components/home/CategoryGallery";
import ColorSwatchPalette from "@/components/home/ColorSwatchPalette";
import ConversionCoverageBlock from "@/components/home/ConversionCoverageBlock";
import CuratedStickyEdit from "@/components/home/CuratedStickyEdit";
import HomeDailyTrendingRail from "@/components/home/HomeDailyTrendingRail";
import HomeFavoritesRail from "@/components/home/HomeFavoritesRail";
import HomePriceDropRail from "@/components/home/HomePriceDropRail";
import HomeTrendingGrid from "@/components/home/HomeTrendingGrid";
import ProductCarousel from "@/components/home/ProductCarousel";
import { proxiedImageUrl } from "@/lib/image-proxy";
import {
  collectUniqueProducts,
  createHomeSelectionRegistry,
  getBrandLogos,
  getCategoryHighlights,
  getColorCombos,
  getDailyTrendingPicks,
  getFocusPicks,
  getHomeCoverageStats,
  getMostFavoritedPicks,
  getNewArrivals,
  getPriceDropPicks,
  getStyleGroups,
  getTrendingPicks,
} from "@/lib/home-data";
import type { HomeCoverageStats } from "@/lib/home-types";

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
}: {
  seed: number;
  heroIds: string[];
}) {
  const registry = createHomeSelectionRegistry(heroIds);
  const initialExcludeIds = Array.from(registry.usedIds);

  const [
    categoryHighlights,
    colorCombos,
    brandLogos,
    coverageStats,
    newArrivalsRaw,
    focusRaw,
    styleGroupsRaw,
    priceDropRaw,
    dailyTrendingRaw,
    storyCandidatesRaw,
    mostFavoritedRaw,
  ] = await Promise.all([
    withTimeout(getCategoryHighlights(seed, 24, { preferBlob: true }), []),
    withTimeout(getColorCombos(seed, 3), []),
    withTimeout(getBrandLogos(seed, 12), []),
    withTimeout(getHomeCoverageStats(), DEFAULT_COVERAGE_STATS),
    withTimeout(getNewArrivals(seed, 18), []),
    withTimeout(
      getFocusPicks(seed, {
        limit: 24,
        subcategoryLimit: 12,
        excludeIds: initialExcludeIds,
      }),
      [],
    ),
    withTimeout(getStyleGroups(seed, 2), []),
    withTimeout(
      getPriceDropPicks(seed, {
        days: 7,
        minDropPercent: 5,
        limit: 12,
        excludeIds: initialExcludeIds,
      }),
      [],
    ),
    withTimeout(
      getDailyTrendingPicks(seed, {
        limit: 12,
        excludeIds: initialExcludeIds,
      }),
      [],
    ),
    withTimeout(getTrendingPicks(seed + 19, 24), []),
    withTimeout(
      getMostFavoritedPicks(seed, {
        windowDays: 30,
        limit: 12,
        excludeIds: initialExcludeIds,
      }),
      [],
    ),
  ]);

  const newArrivals = collectUniqueProducts(newArrivalsRaw, registry, 8);

  const focusProducts = collectUniqueProducts(focusRaw, registry, 24);

  const styleGroups = styleGroupsRaw
    .map((group) => ({
      ...group,
      products: collectUniqueProducts(group.products, registry, group.products.length),
    }))
    .filter((group) => group.products.length > 0);

  const priceDrop = collectUniqueProducts(priceDropRaw, registry, 12);

  const dailyTrending = collectUniqueProducts(dailyTrendingRaw, registry, 12);

  const storyProduct = collectUniqueProducts(storyCandidatesRaw, registry, 1)[0] ?? null;

  const favoritesExcludeIds = Array.from(registry.usedIds);
  const mostFavorited = collectUniqueProducts(mostFavoritedRaw, registry, 12);

  const storyImageSrc = proxiedImageUrl(storyProduct?.imageCoverUrl ?? null, {
    productId: storyProduct?.id ?? null,
    kind: "cover",
  });

  return (
    <>
      <section className={`oda-container py-12 sm:py-16 ${FOLD_SECTION_CLASS}`}>
        <ProductCarousel
          title="Novedades que rotan cada 3 dias"
          subtitle="Nuevo"
          ctaHref="/novedades"
          ctaLabel="Ver todo"
          products={newArrivals}
          ariaLabel="Carrusel de novedades"
          surface="home_new_arrivals"
        />
      </section>

      <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
        <CategoryGallery categories={categoryHighlights} />
      </section>

      <section className={`oda-container pb-14 sm:pb-20 ${FOLD_SECTION_CLASS}`}>
        <CuratedStickyEdit styleGroups={styleGroups} />
      </section>

      <section className={`oda-container pb-14 sm:pb-20 ${FOLD_SECTION_CLASS}`}>
        <ColorSwatchPalette colorCombos={colorCombos} />
      </section>

      <section className={`oda-container pb-14 sm:pb-20 ${FOLD_SECTION_CLASS}`}>
        <BrandMarquee brands={brandLogos} />
      </section>

      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <HomeTrendingGrid products={focusProducts} />
      </section>

      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <ConversionCoverageBlock stats={coverageStats} seed={seed} />
      </section>

      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <HomePriceDropRail products={priceDrop} />
      </section>

      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <HomeFavoritesRail initialProducts={mostFavorited} excludeIds={favoritesExcludeIds} />
      </section>

      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <HomeDailyTrendingRail products={dailyTrending} />
      </section>

      <section className={`border-y border-[color:var(--oda-border)] bg-white ${FOLD_SECTION_CLASS}`}>
        <div className="oda-container grid gap-8 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="flex flex-col gap-4 lg:pr-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">ODA Story</p>
            <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
              Editorial colombiano, siempre actualizado.
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
              Mantenemos la curaduria viva usando una semilla determinista de 3 dias y un pipeline continuo de
              catalogo. Resultado: descubrimiento premium sin perder consistencia de data.
            </p>
            <Link
              href="/unisex"
              prefetch={false}
              className="mt-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              Ver todo el catalogo
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
