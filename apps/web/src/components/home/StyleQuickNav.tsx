"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { StyleGroup } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

export default function StyleQuickNav({ styleGroups }: { styleGroups: StyleGroup[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (styleGroups.length === 0) return null;

  return (
    <section className="border-b border-[color:var(--oda-border)] bg-white/80 backdrop-blur-md">
      <div className="oda-container py-4">
        <div
          ref={scrollRef}
          data-dragging={isDragging ? "true" : "false"}
          className="home-hide-scroll home-drag-scroll flex items-center gap-3 overflow-x-auto"
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse") return;
            const node = scrollRef.current;
            if (!node) return;
            dragState.current = { startX: event.clientX, startScrollLeft: node.scrollLeft };
            setIsDragging(true);
          }}
          onPointerMove={(event) => {
            const node = scrollRef.current;
            const drag = dragState.current;
            if (!node || !drag) return;
            node.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
          }}
          onPointerUp={() => { dragState.current = null; setIsDragging(false); }}
          onPointerCancel={() => { dragState.current = null; setIsDragging(false); }}
          onPointerLeave={() => { dragState.current = null; setIsDragging(false); }}
        >
          <span className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
            Tu estilo
          </span>

          {styleGroups.map((group) => {
            const coverProduct = group.products[0];
            const thumbSrc = coverProduct
              ? proxiedImageUrl(coverProduct.imageCoverUrl, { productId: coverProduct.id, kind: "cover" })
              : null;

            return (
              <Link
                key={group.styleKey}
                href={`/estilo/${encodeURIComponent(group.styleKey)}`}
                prefetch={false}
                className="group flex shrink-0 items-center gap-2.5 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-1.5 py-1.5 pr-4 transition hover:border-[color:var(--oda-ink-soft)] hover:shadow-sm"
              >
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[color:var(--oda-stone)]">
                  {thumbSrc ? (
                    <Image
                      src={thumbSrc}
                      alt=""
                      fill
                      quality={50}
                      sizes="32px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <span className="text-[11px] font-medium tracking-wide text-[color:var(--oda-ink)] group-hover:text-[color:var(--oda-ink)]">
                  {group.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
