"use client";

import Image from "next/image";
import Link from "next/link";
import type { BrandLogo } from "@/lib/home-types";

export default function BrandMarquee({ brands }: { brands: BrandLogo[] }) {
  if (brands.length === 0) {
    return null;
  }

  const duplicated = [...brands, ...brands];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Marcas</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Marcas destacadas</h2>
      </div>

      <div className="relative overflow-hidden rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white px-0 py-7">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-white to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-white to-transparent" />

        <ul className="home-marquee-track group flex w-max items-center gap-10 px-8">
          {duplicated.map((brand, index) => {
            const isClone = index >= brands.length;
            return (
              <li
                key={`${brand.id}-${index}`}
                className="relative flex h-14 w-[132px] shrink-0 items-center justify-center"
                aria-hidden={isClone}
              >
                <Link
                  href={`/marca/${encodeURIComponent(brand.slug)}`}
                  tabIndex={isClone ? -1 : 0}
                  className="relative flex h-full w-full items-center justify-center rounded-lg opacity-85 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2"
                  aria-label={brand.name}
                >
                  <Image
                    src={brand.logoUrl}
                    alt={brand.name}
                    fill
                    sizes="132px"
                    className="object-contain"
                    unoptimized
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
