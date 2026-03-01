"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { HOME_CONFIG_DEFAULTS, type HomeConfigMap, type HomeHeroSlide } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

function cfgVal(config: HomeConfigMap | undefined, key: string): string {
  return (config?.[key] ?? HOME_CONFIG_DEFAULTS[key]) as string;
}

const AUTOPLAY_MS = 6200;
const HERO_COMPOSITE_SIZES = "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, (max-width: 1535px) 33vw, 25vw";
const HERO_PANEL_VISIBILITY_CLASSES = ["block", "hidden md:block", "hidden lg:block", "hidden 2xl:block"] as const;

function toLabel(value: string | null | undefined) {
  if (!value) return null;
  return value
    .split("_")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount) return null;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${currency || "COP"} ${numeric.toFixed(0)}`;
  }
}

function normalizeImageUrl(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildHeroPanelUrls(slide: HomeHeroSlide): string[] {
  const coverUrl = normalizeImageUrl(slide.imageCoverUrl);
  const set = new Set<string>();
  if (coverUrl) set.add(coverUrl);
  for (const candidate of slide.heroImageUrls) {
    const normalized = normalizeImageUrl(candidate);
    if (!normalized) continue;
    set.add(normalized);
  }

  const uniqueUrls = Array.from(set);
  const primary = uniqueUrls[0];
  if (!primary) return [];
  if (uniqueUrls.length >= 4) return [uniqueUrls[0], uniqueUrls[1], uniqueUrls[2], uniqueUrls[3]];
  if (uniqueUrls.length === 3) return [uniqueUrls[0], uniqueUrls[1], uniqueUrls[2], uniqueUrls[0]];
  if (uniqueUrls.length === 2) return [uniqueUrls[0], uniqueUrls[1], uniqueUrls[0], uniqueUrls[1]];
  return [primary, primary, primary, primary];
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

export default function HomeHeroImmersive({
  slides,
  config,
}: {
  slides: HomeHeroSlide[];
  config?: HomeConfigMap;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion || slides.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, slides.length]);

  const safeActiveIndex = slides.length > 0 ? activeIndex % slides.length : 0;
  const activeSlide = slides[safeActiveIndex] ?? null;
  const heroPrice = formatPrice(activeSlide?.minPrice ?? null, activeSlide?.currency ?? null);
  const showProductSupport = Boolean(
    activeSlide?.name && activeSlide?.brandName && activeSlide?.sourceUrl && heroPrice,
  );

  const contextualBadge = useMemo(() => {
    const values = [toLabel(activeSlide?.category), toLabel(activeSlide?.subcategory)].filter(Boolean) as string[];
    return values.length > 0 ? values.join(" · ") : "Estilo destacado";
  }, [activeSlide?.category, activeSlide?.subcategory]);

  return (
    <section className="relative isolate min-h-[64svh] overflow-hidden border-b border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)] lg:min-h-[74svh]">
      <div className="home-parallax-media absolute inset-0">
        {slides.length > 0 ? (
          slides.map((slide, index) => {
            const coverUrl = normalizeImageUrl(slide.imageCoverUrl);
            const panelUrls = buildHeroPanelUrls(slide);
            const panelAssets = panelUrls
              .map((panelUrl, panelIndex) => {
                const imageSrc = proxiedImageUrl(panelUrl, {
                  productId: slide.id,
                  kind: panelUrl === coverUrl ? "cover" : "gallery",
                });
                if (!imageSrc) return null;
                return {
                  imageSrc,
                  originalUrl: panelUrl,
                  panelIndex,
                };
              })
              .filter(Boolean) as Array<{ imageSrc: string; originalUrl: string; panelIndex: number }>;
            if (panelAssets.length === 0) return null;

            return (
              <div
                key={slide.id}
                className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
                  safeActiveIndex === index ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden={safeActiveIndex !== index}
              >
                <div className="flex h-full w-full">
                  {panelAssets.map((panel) => (
                    <div
                      key={`${slide.id}-${panel.panelIndex}-${panel.originalUrl}`}
                      className={`relative h-full min-w-0 flex-1 ${HERO_PANEL_VISIBILITY_CLASSES[panel.panelIndex]}`}
                    >
                      <Image
                        src={panel.imageSrc}
                        alt={panel.panelIndex === 0 ? slide.name : ""}
                        fill
                        priority={index === 0 && panel.panelIndex === 0}
                        fetchPriority={index === 0 && panel.panelIndex === 0 ? "high" : "auto"}
                        quality={panel.panelIndex === 0 ? 58 : 56}
                        sizes={HERO_COMPOSITE_SIZES}
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_28%_20%,rgba(217,195,160,0.46),transparent_55%),radial-gradient(circle_at_76%_8%,rgba(255,255,255,0.12),transparent_44%),linear-gradient(140deg,#151311,#1e1a16)]" />
        )}
      </div>

      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(10,10,10,0.84)_8%,rgba(10,10,10,0.46)_50%,rgba(10,10,10,0.7)_100%)]" />

      <div className="oda-container relative flex min-h-[64svh] flex-col justify-end gap-4 py-7 sm:min-h-[68svh] sm:gap-6 sm:py-10 lg:min-h-[74svh] lg:gap-7 lg:py-14">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-end">
          <div className="max-w-[58rem] space-y-4 sm:space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--oda-gold)]">{cfgVal(config, "hero.eyebrow")}</p>
              <span className="rounded-full border border-white/30 bg-black/25 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/88">
                {contextualBadge}
              </span>
            </div>

            <h1 className="font-display text-[2.75rem] leading-[0.92] sm:text-[4.2rem] lg:text-[6.6rem]">
              {cfgVal(config, "hero.title")}
            </h1>

            <p className="max-w-xl text-[1.04rem] leading-snug text-white/82 sm:max-w-2xl sm:text-base sm:leading-relaxed">
              {cfgVal(config, "hero.subtitle")}
            </p>
          </div>

          {showProductSupport ? (
            <div className="hidden rounded-[1.15rem] border border-white/20 bg-white/10 p-5 backdrop-blur-sm lg:flex lg:flex-col lg:gap-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/76">Producto destacado</p>
              <p className="line-clamp-2 text-lg leading-tight text-white">{activeSlide?.name}</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-gold)]">{activeSlide?.brandName}</p>
              <p className="text-sm text-white/88">{heroPrice}</p>
              <a
                href={activeSlide?.sourceUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex w-fit rounded-full border border-white/45 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
              >
                Ver en tienda
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 pb-1 sm:gap-4 sm:pb-2">
          <Link
            href={cfgVal(config, "hero.cta_primary_href")}
            prefetch={false}
            className="rounded-full bg-[color:var(--oda-cream)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-white sm:px-6 sm:py-3"
          >
            {cfgVal(config, "hero.cta_primary_label")}
          </Link>
          <Link
            href={cfgVal(config, "hero.cta_secondary_href")}
            prefetch={false}
            className="rounded-full border border-white/55 px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-white transition hover:border-white hover:bg-white/8 sm:px-6 sm:py-3"
          >
            {cfgVal(config, "hero.cta_secondary_label")}
          </Link>

          <div className="ml-auto hidden rounded-full border border-white/25 bg-black/20 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-white/80 md:flex md:items-center md:gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--oda-gold)]" />
            Selección actualizada constantemente
          </div>
        </div>

        {slides.length > 1 ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {slides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Ir al slide ${index + 1}`}
                  aria-current={safeActiveIndex === index}
                  className={`h-2.5 rounded-full transition ${
                    safeActiveIndex === index ? "w-8 bg-white" : "w-2.5 bg-white/45 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current - 1 + slides.length) % slides.length)}
                className="rounded-full border border-white/35 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
                aria-label="Slide anterior"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current + 1) % slides.length)}
                className="rounded-full border border-white/35 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
                aria-label="Siguiente slide"
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
