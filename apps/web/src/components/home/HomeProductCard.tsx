"use client";

import Image from "next/image";
import Link from "next/link";
import type { HomeProductCardData } from "@/lib/home-types";
import { logExperienceEvent } from "@/lib/experience-events";
import { proxiedImageUrl } from "@/lib/image-proxy";

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
  surface = "home_product_card",
}: {
  product: HomeProductCardData;
  className?: string;
  sizes?: string;
  surface?: string;
}) {
  const hasPdpLink = product.brandSlug && product.slug;
  const href = hasPdpLink
    ? `/producto/${product.brandSlug}/${product.slug}`
    : (product.sourceUrl ?? "#");
  const isExternal = !hasPdpLink && !!product.sourceUrl;
  const imageSrc = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });

  return (
    <Link
      href={href}
      prefetch={false}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      onClick={() => {
        logExperienceEvent({
          type: "product_click",
          productId: product.id,
          path: typeof window !== "undefined" ? window.location.pathname : "/",
          properties: {
            surface,
          },
        });
      }}
      className={`group flex min-w-0 flex-col gap-3 ${className ?? ""}`}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[1.1rem] bg-[color:var(--oda-stone)]">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={product.name}
            fill
            quality={58}
            sizes={sizes}
            className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
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
