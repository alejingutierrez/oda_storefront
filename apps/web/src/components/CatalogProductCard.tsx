"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog-data";
import FavoriteToggle from "@/components/FavoriteToggle";
import { useCompare } from "@/components/CompareProvider";
import { proxiedImageUrl } from "@/lib/image-proxy";

const IMAGE_BLUR_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs=";

function uniqStrings(values: Array<string | null | undefined>) {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

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

function CompareIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3H5a2 2 0 0 0-2 2v5" />
      <path d="M14 21h5a2 2 0 0 0 2-2v-5" />
      <path d="M21 10V5a2 2 0 0 0-2-2h-5" />
      <path d="M3 14v5a2 2 0 0 0 2 2h5" />
      <path d="M8 12h8" />
      <path d="M12 8v8" opacity={active ? 1 : 0.45} />
    </svg>
  );
}

export default function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const compare = useCompare();
  const href = product.sourceUrl ?? "#";
  const coverUrl = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });
  // Vercel/Next bloquea optimizacion de `next/image` cuando el src es un endpoint `/api/*` (INVALID_IMAGE_OPTIMIZE_REQUEST).
  const [images, setImages] = useState<string[]>(() => (coverUrl ? [coverUrl] : []));
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const extrasLoadingRef = useRef(false);

  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setImages(coverUrl ? [coverUrl] : []);
    setActiveIndex(0);
    setExtrasLoaded(false);
    extrasLoadingRef.current = false;
  }, [coverUrl]);

  const ensureExtras = useCallback(async () => {
    if (extrasLoaded) return;
    if (extrasLoadingRef.current) return;
    extrasLoadingRef.current = true;
    try {
      const res = await fetch(`/api/catalog/product-images?productId=${encodeURIComponent(product.id)}`, {
        cache: "force-cache",
      });
      if (!res.ok) return;
      const payload = (await res.json()) as { images?: string[] };
      const nextImages = Array.isArray(payload.images) ? payload.images : [];
      const proxied = nextImages.map((url) =>
        proxiedImageUrl(url, { productId: product.id, kind: "gallery" }),
      );
      setImages((prev) => {
        const merged = uniqStrings([...prev, ...proxied]);
        return merged;
      });
      setExtrasLoaded(true);
    } catch {
      // ignore
    } finally {
      extrasLoadingRef.current = false;
    }
  }, [extrasLoaded, product.id]);

  const startTimeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stopCarousel = useCallback(() => {
    if (startTimeoutRef.current) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setActiveIndex(0);
  }, []);

  const beginCarousel = useCallback(async () => {
    await ensureExtras();
    const list = imagesRef.current;
    if (list.length <= 1) return;

    setActiveIndex((current) => {
      if (current === 0 && list.length > 1) return 1;
      return current;
    });

    if (intervalRef.current) return;
    intervalRef.current = window.setInterval(() => {
      const latest = imagesRef.current;
      if (latest.length <= 1) return;
      setActiveIndex((current) => {
        const next = current + 1;
        return next >= latest.length ? 0 : next;
      });
    }, 2000);
  }, [ensureExtras]);

  const scheduleCarousel = useCallback(() => {
    if (intervalRef.current) return;
    if (startTimeoutRef.current) return;
    startTimeoutRef.current = window.setTimeout(() => {
      startTimeoutRef.current = null;
      void beginCarousel();
    }, 2000);
  }, [beginCarousel]);

  const viewRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (canHover) return;
    const node = viewRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.82;
        if (visible) {
          scheduleCarousel();
        } else {
          stopCarousel();
        }
      },
      { threshold: [0, 0.82, 1] },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      stopCarousel();
    };
  }, [canHover, scheduleCarousel, stopCarousel]);

  useEffect(() => {
    return () => stopCarousel();
  }, [stopCarousel]);

  const activeImageUrl = images[activeIndex] ?? coverUrl ?? null;
  const unoptimized = !!activeImageUrl && activeImageUrl.startsWith("/api/image-proxy");

  const priceLabel = useMemo(
    () => formatPriceRange(product.minPrice, product.maxPrice, product.currency),
    [product.currency, product.maxPrice, product.minPrice],
  );

  const compared = compare?.isSelected(product.id) ?? false;

  return (
    <article
      className="group relative overflow-hidden rounded-xl border border-[color:var(--oda-border)] bg-white shadow-[0_12px_28px_rgba(23,21,19,0.08)] lg:transition lg:duration-500 lg:ease-out lg:[transform-style:preserve-3d] lg:hover:shadow-[0_30px_60px_rgba(23,21,19,0.14)] lg:group-hover:[transform:perspective(900px)_rotateX(6deg)_translateY(-10px)]"
      onMouseEnter={() => {
        if (canHover) scheduleCarousel();
      }}
      onMouseLeave={() => {
        if (canHover) stopCarousel();
      }}
    >
      {compare ? (
        <div className="absolute left-3 top-3 z-10">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              compare.toggle(product);
            }}
            aria-pressed={compared}
            aria-label={compared ? "Quitar de comparar" : "Agregar a comparar"}
            className={[
              "inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 shadow-[0_18px_50px_rgba(23,21,19,0.16)] backdrop-blur transition lg:h-10 lg:w-10",
              compared
                ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                : "bg-white/70 text-[color:var(--oda-ink)] hover:bg-white",
            ].join(" ")}
            title={compared ? "Quitar de comparar" : "Comparar"}
          >
            <CompareIcon active={compared} />
          </button>
        </div>
      ) : null}
      <div className="absolute right-3 top-3 z-10">
        <FavoriteToggle
          productId={product.id}
          ariaLabel={`Guardar ${product.name} en favoritos`}
          className="h-9 w-9 lg:h-10 lg:w-10"
        />
      </div>
      <Link
        href={href}
        ref={viewRef}
        className="relative block aspect-[3/4] w-full overflow-hidden bg-[color:var(--oda-stone)]"
      >
        {activeImageUrl ? (
          <Image
            src={activeImageUrl}
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

        {/* Mobile: siempre visible (bottom glass). Desktop: aparece al hover desde abajo. */}
        <div
          className={[
            "absolute inset-x-0 bottom-0 h-[22%] border-t border-white/40 bg-white/45 backdrop-blur-xl",
            "transition duration-500",
            "lg:h-[26%] lg:translate-y-6 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100",
          ].join(" ")}
        >
          <div className="flex h-full flex-col justify-start gap-1.5 px-3 py-2.5 lg:px-4 lg:py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-[color:var(--oda-ink-soft)] lg:text-[10px]">
              {product.brandName}
            </p>
            <h3 className="truncate text-[13px] font-semibold leading-snug text-[color:var(--oda-ink)] lg:text-sm">
              {product.name}
            </h3>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] lg:text-xs">
              {priceLabel}
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}
