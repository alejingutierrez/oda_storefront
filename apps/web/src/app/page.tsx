import { Suspense } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import HomeBelowFold from "@/components/home/HomeBelowFold";
import HomeHeroImmersive from "@/components/home/HomeHeroImmersive";
import { getHeroSlides, getMegaMenuData, getRotationSeed } from "@/lib/home-data";

export const revalidate = 3600;

export default async function Home() {
  const seed = getRotationSeed();
  const [menu, heroSlides] = await Promise.all([getMegaMenuData(), getHeroSlides(seed, 4)]);

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />

      <HomeHeroImmersive slides={heroSlides} />

      <Suspense
        fallback={
          <div className="oda-container py-14 sm:py-18">
            <div className="h-8 w-52 animate-pulse rounded-full bg-white" />
            <div className="mt-4 h-[58svh] animate-pulse rounded-[1.2rem] bg-white" />
          </div>
        }
      >
        <HomeBelowFold seed={seed} heroIds={heroSlides.map((slide) => slide.id)} />
      </Suspense>

      <footer className="bg-[color:var(--oda-cream)]">
        <div className="oda-container grid gap-10 py-12 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <span className="text-sm uppercase tracking-[0.3em] text-[color:var(--oda-ink)]">ODA Storefront</span>
            <p className="text-sm text-[color:var(--oda-ink-soft)]">
              Descubre marcas colombianas, encuentra tu estilo y compra directo en tienda oficial.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
            <Link href="/novedades" prefetch={false}>Novedades</Link>
            <Link href="/femenino" prefetch={false}>Femenino</Link>
            <Link href="/masculino" prefetch={false}>Masculino</Link>
            <Link href="/unisex" prefetch={false}>Unisex</Link>
            <Link href="/infantil" prefetch={false}>Infantil</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">Newsletter</span>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Tu email"
                className="w-full rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-sm"
              />
              <button
                type="button"
                className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
