import type { HomeCoverageStats } from "@/lib/home-types";

function formatCount(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function formatLastUpdate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function ConversionCoverageBlock({
  stats,
  seed,
}: {
  stats: HomeCoverageStats | null;
  seed: number;
}) {
  const safeStats: HomeCoverageStats = {
    productCount: stats?.productCount ?? 0,
    brandCount: stats?.brandCount ?? 0,
    categoryCount: stats?.categoryCount ?? 0,
    lastUpdatedAt: stats?.lastUpdatedAt ?? null,
  };

  const metricCards = [
    {
      key: "products",
      label: "Productos disponibles",
      value: formatCount(safeStats.productCount),
    },
    {
      key: "brands",
      label: "Marcas colombianas",
      value: formatCount(safeStats.brandCount),
    },
    {
      key: "categories",
      label: "Categorías activas",
      value: formatCount(safeStats.categoryCount),
    },
  ];

  const plans = [
    {
      key: "base",
      name: "Explora gratis",
      status: "Disponible",
      bullets: ["Descubre productos por estilo", "Compara marcas y precios rápido", "Compra directo en tiendas oficiales"],
    },
    {
      key: "plus",
      name: "Plus",
      status: "Muy pronto",
      bullets: ["Alertas cuando bajen de precio", "Avisos de tallas y reposiciones", "Recomendaciones más afines a tu estilo"],
    },
    {
      key: "stylist",
      name: "Stylist IA",
      status: "Muy pronto",
      bullets: ["Outfits personalizados para ti", "Try-on asistido", "Sugerencias para completar tu look"],
    },
  ];

  const offset = plans.length > 0 ? seed % plans.length : 0;
  const orderedPlans = [...plans.slice(offset), ...plans.slice(0, offset)];
  const lastUpdate = formatLastUpdate(safeStats.lastUpdatedAt);

  return (
    <section className="rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] lg:items-start">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Compra con confianza</p>
          <h2 className="mt-3 font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            Más opciones reales para elegir mejor.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            Te mostramos opciones reales de marcas colombianas para que encuentres lo que te gusta, compares rápido y
            compres con seguridad.
          </p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
            {lastUpdate ? `Última actualización del catálogo: ${lastUpdate}` : "Actualizando catálogo..."}
          </p>
        </div>

        <div className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Muy pronto</p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-3 inline-flex w-full cursor-not-allowed items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] px-5 py-3 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)] opacity-70"
          >
            Próximamente
          </button>
          <p className="mt-3 text-xs leading-relaxed text-[color:var(--oda-ink-soft)]">
            Estamos preparando beneficios para comprar aún más fácil: alertas, recomendaciones y ayuda de estilo.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {metricCards.map((card) => (
          <article
            key={card.key}
            className="rounded-[1rem] border border-[color:var(--oda-border)] bg-white px-5 py-4 shadow-[0_10px_26px_rgba(23,21,19,0.06)]"
          >
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">{card.label}</p>
            <p className="mt-2 font-display text-3xl leading-none text-[color:var(--oda-ink)]">{card.value}</p>
          </article>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {orderedPlans.map((plan) => (
          <article key={plan.key} className="rounded-[1rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-2xl leading-none text-[color:var(--oda-ink)]">{plan.name}</p>
              <span className="rounded-full border border-[color:var(--oda-border)] bg-white px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-[color:var(--oda-taupe)]">
                {plan.status}
              </span>
            </div>
            <ul className="mt-4 flex flex-col gap-2 text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">
              {plan.bullets.map((bullet) => (
                <li key={`${plan.key}-${bullet}`}>• {bullet}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
