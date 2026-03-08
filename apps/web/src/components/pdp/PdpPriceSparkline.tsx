import type { PdpPriceHistory } from "@/lib/pdp-data";

type Props = {
  history: PdpPriceHistory;
};

function buildSparklinePath(points: { price: number }[], width: number, height: number): string {
  if (points.length < 2) return "";

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const stepX = width / (points.length - 1);
  const padding = 2;
  const usableHeight = height - padding * 2;

  return points
    .map((p, i) => {
      const x = i * stepX;
      const y = padding + usableHeight - ((p.price - min) / range) * usableHeight;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function PdpPriceSparkline({ history }: Props) {
  if (history.points.length < 7) return null;

  const width = 60;
  const height = 16;
  const path = buildSparklinePath(history.points, width, height);

  return (
    <div className="flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
        aria-hidden
      >
        <path
          d={path}
          fill="none"
          stroke="var(--oda-taupe)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`text-[10px] tracking-[0.08em] ${
          history.currentIsAllTimeLow
            ? "text-[color:var(--oda-gold)] font-medium"
            : "text-[color:var(--oda-taupe)]"
        }`}
      >
        {history.currentIsAllTimeLow
          ? "Precio más bajo registrado"
          : `${history.daysCovered} días de historial`}
      </span>
    </div>
  );
}
