import Image from "next/image";
import Link from "next/link";
import { proxiedImageUrl } from "@/lib/image-proxy";
import type { PdpBrand } from "@/lib/pdp-data";

type Props = {
  brand: PdpBrand;
};

export default function PdpBrandSection({ brand }: Props) {
  const logoSrc = proxiedImageUrl(brand.logoUrl, { kind: "logo" });

  return (
    <section className="mt-12 border-t border-[color:var(--oda-border)] pt-8 lg:mt-16">
      <div className="mx-auto flex max-w-2xl items-start gap-5">
        {/* Logo */}
        {logoSrc && (
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
                className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)] underline underline-offset-4 transition hover:text-[color:var(--oda-ink)]"
              >
                Instagram
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
