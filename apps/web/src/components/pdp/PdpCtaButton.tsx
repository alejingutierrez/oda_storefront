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
      className={`flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[13px] uppercase tracking-[0.2em] transition ${
        hasInStock
          ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)] hover:bg-[color:var(--oda-ink-soft)]"
          : "border border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)]"
      }`}
    >
      {hasInStock ? `Comprar en ${brandName}` : `Ver en ${brandName}`}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}
