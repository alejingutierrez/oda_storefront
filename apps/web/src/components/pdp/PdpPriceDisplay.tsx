"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

type Props = {
  price: string | null;
  currency: string;
  hasRange: boolean;
  priceChangeDirection: string | null;
};

function formatPrice(amount: string | null, currency: string) {
  if (!amount || Number(amount) <= 0) return "Consultar precio";
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

export default function PdpPriceDisplay({
  price,
  currency,
  hasRange,
  priceChangeDirection,
}: Props) {
  const formatted = formatPrice(price, currency);

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg font-medium text-[color:var(--oda-ink)]">
        {hasRange ? `Desde ${formatted}` : formatted}
      </span>

      {priceChangeDirection === "down" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-green-700">
          <TrendingDown className="h-3 w-3" />
          Bajó
        </span>
      )}
      {priceChangeDirection === "up" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-red-600">
          <TrendingUp className="h-3 w-3" />
          Subió
        </span>
      )}
    </div>
  );
}
