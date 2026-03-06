import Link from "next/link";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { HomeQuickDiscoveryCard } from "@/lib/home-types";

export default function HomeQuickDiscovery({
  cards,
}: {
  cards: HomeQuickDiscoveryCard[];
}) {
  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Descubrir rápido</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
          Entra por intención, no por ruido visual
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
          Cuatro accesos con salida directa a producto, respaldados por inventario, frescura y variedad real de marcas.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <article
            key={card.key}
            className="rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white p-5 shadow-[0_18px_50px_rgba(23,21,19,0.06)] sm:p-6"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">{card.eyebrow}</p>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <h3 className="font-display text-3xl leading-none text-[color:var(--oda-ink)]">
                      {card.title}
                    </h3>
                    <p className="max-w-xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">
                      {card.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-ink-soft)]">
                    <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-1.5">
                      {new Intl.NumberFormat("es-CO").format(card.productCount)} productos
                    </span>
                    <span className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-1.5">
                      {new Intl.NumberFormat("es-CO").format(card.brandCount)} marcas
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {card.products.slice(0, 3).map((product) => (
                  <HomeProductCard
                    key={`${card.key}-${product.id}`}
                    product={product}
                    surface={`home_quick_discovery_${card.key}`}
                    className="gap-2"
                    sizes="(max-width: 767px) 28vw, (max-width: 1279px) 20vw, 12vw"
                  />
                ))}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                  Entrada accionable al catálogo
                </p>
                <Link
                  href={card.href}
                  prefetch={false}
                  className="rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-ink)] hover:text-[color:var(--oda-cream)]"
                >
                  {card.ctaLabel}
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
