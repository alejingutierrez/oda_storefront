import Image from "next/image";
import Link from "next/link";
import { proxiedImageUrl } from "@/lib/image-proxy";
import type { PdpRelatedProduct } from "@/lib/pdp-data";

type Props = {
  products: PdpRelatedProduct[];
};

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) return "Consultar";
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? "COP"} ${value.toFixed(0)}`;
  }
}

function productHref(p: PdpRelatedProduct): string {
  if (p.slug && p.brandSlug) return `/producto/${p.brandSlug}/${p.slug}`;
  return p.sourceUrl ?? "#";
}

export default function PdpRelatedProducts({ products }: Props) {
  if (products.length === 0) return null;

  return (
    <section className="mt-12 pb-16 lg:mt-16">
      <h2 className="mb-6 text-center text-sm uppercase tracking-[0.22em] text-[color:var(--oda-ink)]">
        También te puede gustar
      </h2>

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto oda-no-scrollbar pb-2">
        {products.map((product) => {
          const imageSrc = proxiedImageUrl(product.imageCoverUrl, {
            productId: product.id,
            kind: "cover",
          });
          const href = productHref(product);
          const isExternal = !product.slug;

          return (
            <Link
              key={product.id}
              href={href}
              prefetch={false}
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noreferrer" : undefined}
              className="group flex w-[44vw] shrink-0 snap-start flex-col gap-3 sm:w-[32vw] lg:w-[23vw] xl:w-[18vw]"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
                {imageSrc ? (
                  <Image
                    src={imageSrc}
                    alt={product.name}
                    fill
                    quality={58}
                    sizes="(max-width: 640px) 44vw, (max-width: 1024px) 32vw, 18vw"
                    className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-4">
                    <span className="text-center text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                      {product.brandName}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="truncate text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  {product.brandName}
                </span>
                <span className="line-clamp-2 text-sm leading-snug text-[color:var(--oda-ink)]">
                  {product.name}
                </span>
                <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
                  {formatPrice(product.minPrice, product.currency)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
