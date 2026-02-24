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

  const cards = [
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

  const offset = cards.length > 0 ? seed % cards.length : 0;
  const orderedCards = [...cards.slice(offset), ...cards.slice(0, offset)];
  const lastUpdate = formatLastUpdate(safeStats.lastUpdatedAt);

  return (
    <section className="rounded-[1.5rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] lg:items-end">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Cobertura ODA</p>
          <h2 className="mt-3 font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">
            Catalogo en expansion continua.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            Este bloque adelanta la siguiente fase de conversion. Por ahora mostramos cobertura real del catalogo y
            mantenemos la accion principal en modo informativo.
          </p>
          {lastUpdate ? (
            <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
              Ultima actualizacion detectada: {lastUpdate}
            </p>
          ) : (
            <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
              Actualizando cobertura de catalogo...
            </p>
          )}
        </div>

        <div className="rounded-[1.1rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Siguiente release</p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-3 inline-flex w-full cursor-not-allowed items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] px-5 py-3 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)] opacity-70"
          >
            Próximamente
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {orderedCards.map((card) => (
          <article
            key={card.key}
            className="rounded-[1rem] border border-[color:var(--oda-border)] bg-white px-5 py-4 shadow-[0_10px_26px_rgba(23,21,19,0.06)]"
          >
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">{card.label}</p>
            <p className="mt-2 font-display text-3xl leading-none text-[color:var(--oda-ink)]">{card.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
