"use client";

import { useRef } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/image-proxy";

type Props = {
  images: string[];
  productName: string;
  productId: string;
};

export default function PdpGallery({ images, productName, productId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-2xl bg-[color:var(--oda-stone)]">
        <span className="text-sm uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Sin imagen
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: Vertical image grid */}
      <div className="hidden flex-col gap-2 lg:flex">
        {images.map((src, i) => {
          const proxied = proxiedImageUrl(src, {
            productId,
            kind: "gallery",
          });
          if (!proxied) return null;
          return (
            <div
              key={`${src}-${i}`}
              className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[color:var(--oda-stone)]"
            >
              <Image
                src={proxied}
                alt={`${productName} - imagen ${i + 1}`}
                fill
                quality={72}
                sizes="(max-width: 1280px) 55vw, 50vw"
                className="object-cover"
                priority={i === 0}
              />
            </div>
          );
        })}
      </div>

      {/* Mobile: Horizontal carousel */}
      <div className="lg:hidden">
        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto oda-no-scrollbar"
        >
          {images.map((src, i) => {
            const proxied = proxiedImageUrl(src, {
              productId,
              kind: "gallery",
            });
            if (!proxied) return null;
            return (
              <div
                key={`${src}-${i}`}
                className="relative aspect-[3/4] w-[85vw] shrink-0 snap-start overflow-hidden rounded-xl bg-[color:var(--oda-stone)] first:ml-0 sm:w-[70vw]"
              >
                <Image
                  src={proxied}
                  alt={`${productName} - imagen ${i + 1}`}
                  fill
                  quality={58}
                  sizes="85vw"
                  className="object-cover"
                  priority={i === 0}
                />
              </div>
            );
          })}
        </div>

        {/* Dot indicators */}
        {images.length > 1 && (
          <div className="mt-3 flex justify-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Imagen ${i + 1}`}
                onClick={() => {
                  scrollRef.current?.children[i]?.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "start",
                  });
                }}
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--oda-taupe)] opacity-40 transition hover:opacity-100"
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
