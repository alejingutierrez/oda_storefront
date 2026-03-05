import Image from "next/image";
import Link from "next/link";
import { proxiedImageUrl } from "@/lib/image-proxy";
import type { PdpBrand } from "@/lib/pdp-data";

type Props = {
  brand: PdpBrand;
};

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function PdpBrandSection({ brand }: Props) {
  const logoSrc = proxiedImageUrl(brand.logoUrl, { kind: "logo" });

  return (
    <section className="mt-12 lg:mt-16">
      <div className="mx-auto max-w-2xl rounded-2xl bg-[color:var(--oda-stone)]/50 p-6 lg:p-8">
        <div className="flex items-start gap-5">
          {/* Logo or fallback avatar */}
          {logoSrc ? (
            <Link
              href={`/marca/${brand.slug}`}
              prefetch={false}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white"
            >
              <Image
                src={logoSrc}
                alt={brand.name}
                fill
                className="object-contain p-1"
                sizes="64px"
              />
            </Link>
          ) : (
            <Link
              href={`/marca/${brand.slug}`}
              prefetch={false}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[color:var(--oda-stone)]"
            >
              <span className="text-lg font-medium uppercase text-[color:var(--oda-ink)]">
                {brand.name.charAt(0)}
              </span>
            </Link>
          )}

          {/* Info */}
          <div className="flex min-w-0 flex-col gap-2">
            <Link
              href={`/marca/${brand.slug}`}
              prefetch={false}
              className="text-sm font-medium uppercase tracking-[0.16em] text-[color:var(--oda-ink)] transition hover:text-[color:var(--oda-taupe)]"
            >
              {brand.name}
            </Link>

            {brand.description && (
              <p className="line-clamp-3 text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">
                {brand.description}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Link
                href={`/marca/${brand.slug}`}
                prefetch={false}
                className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)] underline underline-offset-4 transition hover:text-[color:var(--oda-ink)]"
              >
                Ver marca
              </Link>
              {brand.instagram && (
                <a
                  href={`https://instagram.com/${brand.instagram.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
                >
                  <InstagramIcon className="h-3.5 w-3.5" />
                  @{brand.instagram.replace(/^@/, "")}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
