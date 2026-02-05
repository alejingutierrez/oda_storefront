import Image from "next/image";
import Link from "next/link";
import type { ProductCard as ProductCardType } from "@/lib/home-data";

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

export default function ProductCard({ product }: { product: ProductCardType }) {
  const href = product.sourceUrl ?? "#";
  return (
    <Link href={href} className="group flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
        {product.imageCoverUrl ? (
          <Image
            src={product.imageCoverUrl}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-cover transition duration-500 group-hover:scale-[1.02]"
            unoptimized
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
          {product.brandName}
        </span>
        <span className="text-sm font-medium text-[color:var(--oda-ink)]">
          {product.name}
        </span>
        <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--oda-ink-soft)]">
          {formatPrice(product.minPrice, product.currency)}
        </span>
      </div>
    </Link>
  );
}
