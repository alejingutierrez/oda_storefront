import Image from "next/image";
import Link from "next/link";
import type { HomeProductCardData } from "@/lib/home-types";

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) {
    return "Consultar";
  }
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

export default function HomeProductCard({
  product,
  className,
  sizes = "(max-width: 640px) 68vw, (max-width: 1024px) 40vw, 24vw",
}: {
  product: HomeProductCardData;
  className?: string;
  sizes?: string;
}) {
  const href = product.sourceUrl ?? "#";

  return (
    <Link href={href} className={`group flex min-w-0 flex-col gap-3 ${className ?? ""}`}>
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[1.1rem] bg-[color:var(--oda-stone)]">
        {product.imageCoverUrl ? (
          <Image
            src={product.imageCoverUrl}
            alt={product.name}
            fill
            sizes={sizes}
            className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
            unoptimized
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="truncate text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
          {product.brandName}
        </span>
        <span className="line-clamp-2 text-sm leading-snug text-[color:var(--oda-ink)] sm:text-[15px]">
          {product.name}
        </span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
          {formatPrice(product.minPrice, product.currency)}
        </span>
      </div>
    </Link>
  );
}
