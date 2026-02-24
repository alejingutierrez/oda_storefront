"use client";

import Image from "next/image";
import Link from "next/link";
import type { BrandLogo } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

export default function BrandMarquee({ brands }: { brands: BrandLogo[] }) {
  if (brands.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Marcas</p>
        <p className="text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">
          Estamos sincronizando marcas destacadas. Puedes navegar el catalogo completo mientras cargamos este modulo.
        </p>
      </div>
    );
  }

  const [featured, ...rest] = brands;
  const featuredImageSrc = proxiedImageUrl(featured.heroImageUrl, { kind: "cover" });
  const featuredLogoSrc = proxiedImageUrl(featured.logoUrl, { kind: "cover" });
  const featuredImageProxy = Boolean(featuredImageSrc?.startsWith("/api/image-proxy"));
  const featuredLogoProxy = Boolean(featuredLogoSrc?.startsWith("/api/image-proxy"));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Marcas</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Marcas destacadas</h2>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <Link
          href={`/marca/${encodeURIComponent(featured.slug)}`}
          prefetch={false}
          className="group relative overflow-hidden rounded-[1.4rem] border border-[color:var(--oda-border)] bg-white"
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-[color:var(--oda-stone)]">
            {featuredImageSrc ? (
              <Image
                src={featuredImageSrc}
                alt={featured.name}
                fill
                quality={56}
                sizes="(max-width: 1024px) 100vw, 52vw"
                className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                unoptimized={featuredImageProxy}
              />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.62),rgba(0,0,0,0.2),rgba(0,0,0,0.04))]" />
            <div className="absolute left-6 top-6 h-14 w-36 rounded-xl border border-white/28 bg-white/88 p-2 backdrop-blur-sm">
              {featuredLogoSrc ? (
                <Image
                  src={featuredLogoSrc}
                  alt={featured.name}
                  fill
                  quality={70}
                  sizes="144px"
                  className="object-contain p-2"
                  unoptimized={featuredLogoProxy}
                />
              ) : null}
            </div>
            <div className="absolute bottom-6 left-6 right-6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/76">Spotlight</p>
              <p className="mt-2 font-display text-3xl leading-none text-white sm:text-4xl">{featured.name}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-[color:var(--oda-border)] px-6 py-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Productos</p>
              <p className="mt-1 text-lg text-[color:var(--oda-ink)]">{new Intl.NumberFormat("es-CO").format(featured.productCount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Categorias</p>
              <p className="mt-1 text-lg text-[color:var(--oda-ink)]">{new Intl.NumberFormat("es-CO").format(featured.categoryCount)}</p>
            </div>
          </div>
        </Link>

        <div className="rounded-[1.4rem] border border-[color:var(--oda-border)] bg-white p-4 sm:p-5">
          {rest.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[color:var(--oda-border)]">
              {rest.slice(0, 8).map((brand) => {
                const logoSrc = proxiedImageUrl(brand.logoUrl, { kind: "cover" });
                const isProxy = Boolean(logoSrc?.startsWith("/api/image-proxy"));
                return (
                  <li key={brand.id} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      href={`/marca/${encodeURIComponent(brand.slug)}`}
                      prefetch={false}
                      className="group flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 transition hover:bg-[color:var(--oda-cream)]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative h-8 w-24 shrink-0">
                          {logoSrc ? (
                            <Image
                              src={logoSrc}
                              alt={brand.name}
                              fill
                              quality={70}
                              sizes="96px"
                              className="object-contain"
                              unoptimized={isProxy}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-[color:var(--oda-ink)]">{brand.name}</p>
                          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                            {brand.productCount} productos · {brand.categoryCount} categorias
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] transition group-hover:text-[color:var(--oda-ink)]">
                        Ver
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[color:var(--oda-ink-soft)]">Sumaremos mas marcas destacadas en la siguiente rotacion.</p>
          )}
        </div>
      </div>
    </div>
  );
}
