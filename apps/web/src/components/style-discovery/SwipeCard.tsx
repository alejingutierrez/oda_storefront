"use client";

import { useState } from "react";
import Image from "next/image";
import type { SwipeItem } from "@/lib/style-engine/types";
import { proxiedImageUrl } from "@/lib/image-proxy";

type SwipeCardProps = {
  product: SwipeItem;
  /** Horizontal offset in px, used for feedback label opacity. */
  offsetX?: number;
  style?: React.CSSProperties;
  className?: string;
};

/** Format a realStyle key into a readable label. */
function formatStyleLabel(style: string | null): string {
  if (!style) return "";
  return style
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function SwipeCard({
  product,
  offsetX = 0,
  style,
  className = "",
}: SwipeCardProps) {
  const [imgError, setImgError] = useState(false);
  const likeOpacity = Math.min(1, Math.max(0, offsetX / 150));
  const dislikeOpacity = Math.min(1, Math.max(0, -offsetX / 150));

  const imageSrc = proxiedImageUrl(product.imageCoverUrl, {
    productId: product.id,
    kind: "cover",
  });

  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-2xl bg-[color:var(--oda-stone)] shadow-[var(--shadow-elevated,0_12px_40px_rgba(42,37,32,0.1))] ${className}`}
      style={style}
    >
      {/* Product image */}
      <div className="relative h-full w-full">
        {imageSrc && !imgError ? (
          <Image
            src={imageSrc}
            alt={product.name}
            fill
            quality={75}
            sizes="(max-width: 640px) 340px, 440px"
            className="object-cover"
            priority
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[color:var(--oda-stone)]">
            <span className="text-xs text-[color:var(--oda-taupe)]">
              Sin imagen
            </span>
          </div>
        )}

        {/* Like feedback label */}
        {likeOpacity > 0 && (
          <div
            className="absolute left-6 top-8 rounded-lg border-2 border-[color:var(--oda-gold)] px-4 py-2 text-lg font-bold text-[color:var(--oda-gold)]"
            style={{
              opacity: likeOpacity,
              transform: `rotate(-12deg)`,
            }}
          >
            ME GUSTA
          </div>
        )}

        {/* Dislike feedback label */}
        {dislikeOpacity > 0 && (
          <div
            className="absolute right-6 top-8 rounded-lg border-2 border-[color:var(--oda-love)] px-4 py-2 text-lg font-bold text-[color:var(--oda-love)]"
            style={{
              opacity: dislikeOpacity,
              transform: `rotate(12deg)`,
            }}
          >
            PASO
          </div>
        )}

        {/* Bottom info overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[color:var(--oda-ink)]/80 to-transparent px-5 pb-5 pt-16">
          {product.realStyle && (
            <span className="mb-2 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {formatStyleLabel(product.realStyle)}
            </span>
          )}
          <h3 className="text-lg font-semibold leading-tight text-white">
            {product.name}
          </h3>
          <p className="mt-0.5 text-sm text-white/70">{product.brandName}</p>
        </div>
      </div>
    </div>
  );
}
