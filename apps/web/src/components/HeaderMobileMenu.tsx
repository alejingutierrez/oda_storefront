"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import AccountLink from "@/components/AccountLink";
import type { MegaMenuData } from "@/lib/home-types";
import { logExperienceEvent } from "@/lib/experience-events";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];
type MenuSectionKey = "Superiores" | "Completos" | "Inferiores" | "Accesorios" | "Lifestyle";
const MENU_SECTIONS: MenuSectionKey[] = ["Superiores", "Completos", "Inferiores", "Accesorios", "Lifestyle"];
const SECTION_LABELS: Record<MenuSectionKey, string> = {
  Superiores: "Superiores",
  Completos: "Completos y vestidos",
  Inferiores: "Inferiores",
  Accesorios: "Accesorios",
  Lifestyle: "Íntimo y descanso",
};

export default function HeaderMobileMenu({ menu }: { menu: MegaMenuData }) {
  const [open, setOpen] = useState(false);
  const [activeGender, setActiveGender] = useState<GenderKey>("Femenino");

  const portalRoot = typeof document !== "undefined" ? document.body : null;
  const genderMenu = menu[activeGender];

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  // Scroll lock + Escape key
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, open]);

  // Log menu open
  useEffect(() => {
    if (!open) return;
    logExperienceEvent({
      type: "menu_open",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        surface: "mobile",
        gender: activeGender,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleGenderSwitch = (gender: GenderKey) => {
    const prev = activeGender;
    setActiveGender(gender);
    if (prev !== gender) {
      logExperienceEvent({
        type: "menu_gender_switch",
        path: `${window.location.pathname}${window.location.search}`,
        properties: { surface: "mobile", from: prev, to: gender },
      });
    }
  };

  const handleItemClick = useCallback(
    (href: string, label: string, meta?: Record<string, unknown>) => {
      logExperienceEvent({
        type: "menu_item_click",
        path: `${window.location.pathname}${window.location.search}`,
        properties: { surface: "mobile", href, label, ...meta },
      });
      window.requestAnimationFrame(() => closeMenu());
    },
    [closeMenu],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Abrir menu"
      >
        Menu
        <span className="inline-flex h-8 w-8 items-center justify-center text-[color:var(--oda-taupe)]" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[200] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu principal">
              {/* Backdrop */}
              <button
                type="button"
                className="absolute inset-0 bg-black/30 backdrop-blur-lg backdrop-saturate-150"
                aria-label="Cerrar menu"
                onClick={closeMenu}
              />

              {/* Panel */}
              <div className="oda-glass-noise absolute inset-x-3 bottom-5 top-20 flex flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/90 shadow-[0_30px_90px_rgba(23,21,19,0.30)] backdrop-blur-2xl">

                {/* Header fijo */}
                <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--oda-border)]/60 px-5 py-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    Explorar
                  </span>
                  <button
                    type="button"
                    onClick={closeMenu}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-base font-medium text-[color:var(--oda-ink)]"
                    aria-label="Cerrar"
                  >
                    ×
                  </button>
                </div>

                {/* Tabs de género */}
                <div className="shrink-0 overflow-x-auto border-b border-[color:var(--oda-border)]/60 px-4 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex gap-2">
                    {GENDERS.map((gender) => (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => handleGenderSwitch(gender)}
                        aria-pressed={activeGender === gender}
                        className={[
                          "shrink-0 rounded-full px-4 py-2 text-[10px] font-medium uppercase tracking-[0.18em] transition-all",
                          activeGender === gender
                            ? "bg-[color:var(--oda-ink)] text-white"
                            : "border border-[color:var(--oda-border)] bg-white/70 text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                        ].join(" ")}
                      >
                        {gender}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contenido scrollable */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-5">

                  {/* Quick links */}
                  <div className="mb-6 flex flex-wrap gap-2">
                    <Link
                      prefetch={false}
                      href="/novedades"
                      className="inline-flex min-h-9 items-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                      onClick={() => handleItemClick("/novedades", "Novedades", { gender: activeGender })}
                    >
                      Novedades
                    </Link>
                    <Link
                      prefetch={false}
                      href={`/${GENDER_ROUTE[activeGender]}`}
                      className="inline-flex min-h-9 items-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                      onClick={() =>
                        handleItemClick(
                          `/${GENDER_ROUTE[activeGender]}`,
                          `Ver todo ${activeGender}`,
                          { gender: activeGender },
                        )
                      }
                    >
                      Ver todo {activeGender}
                    </Link>
                    <Link
                      prefetch={false}
                      href="/buscar"
                      className="inline-flex min-h-9 items-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                      onClick={() => handleItemClick("/buscar", "Buscar", { gender: activeGender })}
                    >
                      Buscar
                    </Link>
                  </div>

                  {/* Secciones con categorías */}
                  {MENU_SECTIONS.map((section) => {
                    const items = genderMenu[section];
                    if (items.length === 0) return null;
                    return (
                      <div key={section} className="mb-7">
                        <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                          {SECTION_LABELS[section]}
                        </p>
                        <div className="flex flex-col">
                          {items.map((item, idx) => (
                            <Link
                              key={item.key}
                              prefetch={false}
                              href={item.href}
                              className={[
                                "inline-flex min-h-11 items-center py-2.5 text-sm font-medium text-[color:var(--oda-ink)]",
                                idx < items.length - 1
                                  ? "border-b border-[color:var(--oda-border)]/50"
                                  : "",
                              ].join(" ")}
                              onClick={() =>
                                handleItemClick(item.href, item.label, {
                                  gender: activeGender,
                                  section,
                                })
                              }
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Cuenta */}
                  <div className="mt-6 flex items-center justify-between border-t border-[color:var(--oda-border)]/50 pt-5 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                    <span>Cuenta</span>
                    <AccountLink className="rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2" />
                  </div>
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
