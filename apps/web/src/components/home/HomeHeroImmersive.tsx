import Image from "next/image";
import Link from "next/link";
import type { HomeProductCardData } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

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

export default function HomeHeroImmersive({ hero }: { hero: HomeProductCardData | null }) {
  const values = [toLabel(hero?.category), toLabel(hero?.subcategory)].filter(Boolean) as string[];
  const contextualBadge = values.length > 0 ? values.join(" · ") : "Edicion curada";
  const heroPrice = formatPrice(hero?.minPrice ?? null, hero?.currency ?? null);
  const showProductSupport = Boolean(hero?.name && hero?.brandName && hero?.sourceUrl && heroPrice);
  const heroImageSrc = proxiedImageUrl(hero?.imageCoverUrl ?? null, { productId: hero?.id ?? null, kind: "cover" });
  const isProxyHeroImage = Boolean(heroImageSrc?.startsWith("/api/image-proxy"));

  return (
    <section
      className="relative isolate min-h-[94svh] overflow-hidden border-b border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
    >
      <div className="home-parallax-media absolute inset-0">
        {heroImageSrc ? (
          <Image
            src={heroImageSrc}
            alt={hero?.name ?? "Producto destacado"}
            fill
            priority
            fetchPriority="high"
            decoding="sync"
            quality={56}
            sizes="(max-width: 640px) 90vw, 100vw"
            className="object-cover"
            unoptimized={isProxyHeroImage}
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_28%_20%,rgba(217,195,160,0.46),transparent_55%),radial-gradient(circle_at_76%_8%,rgba(255,255,255,0.12),transparent_44%),linear-gradient(140deg,#151311,#1e1a16)]" />
        )}
      </div>

      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(10,10,10,0.84)_10%,rgba(10,10,10,0.48)_48%,rgba(10,10,10,0.72)_100%)]" />

      <div className="oda-container relative flex min-h-[94svh] flex-col justify-end gap-8 py-14 sm:py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-end">
          <div className="max-w-[58rem] space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--oda-gold)]">ODA editorial</p>
              <span className="rounded-full border border-white/30 bg-black/25 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/88">
                {contextualBadge}
              </span>
            </div>

            <h1 className="font-display text-5xl leading-[0.94] sm:text-7xl lg:text-[7.2rem]">
              Descubre moda colombiana
              <br className="hidden md:block" /> con criterio editorial.
            </h1>

            <p className="max-w-2xl text-sm leading-relaxed text-white/82 sm:text-base">
              Curaduria viva con rotacion determinista cada 3 dias. Priorizamos producto real, navegacion rapida y
              composiciones visuales pensadas para descubrir mejor.
            </p>
          </div>

          {showProductSupport ? (
            <div className="hidden rounded-[1.15rem] border border-white/20 bg-white/10 p-5 backdrop-blur-sm lg:flex lg:flex-col lg:gap-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/76">Pieza destacada</p>
              <p className="line-clamp-2 text-lg leading-tight text-white">{hero?.name}</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-gold)]">{hero?.brandName}</p>
              <p className="text-sm text-white/88">{heroPrice}</p>
              <a
                href={hero?.sourceUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex w-fit rounded-full border border-white/45 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
              >
                Ver en tienda
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4 pb-2">
          <Link
            href="/buscar"
            prefetch={false}
            className="rounded-full bg-[color:var(--oda-cream)] px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-white"
          >
            Explorar ahora
          </Link>
          <Link
            href="/unisex"
            prefetch={false}
            className="rounded-full border border-white/55 px-6 py-3 text-[11px] uppercase tracking-[0.2em] text-white transition hover:border-white hover:bg-white/8"
          >
            Ver catalogo
          </Link>

          <div className="ml-auto hidden rounded-full border border-white/25 bg-black/20 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-white/80 md:flex md:items-center md:gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--oda-gold)]" />
            Rotacion semilla 3 dias
          </div>
        </div>
      </div>
    </section>
  );
}
