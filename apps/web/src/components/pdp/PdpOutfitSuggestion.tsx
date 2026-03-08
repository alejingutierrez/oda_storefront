import Image from "next/image";
import Link from "next/link";
import type { PdpOutfitItem } from "@/lib/pdp-data";
import { proxiedImageUrl } from "@/lib/image-proxy";

type Props = {
  items: PdpOutfitItem[];
};

export default function PdpOutfitSuggestion({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="mt-10 mb-8">
      <h2 className="mb-4 text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
        Completa el look
      </h2>
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {items.map((item) => {
          const href = item.slug && item.brandSlug
            ? `/producto/${item.brandSlug}/${item.slug}`
            : (item.sourceUrl ?? "#");
          const imgSrc = item.imageCoverUrl
            ? proxiedImageUrl(item.imageCoverUrl, { productId: item.id, kind: "cover" })
            : null;

          return (
            <Link
              key={item.id}
              href={href}
              className="group block overflow-hidden rounded-xl border border-[color:var(--oda-border)] bg-white transition hover:shadow-[0_8px_24px_rgba(23,21,19,0.08)]"
            >
              <div className="relative aspect-[3/4] w-full bg-[color:var(--oda-stone)]">
                {imgSrc && (
                  <Image
                    src={imgSrc}
                    alt={item.name}
                    fill
                    sizes="(max-width: 640px) 33vw, 180px"
                    className="object-cover transition group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="p-2.5 sm:p-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
                  {item.brandName}
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-[color:var(--oda-ink)]">
                  {item.name}
                </p>
                {item.minPrice && item.currency && (
                  <p className="mt-1 text-xs font-medium text-[color:var(--oda-ink)]">
                    {new Intl.NumberFormat("es-CO", {
                      style: "currency",
                      currency: item.currency,
                      maximumFractionDigits: 0,
                    }).format(Number(item.minPrice))}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
