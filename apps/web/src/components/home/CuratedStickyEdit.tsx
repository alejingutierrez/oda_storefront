"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import HomeProductCard from "@/components/home/HomeProductCard";
import type { StyleGroup } from "@/lib/home-types";

export default function CuratedStickyEdit({ styleGroups }: { styleGroups: StyleGroup[] }) {
  const groups = useMemo(() => styleGroups.filter((group) => group.products.length > 0), [styleGroups]);
  const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (groups.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let nextActive = activeIndex;
        let bestRatio = 0;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const ratio = entry.intersectionRatio;
          const index = Number((entry.target as HTMLElement).dataset.groupIndex ?? -1);
          if (index < 0) continue;
          if (ratio >= bestRatio) {
            bestRatio = ratio;
            nextActive = index;
          }
        }

        if (nextActive !== activeIndex) {
          setActiveIndex(nextActive);
        }
      },
      {
        rootMargin: "-28% 0px -38% 0px",
        threshold: [0.2, 0.35, 0.55, 0.75],
      }
    );

    sectionRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [activeIndex, groups.length]);

  if (groups.length === 0) {
    return null;
  }

  const safeIndex = Math.min(activeIndex, groups.length - 1);
  const activeGroup = groups[safeIndex];
  const activeImage = activeGroup.products[0]?.imageCoverUrl;

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Estilo</p>
          <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Curated edit</h2>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:gap-10">
        <div className="lg:hidden">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[1.35rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]">
            {activeImage ? (
              <Image
                src={activeImage}
                alt={activeGroup.label}
                fill
                sizes="100vw"
                className="object-cover"
                unoptimized
              />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.56),rgba(0,0,0,0.08),rgba(0,0,0,0))]" />
            <div className="absolute bottom-5 left-5 right-5 text-white">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/78">Edit activo</p>
              <p className="mt-2 font-display text-2xl">{activeGroup.label}</p>
            </div>
          </div>
        </div>

        <div className="relative hidden lg:block">
          <div className="sticky top-[calc(var(--oda-header-h)+1rem)]">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[1.6rem] border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] shadow-[0_24px_70px_rgba(23,21,19,0.18)]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeGroup.styleKey}
                  className="absolute inset-0"
                  initial={prefersReducedMotion ? false : { opacity: 0, scale: 1.03 }}
                  animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
                >
                  {activeImage ? (
                    <Image
                      src={activeImage}
                      alt={activeGroup.label}
                      fill
                      sizes="(max-width: 1280px) 45vw, 36vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.68),rgba(0,0,0,0.14),rgba(0,0,0,0))]" />
                  <div className="absolute bottom-8 left-8 right-8 text-white">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/78">Curated edit</p>
                    <p className="mt-2 font-display text-4xl leading-none">{activeGroup.label}</p>
                    <p className="mt-3 text-sm text-white/82">Scroll para descubrir productos del look.</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-12 lg:gap-14">
          {groups.map((group, index) => (
            <div
              key={group.styleKey}
              ref={(node) => {
                sectionRefs.current[index] = node;
              }}
              data-group-index={index}
              className="flex flex-col gap-5 border-t border-[color:var(--oda-border)] pt-6"
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-3xl leading-none text-[color:var(--oda-ink)]">{group.label}</h3>
                <Link
                  href={`/estilo/${encodeURIComponent(group.styleKey)}`}
                  className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]"
                >
                  Ver estilo
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {group.products.map((product) => (
                  <HomeProductCard
                    key={`${group.styleKey}-${product.id}`}
                    product={product}
                    sizes="(max-width: 640px) 70vw, (max-width: 1024px) 44vw, 24vw"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
