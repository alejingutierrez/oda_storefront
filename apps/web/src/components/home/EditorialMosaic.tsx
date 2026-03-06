"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type {
  CategoryHighlight,
  HomeActionableColorEntry,
  HomeBrandFeature,
} from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

function LogoFallback({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="grid h-full w-full place-items-center rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
        {initials || "ODA"}
      </span>
    </div>
  );
}

function BrandLogoImage({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(!src);
  if (!src || failed) return <LogoFallback name={name} />;

  return (
    <div className="relative h-full w-full">
      <Image
        src={src}
        alt={name}
        fill
        unoptimized
        sizes="144px"
        onError={() => setFailed(true)}
        className="object-contain"
      />
    </div>
  );
}

export default function EditorialMosaic({
  categories,
  colors,
  brandSpotlight,
  brands,
}: {
  categories: CategoryHighlight[];
  colors: HomeActionableColorEntry[];
  brandSpotlight: HomeBrandFeature | null;
  brands: HomeBrandFeature[];
}) {
  const hasCategories = categories.length > 0;
  const hasColors = colors.length > 0;
  const hasBrands = Boolean(brandSpotlight) || brands.length > 0;

  if (!hasCategories && !hasColors && !hasBrands) return null;

  const spotlightLogo = brandSpotlight ? proxiedImageUrl(brandSpotlight.logoUrl, { kind: "logo" }) : null;
  const spotlightImage = brandSpotlight ? proxiedImageUrl(brandSpotlight.heroImageUrl, { kind: "cover" }) : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
          Explorar mejor
        </p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
          Categorías, color y marcas con salida real
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
          Cada módulo aquí abre producto o listado útil. Nada de paletas decorativas ni logos sin contexto.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="grid gap-4 xl:col-span-7">
          <div className="rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Categorías</p>
                <h3 className="mt-1 font-display text-3xl leading-none text-[color:var(--oda-ink)]">
                  Entradas rápidas al catálogo
                </h3>
              </div>
              <Link
                href="/catalogo"
                prefetch={false}
                className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] transition hover:text-[color:var(--oda-ink)]"
              >
                Ver todo
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.slice(0, 6).map((category) => {
                const imageSrc = proxiedImageUrl(category.imageCoverUrl, { kind: "cover" });
                return (
                  <Link
                    key={`${category.category}-${category.href}`}
                    href={category.href}
                    prefetch={false}
                    className="group relative overflow-hidden rounded-[1.1rem] bg-[color:var(--oda-stone)]"
                  >
                    <div className="relative aspect-[5/4] w-full">
                      {imageSrc ? (
                        <Image
                          src={imageSrc}
                          alt={category.label}
                          fill
                          quality={58}
                          sizes="(max-width: 767px) 92vw, (max-width: 1279px) 31vw, 18vw"
                          className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.66),rgba(0,0,0,0.16),rgba(0,0,0,0))]" />
                      <div className="absolute inset-x-4 bottom-4">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">Categoría</p>
                        <p className="mt-1 text-lg leading-tight text-white">{category.label}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {hasColors ? (
            <div className="rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white p-5 sm:p-6">
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Color</p>
                <h3 className="mt-1 font-display text-3xl leading-none text-[color:var(--oda-ink)]">
                  Paletas que sí llevan a producto
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {colors.slice(0, 4).map((color) => {
                  const imageSrc = proxiedImageUrl(color.imageCoverUrl, { kind: "cover" });
                  return (
                    <Link
                      key={color.colorId}
                      href={color.href}
                      prefetch={false}
                      className="group relative overflow-hidden rounded-[1.15rem] bg-[color:var(--oda-stone)]"
                    >
                      <div className="relative aspect-[16/10] w-full">
                        {imageSrc ? (
                          <Image
                            src={imageSrc}
                            alt={color.label}
                            fill
                            quality={56}
                            sizes="(max-width: 767px) 92vw, (max-width: 1279px) 44vw, 24vw"
                            className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7),rgba(0,0,0,0.18),rgba(0,0,0,0))]" />
                        <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">{color.family}</p>
                            <p className="mt-1 text-xl leading-tight text-white">{color.label}</p>
                            <p className="mt-1 text-xs text-white/76">
                              {new Intl.NumberFormat("es-CO").format(color.productCount)} productos · {new Intl.NumberFormat("es-CO").format(color.brandCount)} marcas
                            </p>
                          </div>
                          <span
                            className="h-9 w-9 shrink-0 rounded-full border border-white/70 shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                            style={{ backgroundColor: color.hex }}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 xl:col-span-5">
          {brandSpotlight ? (
            <Link
              href={`/marca/${encodeURIComponent(brandSpotlight.slug)}`}
              prefetch={false}
              className="group relative overflow-hidden rounded-[1.5rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]"
            >
              <div className="relative aspect-[4/5] w-full">
                {spotlightImage ? (
                  <Image
                    src={spotlightImage}
                    alt={brandSpotlight.name}
                    fill
                    quality={56}
                    sizes="(max-width: 1279px) 100vw, 32vw"
                    className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                  />
                ) : null}
                <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7),rgba(0,0,0,0.18),rgba(0,0,0,0))]" />
                <div className="absolute left-5 top-5 h-12 w-28 rounded-xl border border-white/25 bg-white/90 p-2 backdrop-blur-sm">
                  <BrandLogoImage src={spotlightLogo} name={brandSpotlight.name} />
                </div>
                <div className="absolute inset-x-5 bottom-5 space-y-2 text-white">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/72">{brandSpotlight.badge}</p>
                  <p className="font-display text-3xl leading-none">{brandSpotlight.name}</p>
                  <p className="max-w-md text-sm leading-relaxed text-white/82">{brandSpotlight.blurb}</p>
                </div>
              </div>
            </Link>
          ) : null}

          {brands.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {brands.slice(0, 3).map((brand) => {
                const logoSrc = proxiedImageUrl(brand.logoUrl, { kind: "logo" });
                return (
                  <Link
                    key={brand.id}
                    href={`/marca/${encodeURIComponent(brand.slug)}`}
                    prefetch={false}
                    className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-4 transition hover:border-[color:var(--oda-ink-soft)]"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-12 w-20 shrink-0 rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-2">
                        <BrandLogoImage src={logoSrc} name={brand.name} />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">{brand.badge}</p>
                        <p className="font-display text-2xl leading-none text-[color:var(--oda-ink)]">{brand.name}</p>
                        <p className="text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">{brand.blurb}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
