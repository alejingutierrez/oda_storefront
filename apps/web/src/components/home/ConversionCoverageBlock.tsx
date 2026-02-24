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
      label: "Productos activos",
      value: formatCount(safeStats.productCount),
    },
    {
      key: "brands",
      label: "Marcas activas",
      value: formatCount(safeStats.brandCount),
    },
    {
      key: "categories",
      label: "Categorias cubiertas",
      value: formatCount(safeStats.categoryCount),
    },
  ];

  const plans = [
    {
      key: "base",
      name: "Exploracion",
      status: "Activo",
      bullets: ["Cobertura completa de catalogo", "Rotacion editorial cada 3 dias", "Acceso abierto a descubrimiento"],
    },
    {
      key: "plus",
      name: "Proactivo",
      status: "Preview",
      bullets: ["Alertas de precio y stock", "Prioridad de recomendaciones", "Seguimiento de favoritos"],
    },
    {
      key: "stylist",
      name: "Stylist IA",
      status: "Preview",
      bullets: ["Looks personalizados", "Try-on asistido", "Asesoria de outfit"],
    },
  ];

  const offset = plans.length > 0 ? seed % plans.length : 0;
  const orderedPlans = [...plans.slice(offset), ...plans.slice(0, offset)];
  const lastUpdate = formatLastUpdate(safeStats.lastUpdatedAt);

  return (
    <section className="rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] lg:items-start">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Cobertura ODA</p>
          <h2 className="mt-3 font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            Conversion en modo preview.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            Mostramos el estado real de cobertura y adelantamos los bloques de conversion sin abrir aun el flujo final.
            La activacion quedara disponible en el siguiente release.
          </p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
            {lastUpdate ? `Ultima actualizacion detectada: ${lastUpdate}` : "Actualizando cobertura de catalogo..."}
          </p>
        </div>

        <div className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Activacion comercial</p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-3 inline-flex w-full cursor-not-allowed items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] px-5 py-3 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)] opacity-70"
          >
            Próximamente
          </button>
          <p className="mt-3 text-xs leading-relaxed text-[color:var(--oda-ink-soft)]">
            Este boton permanece deshabilitado hasta que esten listos planes y landing de conversion.
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
