import type { HomeTrustStrip } from "@/lib/home-types";

export default function ConversionCoverageBlock({
  trustStrip,
}: {
  trustStrip: HomeTrustStrip;
}) {
  if (!trustStrip.items.length) return null;

  return (
    <section className="rounded-[1.3rem] border border-[color:var(--oda-border)] bg-white px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
            {trustStrip.eyebrow}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {trustStrip.items.map((item) => (
              <div
                key={item.label}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2"
              >
                <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                  {item.label}
                </span>
                <span className="ml-2 font-display text-xl leading-none text-[color:var(--oda-ink)]">
                  {item.value}
                </span>
                {item.hint ? (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-ink-soft)]">
                    {item.hint}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-full border border-[color:var(--oda-border)] px-4 py-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
            {trustStrip.badge}
          </p>
        </div>
      </div>
    </section>
  );
}
