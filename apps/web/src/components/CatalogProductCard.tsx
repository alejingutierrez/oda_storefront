"use client";

import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog-data";
import FavoriteToggle from "@/components/FavoriteToggle";
import { proxiedImageUrl } from "@/lib/image-proxy";

const IMAGE_BLUR_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs=";

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

export default function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const href = product.sourceUrl ?? "#";
  const imageUrl = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });
  // Vercel/Next bloquea optimizacion de `next/image` cuando el src es un endpoint `/api/*` (INVALID_IMAGE_OPTIMIZE_REQUEST).
  const unoptimized = !!imageUrl && imageUrl.startsWith("/api/image-proxy");

  return (
    <article className="group relative overflow-hidden rounded-xl border border-[color:var(--oda-border)] bg-white shadow-[0_16px_36px_rgba(23,21,19,0.08)] transition duration-500 ease-out [transform-style:preserve-3d] hover:shadow-[0_30px_60px_rgba(23,21,19,0.14)] group-hover:[transform:perspective(900px)_rotateX(6deg)_translateY(-10px)]">
      <div className="absolute right-3 top-3 z-10">
        <FavoriteToggle productId={product.id} ariaLabel={`Guardar ${product.name} en favoritos`} />
      </div>
      <Link href={href} className="relative block aspect-[3/4] w-full overflow-hidden bg-[color:var(--oda-stone)]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={product.name}
            fill
            unoptimized={unoptimized}
            sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 22vw, (min-width: 768px) 45vw, 90vw"
            className="object-cover object-center transition duration-700 group-hover:scale-[1.07] group-hover:-translate-y-1"
            placeholder="blur"
            blurDataURL={IMAGE_BLUR_DATA_URL}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Sin imagen
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-[40%] translate-y-6 border-t border-white/40 bg-white/35 opacity-0 backdrop-blur-xl transition duration-500 group-hover:translate-y-0 group-hover:opacity-100">
          <div className="flex h-full flex-col justify-end gap-2 px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-ink-soft)]">
              {product.brandName}
            </p>
            <h3 className="text-sm font-semibold text-[color:var(--oda-ink)]">{product.name}</h3>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
              {formatPriceRange(product.minPrice, product.maxPrice, product.currency)}
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}
