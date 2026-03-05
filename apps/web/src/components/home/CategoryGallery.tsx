"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CategoryHighlight } from "@/lib/home-types";
import { proxiedImageUrl } from "@/lib/image-proxy";

export default function CategoryGallery({ categories }: { categories: CategoryHighlight[] }) {
  const hasCategories = categories.length > 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const scrollByRail = (direction: -1 | 1) => {
    const node = scrollRef.current;
    if (!node) return;
    const amount = Math.max(node.clientWidth * 0.86, 320);
    node.scrollBy({ left: amount * direction, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Comprar</p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Compra por categoría</h2>
        </div>

        {hasCategories ? (
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => scrollByRail(-1)}
              className="rounded-full border border-[color:var(--oda-border)] bg-white p-2 text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              aria-label="Desplazar categorías a la izquierda"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => scrollByRail(1)}
              className="rounded-full border border-[color:var(--oda-border)] bg-white p-2 text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
              aria-label="Desplazar categorías a la derecha"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        ) : null}
      </div>

      {hasCategories ? (
        <div
          ref={scrollRef}
          role="region"
          aria-label="Carrusel de categorías clave"
          tabIndex={0}
          data-dragging={isDragging ? "true" : "false"}
          className="home-hide-scroll home-drag-scroll overflow-x-auto pb-2"
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse") return;
            const node = scrollRef.current;
            if (!node) return;
            dragState.current = {
              startX: event.clientX,
              startScrollLeft: node.scrollLeft,
            };
            setIsDragging(true);
          }}
          onPointerMove={(event) => {
            const node = scrollRef.current;
            const drag = dragState.current;
            if (!node || !drag) return;
            const delta = event.clientX - drag.startX;
            node.scrollLeft = drag.startScrollLeft - delta;
          }}
          onPointerUp={() => {
            dragState.current = null;
            setIsDragging(false);
          }}
          onPointerCancel={() => {
            dragState.current = null;
            setIsDragging(false);
          }}
          onPointerLeave={() => {
            dragState.current = null;
            setIsDragging(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              scrollByRail(1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              scrollByRail(-1);
            }
          }}
        >
          <div className="grid grid-flow-col grid-rows-1 gap-4 pb-2 pr-6 md:auto-cols-[210px] md:grid-rows-2 lg:auto-cols-[225px]">
            {categories.map((category) => {
              const imageSrc = proxiedImageUrl(category.imageCoverUrl, { kind: "cover" });
              return (
                <Link
                  key={`${category.category}-${category.href}`}
                  href={category.href}
                  prefetch={false}
                  className="group relative min-w-[56vw] overflow-hidden rounded-[1.15rem] bg-[color:var(--oda-stone)] sm:min-w-[38vw] md:min-w-0"
                >
                  <div className="relative h-[155px] w-full md:h-[145px] lg:h-[156px]">
                    {imageSrc ? (
                      <Image
                        src={imageSrc}
                        alt={category.label}
                        fill
                        quality={58}
                        sizes="(max-width: 768px) 58vw, (max-width: 1280px) 210px, 225px"
                        className="object-cover saturate-[0.72] transition duration-700 ease-out group-hover:scale-[1.04] group-hover:saturate-100 group-focus-visible:scale-[1.04] group-focus-visible:saturate-100"
                      />
                    ) : null}
                  </div>
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.68),rgba(0,0,0,0.14),rgba(0,0,0,0))]" />
                  <div className="absolute inset-x-4 bottom-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/72">Categoría</p>
                    <p className="mt-1 text-lg leading-tight text-white sm:text-xl">{category.label}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Actualizando</p>
          <h3 className="mt-3 font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
            Estamos cargando más categorías.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            Mientras terminamos de actualizar esta sección, puedes explorar más productos y seguir comprando por estilo.
          </p>
          <Link
            href="/catalogo"
            prefetch={false}
            className="mt-6 inline-flex rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)] transition hover:bg-[color:var(--oda-ink-soft)]"
          >
            Ver todo el catálogo
          </Link>
        </div>
      )}
    </div>
  );
}
