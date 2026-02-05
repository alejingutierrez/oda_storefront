import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog-data";

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

function formatPriceRange(minPrice: string | null, maxPrice: string | null, currency: string | null) {
  if (!minPrice && !maxPrice) {
    return "Consultar";
  }
  if (!maxPrice || minPrice === maxPrice) {
    return formatPrice(minPrice ?? maxPrice, currency);
  }
  return `${formatPrice(minPrice, currency)} · ${formatPrice(maxPrice, currency)}`;
}

function isHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export default function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const href = product.sourceUrl ?? "#";
  const validColors = product.colors.filter(isHex);
  const colors = validColors.slice(0, 5);
  const remaining = Math.max(0, validColors.length - colors.length);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[color:var(--oda-border)] bg-white shadow-[0_18px_40px_rgba(23,21,19,0.08)] transition duration-500 hover:-translate-y-1">
      <Link href={href} className="relative block aspect-square w-full overflow-hidden bg-[color:var(--oda-stone)]">
        {product.imageCoverUrl ? (
          <Image
            src={product.imageCoverUrl}
            alt={product.name}
            fill
            sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 22vw, (min-width: 768px) 45vw, 90vw"
            className="object-cover transition duration-500 group-hover:scale-[1.03]"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Sin imagen
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
              {product.brandName}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-[color:var(--oda-ink)]">
              <Link href={href} className="hover:underline">
                {product.name}
              </Link>
            </h3>
          </div>
          <span className="rounded-full border border-[color:var(--oda-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
            {product.variantCount} variantes
          </span>
        </div>
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
          {formatPriceRange(product.minPrice, product.maxPrice, product.currency)}
        </div>
        {colors.length > 0 ? (
          <div className="mt-auto flex items-center gap-2">
            {colors.map((hex) => (
              <span
                key={`${product.id}-${hex}`}
                className="h-4 w-4 rounded-full border border-[color:var(--oda-border)]"
                style={{ backgroundColor: hex }}
              />
            ))}
            {remaining > 0 ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                +{remaining}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="mt-auto text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Colores en proceso
          </span>
        )}
      </div>
    </article>
  );
}
