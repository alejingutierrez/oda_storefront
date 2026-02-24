import Image from "next/image";
import Link from "next/link";
import BrandMarquee from "@/components/home/BrandMarquee";
import CategoryGallery from "@/components/home/CategoryGallery";
import ColorSwatchPalette from "@/components/home/ColorSwatchPalette";
import ConversionCoverageBlock from "@/components/home/ConversionCoverageBlock";
import CuratedStickyEdit from "@/components/home/CuratedStickyEdit";
import HomeTrendingGrid from "@/components/home/HomeTrendingGrid";
import ProductCarousel from "@/components/home/ProductCarousel";
import type { HomeProductCardData } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";
import {
  getBrandLogos,
  getCategoryHighlights,
  getColorCombos,
  getHomeCoverageStats,
  getNewArrivals,
  getStyleGroups,
  getTrendingPicks,
} from "@/lib/home-data";

const FOLD_SECTION_CLASS = "[content-visibility:auto] [contain-intrinsic-size:960px]";

export default async function HomeBelowFold({
  seed,
  hero,
}: {
  seed: number;
  hero: HomeProductCardData | null;
}) {
  const [newArrivals, categoryHighlights, styleGroups, colorCombos, brandLogos, trending, coverageStats] =
    await Promise.all([
      getNewArrivals(seed, 6),
      getCategoryHighlights(seed, 8),
      getStyleGroups(seed, 2),
      getColorCombos(seed, 3),
      getBrandLogos(seed, 12),
      getTrendingPicks(seed, 8),
      getHomeCoverageStats(),
    ]);

  const storyImageSrc = proxiedImageUrl(hero?.imageCoverUrl ?? null, { productId: hero?.id ?? null, kind: "cover" });
  const isProxyStoryImage = Boolean(storyImageSrc?.startsWith("/api/image-proxy"));

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
        <HomeTrendingGrid products={trending} />
      </section>

      <section className={`oda-container pb-16 sm:pb-22 ${FOLD_SECTION_CLASS}`}>
        <ConversionCoverageBlock stats={coverageStats} seed={seed} />
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
                  alt={hero?.name ?? "Producto curado"}
                  fill
                  quality={58}
                  sizes="(max-width: 1024px) 80vw, 42vw"
                  className="object-cover"
                  unoptimized={isProxyStoryImage}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
