import Link from "next/link";

export default function SectionHeading({
  title,
  subtitle,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  subtitle?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          {subtitle}
        </p>
        <h2 className="text-3xl font-semibold text-[color:var(--oda-ink)] sm:text-4xl">
          {title}
        </h2>
      </div>
      {ctaHref && ctaLabel ? (
        <Link
          href={ctaHref}
          className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
