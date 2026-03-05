"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Share2, Link2, Check, X } from "lucide-react";

type Props = {
  productName: string;
  brandName: string;
};

export default function PdpShareMenu({ productName, brandName }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const getShareUrl = useCallback(() => {
    return typeof window !== "undefined" ? window.location.href : "";
  }, []);

  const handleShare = useCallback(async () => {
    const url = getShareUrl();
    const shareData = {
      title: `${productName} — ${brandName}`,
      text: `${productName} de ${brandName} en ODA`,
      url,
    };

    // Mobile: try native share first
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // User cancelled or share failed — fall through to popover
      }
    }

    // Desktop: show popover
    setIsOpen((prev) => !prev);
  }, [productName, brandName, getShareUrl]);

  const handleCopyLink = useCallback(async () => {
    const url = getShareUrl();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setIsOpen(false);
      }, 1500);
    }
  }, [getShareUrl]);

  const handleWhatsApp = useCallback(() => {
    const url = getShareUrl();
    const text = `${productName} de ${brandName} en ODA — ${url}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setIsOpen(false);
  }, [productName, brandName, getShareUrl]);

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={handleShare}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] transition hover:border-[color:var(--oda-ink)] hover:text-[color:var(--oda-ink)]"
        aria-label="Compartir"
        title="Compartir"
      >
        <Share2 className="h-4 w-4" />
      </button>

      {/* Popover (desktop only — mobile uses native share) */}
      {isOpen && (
        <div className="absolute right-0 bottom-full mb-2 z-50 w-52 rounded-xl border border-[color:var(--oda-border)] bg-white shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[color:var(--oda-border)] px-3 py-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
              Compartir
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Options */}
          <div className="p-1.5">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Link2 className="h-4 w-4 text-[color:var(--oda-taupe)]" />
              )}
              {copied ? "Copiado" : "Copiar enlace"}
            </button>

            <button
              type="button"
              onClick={handleWhatsApp}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
            >
              <svg
                className="h-4 w-4 text-[color:var(--oda-taupe)]"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
