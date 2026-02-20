"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import type { HomeProductCardData } from "@/lib/home-types";

export default function HomeHeroImmersive({ hero }: { hero: HomeProductCardData | null }) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const mediaY = useTransform(scrollYProgress, [0, 1], [0, 84]);
  const mediaScale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);

  return (
    <section
      ref={sectionRef}
      className="relative isolate min-h-[94svh] overflow-hidden border-b border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
    >
      <motion.div
        className="home-parallax-media absolute inset-0"
        style={
          prefersReducedMotion
            ? undefined
            : {
                y: mediaY,
                scale: mediaScale,
              }
        }
      >
        {hero?.imageCoverUrl ? (
          <Image
            src={hero.imageCoverUrl}
            alt={hero.name}
            fill
            priority
            sizes="100vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_28%_20%,rgba(217,195,160,0.46),transparent_55%),radial-gradient(circle_at_76%_8%,rgba(255,255,255,0.12),transparent_44%),linear-gradient(140deg,#151311,#1e1a16)]" />
        )}
      </motion.div>

      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(10,10,10,0.84)_10%,rgba(10,10,10,0.48)_48%,rgba(10,10,10,0.72)_100%)]" />

      <div className="oda-container relative flex min-h-[94svh] flex-col justify-end gap-8 py-14 sm:py-16 lg:py-20">
        <div className="max-w-[58rem] space-y-6">
          <p className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--oda-gold)]">ODA editorial</p>
          <h1 className="font-display text-5xl leading-[0.94] sm:text-7xl lg:text-[7.4rem]">
            Moda colombiana en una experiencia inmersiva.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/82 sm:text-base">
            Curaduria viva con rotacion determinista cada 3 dias. Descubre piezas de autor, categorias clave y
            combinaciones editoriales en un home pensado como revista digital.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 pb-2">
          <Link
            href="/buscar"
            className="rounded-full bg-[color:var(--oda-cream)] px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-white"
          >
            Explorar ahora
          </Link>
          <Link
            href="/unisex"
            className="rounded-full border border-white/55 px-6 py-3 text-[11px] uppercase tracking-[0.2em] text-white transition hover:border-white hover:bg-white/8"
          >
            Ver catalogo
          </Link>

          <div className="ml-auto hidden rounded-full border border-white/25 bg-black/20 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-white/80 md:block">
            Rotacion semilla 3 dias
          </div>
        </div>
      </div>
    </section>
  );
}
