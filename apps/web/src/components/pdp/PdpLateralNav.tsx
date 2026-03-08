"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { readPdpNavContext } from "@/lib/pdp-nav-context";

type NavState = {
  prevHref: string | null;
  nextHref: string | null;
  label: string;
  position: string;
};

type Props = {
  productId: string;
};

export default function PdpLateralNav({ productId }: Props) {
  const [nav, setNav] = useState<NavState | null>(null);

  useEffect(() => {
    const ctx = readPdpNavContext(productId);
    if (!ctx) return;

    const { productIds, currentIndex, label } = ctx;
    const prevId = currentIndex > 0 ? productIds[currentIndex - 1] : null;
    const nextId =
      currentIndex < productIds.length - 1
        ? productIds[currentIndex + 1]
        : null;

    if (!prevId && !nextId) return;

    const ids = [prevId, nextId].filter(Boolean) as string[];
    fetch(`/api/catalog/product-hrefs?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        setNav({
          prevHref: prevId ? (data[prevId] ?? null) : null,
          nextHref: nextId ? (data[nextId] ?? null) : null,
          label,
          position: `${currentIndex + 1} de ${productIds.length}`,
        });
      })
      .catch(() => {});
  }, [productId]);

  if (!nav) return null;

  return (
    <nav
      aria-label="Navegación entre productos"
      className="mb-3 hidden items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] lg:flex"
    >
      {nav.prevHref ? (
        <Link
          href={nav.prevHref}
          prefetch
          className="flex items-center gap-1 transition hover:text-[color:var(--oda-ink)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </Link>
      ) : (
        <span className="flex items-center gap-1 opacity-30">
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </span>
      )}

      <span className="text-[color:var(--oda-ink-soft)]">{nav.position}</span>

      {nav.nextHref ? (
        <Link
          href={nav.nextHref}
          prefetch
          className="flex items-center gap-1 transition hover:text-[color:var(--oda-ink)]"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className="flex items-center gap-1 opacity-30">
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </nav>
  );
}
