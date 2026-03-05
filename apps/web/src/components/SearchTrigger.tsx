"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

const SearchOverlay = dynamic(() => import("@/components/SearchOverlay"), {
  ssr: false,
});

export function SearchTriggerDesktop() {
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 transition hover:bg-[color:var(--oda-stone)]"
      >
        <span className="w-[clamp(12rem,18vw,20rem)] text-left text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Buscar
        </span>
        <span className="rounded-full border border-[color:var(--oda-border)] bg-white px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
          Ir
        </span>
      </button>
      {open && <SearchOverlay open={open} onClose={handleClose} mode="desktop" />}
    </>
  );
}

export function SearchTriggerMobile({ onBeforeOpen }: { onBeforeOpen?: () => void }) {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    onBeforeOpen?.();
    setOpen(true);
  }, [onBeforeOpen]);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3"
        aria-label="Abrir busqueda"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          className="mr-3 text-[color:var(--oda-taupe)]"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="text-base uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
          Buscar
        </span>
      </button>
      {open && <SearchOverlay open={open} onClose={handleClose} mode="mobile" />}
    </>
  );
}
