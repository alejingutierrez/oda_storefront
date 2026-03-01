"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [activeGender, setActiveGender] = useState<GenderKey | null>(null);
  const lastStepRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const portalRoot = typeof document !== "undefined" ? document.body : null;

  const genderSections = useMemo(() => {
    if (!activeGender) return null;
    const data = menu[activeGender];
    return MENU_SECTIONS
      .map((key) => ({
        key,
        label: SECTION_LABELS[key],
        items: data[key],
      }))
      .filter((section) => section.items.length > 0);
  }, [activeGender, menu]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveGender(null);
  }, []);

  useEffect(() => {
    if (activeGender && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeGender]);

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

  useEffect(() => {
    if (!open) {
      lastStepRef.current = null;
      return;
    }
    logExperienceEvent({
      type: "menu_open",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        surface: "mobile",
      },
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const stepKey = `${activeGender ?? "root"}`;
    if (lastStepRef.current === stepKey) return;
    logExperienceEvent({
      type: "menu_mobile_step",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        level: activeGender ? "gender" : "root",
        gender: activeGender,
      },
    });
    lastStepRef.current = stepKey;
  }, [activeGender, open]);

  const handleItemClick = useCallback(
    (href: string, label: string, meta?: Record<string, unknown>) => {
      logExperienceEvent({
        type: "menu_item_click",
        path: `${window.location.pathname}${window.location.search}`,
        properties: {
          surface: "mobile",
          href,
          label,
          ...meta,
        },
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
              <button
                type="button"
                className="absolute inset-0 bg-black/30 backdrop-blur-lg backdrop-saturate-150"
                aria-label="Cerrar menu"
                onClick={closeMenu}
              />

              <div className="oda-glass-noise absolute inset-x-4 bottom-6 top-24 flex flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/85 shadow-[0_30px_90px_rgba(23,21,19,0.30)] backdrop-blur-2xl">
                {/* Panel header */}
                <div className="shrink-0 flex items-center justify-between gap-3 border-b border-white/40 bg-white/75 px-5 py-4 backdrop-blur-xl">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    Explorar
                  </span>
                  <button
                    type="button"
                    onClick={closeMenu}
                    className="inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-sm font-semibold text-[color:var(--oda-ink)]"
                    aria-label="Cerrar"
                    title="Cerrar"
                  >
                    ×
                  </button>
                </div>

                {/* Scrollable content */}
                <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain">
                  <div className="px-5 pb-8 pt-5">
                    {/* Search input */}
                    <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3">
                      <input
                        type="text"
                        placeholder="Buscar"
                        // iOS: >= 16px evita el zoom automático al focus.
                        className="w-full bg-transparent text-base uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
                      />
                    </div>

                    {/* Quick links */}
                    <div className="mt-6 grid grid-cols-3 gap-2">
                      <Link
                        prefetch={false}
                        href="/novedades"
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                        onClick={() => handleItemClick("/novedades", "Novedades", { level: "root" })}
                      >
                        Novedades
                      </Link>
                      <Link
                        prefetch={false}
                        href="/buscar"
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                        onClick={() => handleItemClick("/buscar", "Buscar", { level: "root" })}
                      >
                        Buscar
                      </Link>
                      <Link
                        prefetch={false}
                        href="/catalogo"
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                        onClick={() => handleItemClick("/catalogo", "Ver todo", { level: "root" })}
                      >
                        Ver todo
                      </Link>
                    </div>

                    {/* Gender tabs */}
                    <div className="mt-6 grid grid-cols-2 gap-2" role="tablist" aria-label="Filtrar por genero">
                      {GENDERS.map((gender) => (
                        <button
                          key={gender}
                          type="button"
                          role="tab"
                          aria-selected={activeGender === gender}
                          onClick={() => setActiveGender(activeGender === gender ? null : gender)}
                          className={[
                            "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] transition-colors",
                            activeGender === gender
                              ? "border border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-white"
                              : "border border-[color:var(--oda-border)] bg-white/70 text-[color:var(--oda-ink)]",
                          ].join(" ")}
                        >
                          {gender}
                        </button>
                      ))}
                    </div>

                    {/* Category sections for selected gender */}
                    {activeGender && genderSections ? (
                      <div className="mt-6 flex flex-col gap-6" role="tabpanel" aria-label={`Categorias ${activeGender}`}>
                        {genderSections.map((section) => (
                          <div key={section.key} className="flex flex-col gap-2">
                            <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                              {section.label}
                            </h3>
                            {section.items.map((item) => {
                              const visibleSubcategories = (item.subcategories ?? []).filter(
                                (sub) => sub.count > 0,
                              );
                              return (
                                <div
                                  key={item.key}
                                  className="rounded-2xl border border-[color:var(--oda-border)] bg-white/70 px-3 py-3"
                                >
                                  <Link
                                    prefetch={false}
                                    href={item.href}
                                    className="inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--oda-ink)]"
                                    onClick={() =>
                                      handleItemClick(item.href, item.label, {
                                        level: "gender",
                                        gender: activeGender,
                                        section: section.key,
                                      })
                                    }
                                  >
                                    {item.label}
                                  </Link>
                                  {visibleSubcategories.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-2 px-1">
                                      {visibleSubcategories.map((sub) => (
                                        <Link
                                          prefetch={false}
                                          key={sub.key}
                                          href={sub.href}
                                          className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]"
                                          onClick={() =>
                                            handleItemClick(sub.href, sub.label, {
                                              level: "gender",
                                              gender: activeGender,
                                              section: section.key,
                                            })
                                          }
                                        >
                                          {sub.label}
                                        </Link>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ))}

                        <Link
                          prefetch={false}
                          href={`/${GENDER_ROUTE[activeGender]}`}
                          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
                          onClick={() =>
                            handleItemClick(`/${GENDER_ROUTE[activeGender]}`, `Ver todo ${activeGender}`, {
                              level: "gender",
                              gender: activeGender,
                            })
                          }
                        >
                          Ver todo {activeGender}
                        </Link>
                      </div>
                    ) : null}

                    {/* Account link */}
                    <div className="mt-8 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                      <span>Cuenta</span>
                      <AccountLink className="rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2" />
                    </div>
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
