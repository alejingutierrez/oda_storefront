import Image from "next/image";
import Link from "next/link";
import ConversionCoverageBlock from "@/components/home/ConversionCoverageBlock";
import EditorialMosaic from "@/components/home/EditorialMosaic";
import HomeQuickDiscovery from "@/components/home/HomeQuickDiscovery";
import ProductCarousel from "@/components/home/ProductCarousel";
import SmartRails from "@/components/home/SmartRails";
import StyleSpotlight from "@/components/home/StyleSpotlight";
import { proxiedImageUrl } from "@/lib/image-proxy";
import {
  getHomeConfigInt,
  getHomePagePayload,
  getHomeConfigValue,
  type HomeConfigMap,
} from "@/lib/home-data";

const FOLD_SECTION_CLASS = "[content-visibility:auto] [contain-intrinsic-size:960px]";

export default async function HomeBelowFold({
  seed,
  heroIds,
  config,
}: {
  seed: number;
  heroIds: string[];
  config?: HomeConfigMap;
}) {
  const payload = await getHomePagePayload({ seed, heroIds, config });
  const newArrivalsLimit = getHomeConfigInt(config ?? {}, "section.new_arrivals.limit");

  const storyImageSrc = proxiedImageUrl(payload.storyProduct?.imageCoverUrl ?? null, {
    productId: payload.storyProduct?.id ?? null,
    kind: "cover",
  });

  return (
    <>
      <section className={`oda-container py-12 sm:py-16 ${FOLD_SECTION_CLASS}`}>
        <HomeQuickDiscovery cards={payload.quickDiscovery} />
      </section>

      {payload.utilityTabs.length > 0 ? (
        <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
          <SmartRails tabs={payload.utilityTabs} defaultTab={payload.defaultUtilityTab} />
        </section>
      ) : null}

      {payload.newArrivals.length > 0 ? (
        <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
          <ProductCarousel
            title={getHomeConfigValue(config ?? {}, "section.new_arrivals.heading")}
            subtitle={getHomeConfigValue(config ?? {}, "section.new_arrivals.subheading")}
            ctaHref={getHomeConfigValue(config ?? {}, "section.new_arrivals.cta_href")}
            ctaLabel={getHomeConfigValue(config ?? {}, "section.new_arrivals.cta_label")}
            products={payload.newArrivals.slice(0, Math.max(8, newArrivalsLimit))}
            ariaLabel="Carrusel de novedades"
            surface="home_new_arrivals"
          />
        </section>
      ) : null}

      {payload.styleSpotlights.length > 0 ? (
        <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
          <StyleSpotlight spotlights={payload.styleSpotlights} />
        </section>
      ) : null}

      <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
        <EditorialMosaic
          categories={payload.categories}
          colors={payload.colors}
          brandSpotlight={payload.brandSpotlight}
          brands={payload.brandFeatures}
        />
      </section>

      <section className={`oda-container pb-14 sm:pb-18 ${FOLD_SECTION_CLASS}`}>
        <ConversionCoverageBlock trustStrip={payload.trustStrip} />
      </section>

      <section className={`border-y border-[color:var(--oda-border)] bg-white ${FOLD_SECTION_CLASS}`}>
        <div className="oda-container grid gap-8 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="flex flex-col gap-4 lg:pr-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              {getHomeConfigValue(config ?? {}, "section.story.eyebrow")}
            </p>
            <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
              {getHomeConfigValue(config ?? {}, "section.story.heading")}
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
              {getHomeConfigValue(config ?? {}, "section.story.body")}
            </p>
            <Link
              href={getHomeConfigValue(config ?? {}, "section.story.cta_href")}
              prefetch={false}
              className="mt-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              {getHomeConfigValue(config ?? {}, "section.story.cta_label")}
            </Link>
          </div>

          <div>
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[1.45rem] bg-[color:var(--oda-stone)] shadow-[0_32px_90px_rgba(23,21,19,0.16)]">
              {storyImageSrc ? (
                <Image
                  src={storyImageSrc}
                  alt={payload.storyProduct?.name ?? "Producto curado"}
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
