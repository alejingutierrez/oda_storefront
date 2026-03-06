"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BrandLogo, CategoryHighlight, ColorCombo } from "@/lib/home-types";
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
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">{initials || "ODA"}</span>
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
  colorCombos,
  brands,
}: {
  categories: CategoryHighlight[];
  colorCombos: ColorCombo[];
  brands: BrandLogo[];
}) {
  const categoryScrollRef = useRef<HTMLDivElement>(null);

  const hasCategories = categories.length > 0;
  const hasBrands = brands.length > 0;
  const hasColors = colorCombos.length > 0;

  if (!hasCategories && !hasBrands && !hasColors) return null;

  const [featured, ...restBrands] = brands;

  const featuredImageSrc = featured ? proxiedImageUrl(featured.heroImageUrl, { kind: "cover" }) : null;
  const featuredLogoSrc = featured ? proxiedImageUrl(featured.logoUrl, { kind: "logo" }) : null;

  const scrollCategories = (direction: -1 | 1) => {
    const node = categoryScrollRef.current;
    if (!node) return;
    node.scrollBy({ left: node.clientWidth * 0.8 * direction, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Descubre</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
          Categorías, colores y marcas
        </h2>
      </div>

      {/* Desktop: asymmetric editorial grid */}
      <div className="hidden lg:grid lg:grid-cols-12 lg:grid-rows-[auto_auto] lg:gap-4">
        {/* Brand hero card - spans left 5 cols, 2 rows */}
        {featured ? (
          <Link
            href={`/marca/${encodeURIComponent(featured.slug)}`}
            prefetch={false}
            className="group relative col-span-5 row-span-2 overflow-hidden rounded-[1.4rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]"
          >
            <div className="relative aspect-[4/5] w-full">
              {featuredImageSrc ? (
                <Image
                  src={featuredImageSrc}
                  alt={featured.name}
                  fill
                  quality={56}
                  sizes="42vw"
                  className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                />
              ) : null}
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.62),rgba(0,0,0,0.2),rgba(0,0,0,0.04))]" />
              {featuredLogoSrc ? (
                <div className="absolute left-6 top-6 h-12 w-32 rounded-xl border border-white/28 bg-white/88 p-2 backdrop-blur-sm">
                  <BrandLogoImage src={featuredLogoSrc} name={featured.name} />
                </div>
              ) : null}
              <div className="absolute bottom-6 left-6 right-6">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/76">Marca destacada</p>
                <p className="mt-2 font-display text-3xl leading-none text-white">{featured.name}</p>
                <p className="mt-2 text-xs text-white/70">
                  {featured.productCount} productos · {featured.categoryCount} categorías
                </p>
              </div>
            </div>
          </Link>
        ) : null}

        {/* Category cards - top right */}
        <div className="col-span-7 grid grid-cols-3 gap-4">
          {categories.slice(0, 3).map((cat) => {
            const imageSrc = proxiedImageUrl(cat.imageCoverUrl, { kind: "cover" });
            return (
              <Link
                key={`${cat.category}-${cat.href}`}
                href={cat.href}
                prefetch={false}
                className="group relative overflow-hidden rounded-[1.15rem] bg-[color:var(--oda-stone)]"
              >
                <div className="relative aspect-square w-full">
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={cat.label}
                      fill
                      quality={58}
                      sizes="18vw"
                      className="object-cover saturate-[0.72] transition duration-700 ease-out group-hover:scale-[1.04] group-hover:saturate-100"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.68),rgba(0,0,0,0.14),rgba(0,0,0,0))]" />
                  <div className="absolute inset-x-4 bottom-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/72">Categoría</p>
                    <p className="mt-1 text-lg leading-tight text-white">{cat.label}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Color swatches + brand logos - bottom right */}
        <div className="col-span-7 flex gap-4">
          {/* Color swatches */}
          {hasColors ? (
            <div className="flex flex-1 gap-3 rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-4">
              {colorCombos.slice(0, 3).map((combo) => (
                <div key={combo.id} className="flex flex-1 flex-col gap-2">
                  <p className="truncate text-[9px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">{combo.comboKey}</p>
                  <div className="flex gap-1.5">
                    {combo.colors.slice(0, 4).map((color, i) => (
                      <div
                        key={`${combo.id}-${color.hex}-${i}`}
                        className="h-8 w-8 rounded-lg border border-[color:var(--oda-border)]"
                        style={{ backgroundColor: color.hex }}
                        title={color.pantoneName ?? color.hex}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Brand logos strip */}
          {restBrands.length > 0 ? (
            <div className="flex items-center gap-3 rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-4">
              {restBrands.slice(0, 6).map((brand) => {
                const logoSrc = proxiedImageUrl(brand.logoUrl, { kind: "logo" });
                return (
                  <Link
                    key={brand.id}
                    href={`/marca/${encodeURIComponent(brand.slug)}`}
                    prefetch={false}
                    className="relative h-8 w-20 shrink-0 transition hover:opacity-80"
                  >
                    <BrandLogoImage src={logoSrc} name={brand.name} />
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile: stacked vertical layout */}
      <div className="flex flex-col gap-6 lg:hidden">
        {/* Brand hero card */}
        {featured ? (
          <Link
            href={`/marca/${encodeURIComponent(featured.slug)}`}
            prefetch={false}
            className="group relative overflow-hidden rounded-[1.4rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]"
          >
            <div className="relative aspect-[4/3] w-full">
              {featuredImageSrc ? (
                <Image
                  src={featuredImageSrc}
                  alt={featured.name}
                  fill
                  quality={56}
                  sizes="100vw"
                  className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                />
              ) : null}
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.62),rgba(0,0,0,0.2),rgba(0,0,0,0.04))]" />
              <div className="absolute bottom-5 left-5 right-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/76">Marca destacada</p>
                <p className="mt-2 font-display text-2xl leading-none text-white sm:text-3xl">{featured.name}</p>
              </div>
            </div>
          </Link>
        ) : null}

        {/* Category strip - horizontal scroll */}
        {hasCategories ? (
          <div className="relative">
            <div className="flex items-center justify-between gap-2 pb-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Categorías</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => scrollCategories(-1)}
                  className="rounded-full border border-[color:var(--oda-border)] bg-white p-1.5 text-[color:var(--oda-ink)]"
                  aria-label="Anterior"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollCategories(1)}
                  className="rounded-full border border-[color:var(--oda-border)] bg-white p-1.5 text-[color:var(--oda-ink)]"
                  aria-label="Siguiente"
                >
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </div>
            </div>
            <div ref={categoryScrollRef} className="home-hide-scroll flex gap-3 overflow-x-auto pb-2">
              {categories.slice(0, 8).map((cat) => {
                const imageSrc = proxiedImageUrl(cat.imageCoverUrl, { kind: "cover" });
                return (
                  <Link
                    key={`${cat.category}-${cat.href}`}
                    href={cat.href}
                    prefetch={false}
                    className="group relative min-w-[46vw] shrink-0 overflow-hidden rounded-[1.1rem] bg-[color:var(--oda-stone)] sm:min-w-[36vw]"
                  >
                    <div className="relative h-[130px] w-full">
                      {imageSrc ? (
                        <Image
                          src={imageSrc}
                          alt={cat.label}
                          fill
                          quality={58}
                          sizes="48vw"
                          className="object-cover saturate-[0.72] transition duration-700 ease-out group-hover:scale-[1.04] group-hover:saturate-100"
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.68),rgba(0,0,0,0.14),rgba(0,0,0,0))]" />
                      <div className="absolute inset-x-3 bottom-3">
                        <p className="text-sm leading-tight text-white">{cat.label}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Color swatches - horizontal */}
        {hasColors ? (
          <div className="home-hide-scroll flex gap-3 overflow-x-auto pb-1">
            {colorCombos.map((combo) => (
              <div
                key={combo.id}
                className="flex min-w-[200px] shrink-0 flex-col gap-2 rounded-[1.1rem] border border-[color:var(--oda-border)] bg-white p-4"
              >
                <p className="truncate text-[9px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">{combo.comboKey}</p>
                <div className="flex gap-1.5">
                  {combo.colors.slice(0, 4).map((color, i) => (
                    <div
                      key={`${combo.id}-${color.hex}-${i}`}
                      className="h-7 w-7 rounded-lg border border-[color:var(--oda-border)]"
                      style={{ backgroundColor: color.hex }}
                      title={color.pantoneName ?? color.hex}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Brand logos strip - horizontal */}
        {restBrands.length > 0 ? (
          <div className="home-hide-scroll flex gap-4 overflow-x-auto pb-1">
            {restBrands.slice(0, 8).map((brand) => {
              const logoSrc = proxiedImageUrl(brand.logoUrl, { kind: "logo" });
              return (
                <Link
                  key={brand.id}
                  href={`/marca/${encodeURIComponent(brand.slug)}`}
                  prefetch={false}
                  className="relative h-8 w-20 shrink-0 transition hover:opacity-80"
                >
                  <BrandLogoImage src={logoSrc} name={brand.name} />
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
