"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { proxiedImageUrl } from "@/lib/image-proxy";

type Props = {
  images: string[];
  productName: string;
  productId: string;
};

export default function PdpGallery({ images, productName, productId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [zoomOrigin, setZoomOrigin] = useState<Record<number, string>>({});
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const [touchStart, setTouchStart] = useState<number | null>(null);

  // Deduplicate images
  const uniqueImages = useMemo(() => [...new Set(images)], [images]);

  // Resolve proxied URLs once
  const proxiedImages = useMemo(
    () =>
      uniqueImages
        .map((src) => proxiedImageUrl(src, { productId, kind: "gallery" }))
        .filter(Boolean) as string[],
    [uniqueImages, productId],
  );

  const markLoaded = useCallback((idx: number) => {
    setLoadedImages((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }, []);

  // IntersectionObserver for active dot (mobile)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Array.from(container.children).indexOf(
              entry.target as Element,
            );
            if (idx >= 0) setActiveIndex(idx);
          }
        }
      },
      { root: container, threshold: 0.6 },
    );
    Array.from(container.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [proxiedImages]);

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight")
        setLightboxIndex((prev) =>
          prev !== null ? Math.min(prev + 1, proxiedImages.length - 1) : null,
        );
      if (e.key === "ArrowLeft")
        setLightboxIndex((prev) =>
          prev !== null ? Math.max(prev - 1, 0) : null,
        );
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [lightboxIndex, proxiedImages.length]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, idx: number) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setZoomOrigin((prev) => ({ ...prev, [idx]: `${x}% ${y}%` }));
    },
    [],
  );

  // Lightbox touch swipe handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStart(e.touches[0]?.clientX ?? null);
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStart === null) return;
      const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStart;
      if (Math.abs(delta) > 50) {
        if (delta < 0 && lightboxIndex !== null) {
          setLightboxIndex(Math.min(lightboxIndex + 1, proxiedImages.length - 1));
        } else if (delta > 0 && lightboxIndex !== null) {
          setLightboxIndex(Math.max(lightboxIndex - 1, 0));
        }
      }
      setTouchStart(null);
    },
    [touchStart, lightboxIndex, proxiedImages.length],
  );

  if (proxiedImages.length === 0) {
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
      {/* Desktop: vertical image grid with zoom */}
      <div className="hidden lg:block">
        <div className="flex flex-col gap-2">
          {proxiedImages.map((proxied, i) => (
            <div
              key={`desktop-${proxied}-${i}`}
              className={`group relative w-full cursor-zoom-in overflow-hidden rounded-xl bg-[color:var(--oda-stone)] oda-shimmer ${
                i === 0 ? "aspect-[4/5]" : "aspect-[3/4]"
              }`}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() =>
                setZoomOrigin((prev) => {
                  const next = { ...prev };
                  delete next[i];
                  return next;
                })
              }
              onClick={() => setLightboxIndex(i)}
            >
              <Image
                src={proxied}
                alt={`${productName} - imagen ${i + 1}`}
                fill
                quality={72}
                sizes="(max-width: 1280px) 50vw, 45vw"
                className={`relative z-[1] object-cover transition-all duration-300 ease-out group-hover:scale-150 ${
                  loadedImages.has(i) ? "opacity-100" : "opacity-0"
                }`}
                style={
                  zoomOrigin[i]
                    ? { transformOrigin: zoomOrigin[i] }
                    : undefined
                }
                priority={i === 0}
                onLoad={() => markLoaded(i)}
              />
              {/* Magnifier overlay */}
              <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div className="rounded-full bg-black/30 p-3 backdrop-blur-sm">
                  <Search className="h-5 w-5 text-white" />
                </div>
              </div>
              {/* More photos indicator on first image */}
              {i === 0 && proxiedImages.length > 1 && (
                <span className="absolute bottom-3 right-3 z-[2] rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                  +{proxiedImages.length - 1} fotos
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: Horizontal carousel */}
      <div className="lg:hidden">
        <div className="relative">
          <div
            ref={scrollRef}
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto oda-no-scrollbar"
          >
            {proxiedImages.map((proxied, i) => (
              <div
                key={`mobile-${proxied}-${i}`}
                className={`relative shrink-0 snap-start cursor-zoom-in overflow-hidden rounded-xl bg-[color:var(--oda-stone)] oda-shimmer first:ml-0 ${
                  i === 0 ? "aspect-[4/5]" : "aspect-[3/4]"
                } w-[75vw] sm:w-[65vw]`}
                onClick={() => setLightboxIndex(i)}
              >
                <Image
                  src={proxied}
                  alt={`${productName} - imagen ${i + 1}`}
                  fill
                  quality={58}
                  sizes="75vw"
                  className={`relative z-[1] object-cover transition-opacity duration-500 ${
                    loadedImages.has(i) ? "opacity-100" : "opacity-0"
                  }`}
                  priority={i === 0}
                  onLoad={() => markLoaded(i)}
                />
              </div>
            ))}
          </div>

          {/* Image counter */}
          {proxiedImages.length > 1 && (
            <span className="absolute right-3 top-3 z-[2] rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
              {activeIndex + 1} / {proxiedImages.length}
            </span>
          )}
        </div>

        {/* Dot indicators with active state */}
        {proxiedImages.length > 1 && (
          <div className="mt-3 flex justify-center gap-1.5">
            {proxiedImages.map((_, i) => (
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
                className={`rounded-full bg-[color:var(--oda-taupe)] transition-all duration-300 ${
                  i === activeIndex
                    ? "h-1.5 w-2.5 opacity-100"
                    : "h-1.5 w-1.5 opacity-40 hover:opacity-70"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Close */}
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/20"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Prev */}
          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex - 1);
              }}
              className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/20"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Next */}
          {lightboxIndex < proxiedImages.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex + 1);
              }}
              className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/20"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          <div
            className="relative h-[90vh] w-[90vw] max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={proxiedImages[lightboxIndex]}
              alt={`${productName} - imagen ${lightboxIndex + 1}`}
              fill
              quality={90}
              sizes="90vw"
              className="object-contain"
              priority
            />
          </div>

          {/* Counter */}
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/60">
            {lightboxIndex + 1} / {proxiedImages.length}
          </span>
        </div>
      )}
    </>
  );
}
