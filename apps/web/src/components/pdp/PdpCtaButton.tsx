"use client";

import { ExternalLink } from "lucide-react";
import { logExperienceEvent } from "@/lib/experience-events";

type Props = {
  sourceUrl: string | null;
  brandName: string;
  productId: string;
  hasInStock: boolean;
};

export default function PdpCtaButton({
  sourceUrl,
  brandName,
  productId,
  hasInStock,
}: Props) {
  if (!sourceUrl) return null;

  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        logExperienceEvent({
          type: "pdp_buy_click",
          productId,
          path: typeof window !== "undefined" ? window.location.pathname : "/",
          properties: { surface: "pdp_cta" },
        });
      }}
      className={`group flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[13px] uppercase tracking-[0.2em] transition-all duration-300 ${
        hasInStock
          ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)] hover:bg-[color:var(--oda-cream)] hover:text-[color:var(--oda-ink)] hover:ring-1 hover:ring-[color:var(--oda-ink)]"
          : "border border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)]"
      }`}
    >
      {hasInStock ? `Comprar en ${brandName}` : `Ver en ${brandName}`}
      <ExternalLink className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  );
}
