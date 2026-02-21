import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import BrandMarquee from "@/components/home/BrandMarquee";
import CategoryGallery from "@/components/home/CategoryGallery";
import ColorSwatchPalette from "@/components/home/ColorSwatchPalette";
import CuratedStickyEdit from "@/components/home/CuratedStickyEdit";
import HomeHeroImmersive from "@/components/home/HomeHeroImmersive";
import ProductCarousel from "@/components/home/ProductCarousel";
import RevealOnScroll from "@/components/home/RevealOnScroll";
import {
  getBrandLogos,
  getCategoryHighlights,
  getColorCombos,
  getHeroProduct,
  getMegaMenuData,
  getNewArrivals,
  getRotationSeed,
  getStyleGroups,
  getTrendingPicks,
} from "@/lib/home-data";

export const revalidate = 3600;
// Avoid flaky SSG timeouts for `/` in Vercel builds; home data is still cached in `home-data` via `unstable_cache`.
export const dynamic = "force-dynamic";

export default async function Home() {
  const seed = getRotationSeed();
  const [
    menu,
    hero,
    newArrivals,
    categoryHighlights,
    styleGroups,
    colorCombos,
    brandLogos,
    trending,
  ] = await Promise.all([
    getMegaMenuData(),
    getHeroProduct(seed),
    getNewArrivals(seed, 8),
    getCategoryHighlights(seed, 8),
    getStyleGroups(seed, 3),
    getColorCombos(seed, 6),
    getBrandLogos(seed, 24),
    getTrendingPicks(seed, 8),
  ]);

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />

      <HomeHeroImmersive hero={hero} />

      <section className="oda-container py-16 sm:py-18">
        <RevealOnScroll>
          <ProductCarousel
            title="Novedades que rotan cada 3 dias"
            subtitle="Nuevo"
            ctaHref="/novedades"
            ctaLabel="Ver todo"
            products={newArrivals}
            ariaLabel="Carrusel de novedades"
          />
        </RevealOnScroll>
      </section>

      <section className="oda-container pb-18">
        <RevealOnScroll>
          <CategoryGallery categories={categoryHighlights} />
        </RevealOnScroll>
      </section>

      <section className="oda-container pb-20">
        <RevealOnScroll>
          <CuratedStickyEdit styleGroups={styleGroups} />
        </RevealOnScroll>
      </section>

      <section className="oda-container pb-20">
        <RevealOnScroll>
          <ColorSwatchPalette colorCombos={colorCombos} />
        </RevealOnScroll>
      </section>

      <section className="oda-container pb-20">
        <RevealOnScroll>
          <BrandMarquee brands={brandLogos} />
        </RevealOnScroll>
      </section>

      <section className="oda-container pb-22">
        <RevealOnScroll>
          <ProductCarousel
            title="Trending picks"
            subtitle="Rotacion"
            products={trending}
            ariaLabel="Carrusel de trending picks"
          />
        </RevealOnScroll>
      </section>

      <section className="border-y border-[color:var(--oda-border)] bg-white">
        <div className="oda-container grid gap-8 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <RevealOnScroll className="flex flex-col gap-4 lg:pr-8">
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
              className="mt-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              Ver todo el catalogo
            </Link>
          </RevealOnScroll>

          <RevealOnScroll>
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[1.45rem] bg-[color:var(--oda-stone)] shadow-[0_32px_90px_rgba(23,21,19,0.16)]">
              {hero?.imageCoverUrl ? (
                <Image
                  src={hero.imageCoverUrl}
                  alt={hero.name}
                  fill
                  sizes="(max-width: 1024px) 80vw, 42vw"
                  className="object-cover"
                  unoptimized
                />
              ) : null}
            </div>
          </RevealOnScroll>
        </div>
      </section>

      <footer className="bg-[color:var(--oda-cream)]">
        <div className="oda-container grid gap-10 py-12 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <span className="text-sm uppercase tracking-[0.3em] text-[color:var(--oda-ink)]">ODA Storefront</span>
            <p className="text-sm text-[color:var(--oda-ink-soft)]">
              Moda colombiana curada, catalogo vivo y experiencia editorial inmersiva.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            <Link href="/novedades">Novedades</Link>
            <Link href="/femenino">Femenino</Link>
            <Link href="/masculino">Masculino</Link>
            <Link href="/unisex">Unisex</Link>
            <Link href="/infantil">Infantil</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Newsletter</span>
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
