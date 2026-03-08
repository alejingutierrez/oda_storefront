type Props = {
  score: number;
  className?: string;
};

export default function MatchBadge({ score, className = "" }: Props) {
  const bgClass =
    score >= 90
      ? "bg-[color:var(--oda-gold)]/90"
      : score >= 70
        ? "bg-[color:var(--oda-gold)]/60"
        : "bg-[color:var(--oda-stone)]";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-[color:var(--oda-ink)] ${bgClass} ${className}`}
    >
      {score}% match
    </span>
  );
}
