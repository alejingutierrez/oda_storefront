"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import FavoriteToggle from "@/components/FavoriteToggle";
import MatchBadge from "./MatchBadge";
import type { ScoredProduct } from "@/lib/style-engine/types";
import { proxiedImageUrl } from "@/lib/image-proxy";

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount) return null;
  const num = parseFloat(amount);
  if (!Number.isFinite(num)) return null;
  const formatted = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: currency || "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
  return formatted;
}

type Props = {
  product: ScoredProduct;
};

export default function RecommendationCard({ product }: Props) {
  const [imgError, setImgError] = useState(false);
  const price = formatPrice(
    product.minPriceCop ?? product.maxPriceCop,
    product.currency,
  );

  const href = product.slug && product.brandSlug
    ? `/producto/${product.id}`
    : `/producto/${product.id}`;

  const imageSrc = proxiedImageUrl(product.imageCoverUrl, {
    productId: product.id,
    kind: "cover",
  });

  return (
    <div className="group relative">
      <Link href={href} className="block">
        {/* Image */}
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
          {imageSrc && !imgError ? (
            <Image
              src={imageSrc}
              alt={product.name}
              fill
              quality={75}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition group-hover:scale-[1.03]"
              onError={() => setImgError(true)}
            />
          ) : null}

          {/* Match badge */}
          <MatchBadge
            score={product.matchScore}
            className="absolute left-2 top-2"
          />
        </div>

        {/* Info */}
        <div className="mt-2">
          <p className="truncate text-sm font-semibold text-[color:var(--oda-ink)]">
            {product.name}
          </p>
          <p className="truncate text-xs text-[color:var(--oda-taupe)]">
            {product.brandName}
          </p>
          {price && (
            <p className="mt-0.5 text-sm font-medium text-[color:var(--oda-ink)]">
              {price}
            </p>
          )}
        </div>
      </Link>

      {/* Favorite toggle */}
      <div className="absolute right-2 top-2">
        <FavoriteToggle
          productId={product.id}
          productName={product.name}
          className="!h-8 !w-8"
        />
      </div>
    </div>
  );
}
