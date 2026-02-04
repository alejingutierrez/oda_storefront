import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import ProductCard from "@/components/ProductCard";
import SectionHeading from "@/components/SectionHeading";
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

      <section className="relative overflow-hidden border-b border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-center gap-6">
            <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
              ODA editorial
            </p>
            <h1 className="text-5xl font-semibold leading-tight text-[color:var(--oda-ink)] sm:text-6xl">
              Moda colombiana curada. Descubre lo nuevo cada 3 dias.
            </h1>
            <p className="max-w-xl text-base text-[color:var(--oda-ink-soft)]">
              Catalogo vivo con mas de 500 marcas locales. Seleccion editorial que rota automaticamente
              para mostrar lo mejor del momento.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/buscar"
                className="rounded-full bg-[color:var(--oda-ink)] px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
              >
                Explorar ahora
              </Link>
              <Link
                href="/g/unisex"
                className="rounded-full border border-[color:var(--oda-ink)] px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Ver catalogo
              </Link>
            </div>
          </div>
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[32px] bg-[color:var(--oda-cream)] shadow-[0_40px_90px_rgba(23,21,19,0.18)]">
            {hero?.imageCoverUrl ? (
              <Image
                src={hero.imageCoverUrl}
                alt={hero.name}
                fill
                sizes="(max-width: 1024px) 80vw, 40vw"
                className="object-cover"
                priority
              />
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-16">
        <SectionHeading
          title="Novedades que rotan cada 3 dias"
          subtitle="Nuevo"
          ctaHref="/buscar"
          ctaLabel="Ver todo"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {newArrivals.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-16">
        <SectionHeading
          title="Categorias clave"
          subtitle="Explorar"
          ctaHref="/g/unisex"
          ctaLabel="Ver catalogo"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {categoryHighlights.map((category) => (
            <Link
              key={category.category}
              href={category.href}
              className="group relative overflow-hidden rounded-2xl bg-[color:var(--oda-stone)]"
            >
              <div className="relative aspect-square w-full">
                <Image
                  src={category.imageCoverUrl}
                  alt={category.label}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  className="object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/5 to-transparent"></div>
              <div className="absolute bottom-4 left-4 text-sm uppercase tracking-[0.2em] text-white">
                {category.label}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-16">
        <SectionHeading title="Curated edit" subtitle="Estilo" />
        <div className="grid gap-10">
          {styleGroups.map((group) => (
            <div key={group.styleKey} className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-semibold text-[color:var(--oda-ink)]">
                  {group.label}
                </h3>
                <Link
                  href="/buscar"
                  className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
                >
                  Ver mas
                </Link>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {group.products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-16">
        <SectionHeading title="Shop by color" subtitle="Combos" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {colorCombos.map((combo) => (
            <div
              key={combo.id}
              className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-6"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {combo.comboKey}
                </span>
                <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {combo.detectedLayout ?? "combo"}
                </span>
              </div>
              <div className="mt-6 grid grid-cols-4 gap-3">
                {combo.colors.map((color, index) => (
                  <div
                    key={`${combo.id}-${color.hex}-${index}`}
                    className="flex flex-col gap-2"
                  >
                    <div
                      className="h-14 w-full rounded-xl border border-[color:var(--oda-border)]"
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                      {color.pantoneName ?? color.hex}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-16">
        <SectionHeading title="Marcas destacadas" subtitle="Marcas" />
        <div className="grid grid-cols-2 gap-6 rounded-3xl border border-[color:var(--oda-border)] bg-white p-10 sm:grid-cols-3 lg:grid-cols-6">
          {brandLogos.map((brand) => (
            <div
              key={brand.id}
              className="relative flex h-16 items-center justify-center"
            >
              <Image
                src={brand.logoUrl}
                alt={brand.name}
                fill
                sizes="120px"
                className="object-contain"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-20">
        <SectionHeading title="Trending picks" subtitle="Rotacion" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {trending.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section className="border-t border-[color:var(--oda-border)] bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              ODA Story
            </p>
            <h2 className="text-4xl font-semibold text-[color:var(--oda-ink)]">
              Editorial colombiano, siempre actualizado.
            </h2>
            <p className="text-base text-[color:var(--oda-ink-soft)]">
              Las marcas y productos del home se refrescan automaticamente cada 3 dias. Sin intervencion
              humana, solo descubrimiento continuo.
            </p>
            <Link
              href="/g/unisex"
              className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              Ver todo el catalogo
            </Link>
          </div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-[color:var(--oda-stone)]">
            {hero?.imageCoverUrl ? (
              <Image
                src={hero.imageCoverUrl}
                alt={hero.name}
                fill
                sizes="(max-width: 1024px) 80vw, 40vw"
                className="object-cover"
              />
            ) : null}
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <span className="text-sm uppercase tracking-[0.28em]">ODA Storefront</span>
            <p className="text-sm text-[color:var(--oda-ink-soft)]">
              Moda colombiana curada, catalogo vivo y descubrimiento editorial.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            <Link href="/g/femenino">Femenino</Link>
            <Link href="/g/masculino">Masculino</Link>
            <Link href="/g/unisex">Unisex</Link>
            <Link href="/g/infantil">Infantil</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Newsletter
            </span>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Tu email"
                className="w-full rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-sm"
              />
              <button
                type="button"
                className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
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
