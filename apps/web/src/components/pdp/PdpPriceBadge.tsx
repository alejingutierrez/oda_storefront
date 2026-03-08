import type { PdpPriceInsight } from "@/lib/pdp-data";

type Props = {
  insight: PdpPriceInsight;
};

export default function PdpPriceBadge({ insight }: Props) {
  if (insight.isBestPrice30d) {
    return (
      <span className="inline-flex items-center rounded-full bg-[color:var(--oda-gold)]/20 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--oda-ink)]">
        Mejor precio
      </span>
    );
  }

  if (insight.isDeepDiscount) {
    return (
      <span className="inline-flex items-center rounded-full bg-[color:var(--oda-gold)]/20 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--oda-ink)]">
        Gran descuento
      </span>
    );
  }

  return null;
}
