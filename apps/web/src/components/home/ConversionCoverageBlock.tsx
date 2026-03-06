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

  const lastUpdate = formatLastUpdate(safeStats.lastUpdatedAt);

  return (
    <section className="flex flex-col gap-4 rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Productos</p>
          <p className="font-display text-2xl leading-none text-[color:var(--oda-ink)]">{formatCount(safeStats.productCount)}</p>
        </div>
        <span className="hidden h-6 w-px bg-[color:var(--oda-border)] sm:block" />
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Marcas</p>
          <p className="font-display text-2xl leading-none text-[color:var(--oda-ink)]">{formatCount(safeStats.brandCount)}</p>
        </div>
        <span className="hidden h-6 w-px bg-[color:var(--oda-border)] sm:block" />
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">Categorías</p>
          <p className="font-display text-2xl leading-none text-[color:var(--oda-ink)]">{formatCount(safeStats.categoryCount)}</p>
        </div>
        {lastUpdate ? (
          <>
            <span className="hidden h-6 w-px bg-[color:var(--oda-border)] sm:block" />
            <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
              Actualizado {lastUpdate}
            </p>
          </>
        ) : null}
      </div>

      <div className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Próximamente: alertas de precio y estilo
        </p>
      </div>
    </section>
  );
}
