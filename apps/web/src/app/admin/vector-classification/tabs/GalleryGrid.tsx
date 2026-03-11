"use client";

import Image from "next/image";
import type { ReactNode } from "react";

export type GalleryProduct = {
  id: string;
  name: string;
  brandName: string | null;
  imageCoverUrl: string | null;
};

export default function GalleryGrid<T extends GalleryProduct>({
  products,
  selected,
  busy,
  onToggleSelect,
  renderOverlay,
  renderBadge,
}: {
  products: T[];
  selected: Set<string>;
  busy: boolean;
  onToggleSelect: (id: string) => void;
  renderOverlay?: (product: T) => ReactNode;
  renderBadge?: (product: T) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-8">
      {products.map((product) => {
        const isSelected = selected.has(product.id);

        return (
          <button
            key={product.id}
            type="button"
            onClick={() => onToggleSelect(product.id)}
            disabled={busy}
            title={`${product.name}\n${product.brandName || "Sin marca"}`}
            className={`group relative overflow-hidden rounded-lg border-2 transition-all disabled:opacity-60 [content-visibility:auto] [contain-intrinsic-size:auto_173px] ${
              isSelected
                ? "border-indigo-500 ring-2 ring-indigo-200"
                : "border-transparent hover:border-slate-300"
            }`}
          >
            {product.imageCoverUrl ? (
              <div className="relative aspect-[3/4] w-full">
                <Image
                  src={product.imageCoverUrl}
                  alt={product.name}
                  fill
                  quality={56}
                  sizes="(min-width: 768px) 13vw, 33vw"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-[3/4] w-full items-center justify-center bg-slate-100 text-[9px] text-slate-400">
                Sin img
              </div>
            )}

            {/* Custom overlay (e.g., assigned gender/style) */}
            {renderOverlay?.(product)}

            {/* Custom badge (e.g., suggestion indicator) */}
            {renderBadge?.(product)}

            {/* Selected indicator */}
            {isSelected && (
              <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}

            {/* Hover tooltip with name */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
              <p className="truncate text-[10px] leading-tight text-white">{product.name}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
