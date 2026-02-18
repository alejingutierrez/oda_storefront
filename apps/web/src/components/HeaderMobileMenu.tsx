"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import AccountLink from "@/components/AccountLink";
import type { MegaMenuData } from "@/lib/home-data";
import { logExperienceEvent } from "@/lib/experience-events";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];
type MenuSectionKey = "Superiores" | "Inferiores" | "Accesorios";
type MobileMenuLevel = "root" | "gender" | "section";
const MENU_SECTIONS: MenuSectionKey[] = ["Superiores", "Inferiores", "Accesorios"];

export default function HeaderMobileMenu({ menu }: { menu: MegaMenuData }) {
  const [open, setOpen] = useState(false);
  const [activeGender, setActiveGender] = useState<GenderKey | null>(null);
  const [activeSection, setActiveSection] = useState<MenuSectionKey | null>(null);
  const lastStepRef = useRef<string | null>(null);

  const portalRoot = typeof document !== "undefined" ? document.body : null;
  const level: MobileMenuLevel = activeGender ? (activeSection ? "section" : "gender") : "root";
  const activeGenderMenu = activeGender ? menu[activeGender] : null;
  const sectionItems = useMemo(() => {
    if (!activeGenderMenu || !activeSection) return [];
    return activeGenderMenu[activeSection];
  }, [activeGenderMenu, activeSection]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveGender(null);
    setActiveSection(null);
  }, []);

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
    const stepKey = `${level}|${activeGender ?? ""}|${activeSection ?? ""}`;
    if (lastStepRef.current === stepKey) return;
    logExperienceEvent({
      type: "menu_mobile_step",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        level,
        gender: activeGender,
        section: activeSection,
      },
    });
    lastStepRef.current = stepKey;
  }, [activeGender, activeSection, level, open]);

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

  const goBack = () => {
    if (level === "section") {
      setActiveSection(null);
      return;
    }
    setActiveGender(null);
  };

  const panelTitle = (() => {
    if (level === "root") return "Menu";
    if (level === "gender") return activeGender ?? "Menu";
    if (activeGender && activeSection) return `${activeGender} · ${activeSection}`;
    return "Menu";
  })();

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

              <div className="oda-glass-noise absolute inset-x-4 bottom-6 top-24 overflow-hidden rounded-3xl border border-white/50 bg-white/85 shadow-[0_30px_90px_rgba(23,21,19,0.30)] backdrop-blur-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/40 bg-white/75 px-5 py-4 backdrop-blur-xl">
                  <div className="flex items-center gap-2">
                    {level !== "root" ? (
                      <button
                        type="button"
                        onClick={goBack}
                        className="inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-sm text-[color:var(--oda-ink)]"
                        aria-label="Volver"
                      >
                        ←
                      </button>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                        Explorar
                      </span>
                    )}
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      {panelTitle}
                    </p>
                  </div>
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

                <div className="max-h-[calc(100vh-10rem)] overflow-auto overscroll-contain px-5 pb-8 pt-5">
                  {level === "root" ? (
                    <>
                      <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3">
                        <input
                          type="text"
                          placeholder="Buscar"
                          // iOS: >= 16px evita el zoom automático al focus.
                          className="w-full bg-transparent text-base uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
                        />
                      </div>
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
                      <div className="mt-6 flex flex-col gap-2">
                        {GENDERS.map((gender) => (
                          <button
                            key={gender}
                            type="button"
                            onClick={() => {
                              setActiveGender(gender);
                              setActiveSection(null);
                            }}
                            className="inline-flex min-h-11 items-center justify-between rounded-2xl border border-[color:var(--oda-border)] bg-white/70 px-4 py-3 text-xs uppercase tracking-[0.18em] text-[color:var(--oda-ink)]"
                          >
                            {gender}
                            <span aria-hidden className="text-[color:var(--oda-taupe)]">
                              →
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {level === "gender" && activeGender && activeGenderMenu ? (
                    <div className="flex flex-col gap-2">
                      {MENU_SECTIONS.map((section) => {
                        const count = activeGenderMenu[section].length;
                        return (
                          <button
                            key={section}
                            type="button"
                            onClick={() => setActiveSection(section)}
                            disabled={count === 0}
                            className={[
                              "inline-flex min-h-11 items-center justify-between rounded-2xl border px-4 py-3 text-xs uppercase tracking-[0.18em]",
                              count === 0
                                ? "cursor-not-allowed border-[color:var(--oda-border)] bg-white/40 text-[color:var(--oda-taupe)]"
                                : "border-[color:var(--oda-border)] bg-white/70 text-[color:var(--oda-ink)]",
                            ].join(" ")}
                          >
                            <span>{section}</span>
                            <span className="text-[10px]">{count}</span>
                          </button>
                        );
                      })}
                      <Link
                        prefetch={false}
                        href={`/${GENDER_ROUTE[activeGender]}`}
                        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white/70 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
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

                  {level === "section" && activeGender && activeSection ? (
                    <div className="flex flex-col gap-3">
                      {sectionItems.length === 0 ? (
                        <p className="rounded-2xl border border-[color:var(--oda-border)] bg-white/50 px-4 py-4 text-xs uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                          Sin categorias disponibles
                        </p>
                      ) : (
                        sectionItems.map((item) => {
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
                                    level: "section",
                                    gender: activeGender,
                                    section: activeSection,
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
                                          level: "section",
                                          gender: activeGender,
                                          section: activeSection,
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
                        })
                      )}
                    </div>
                  ) : null}

                  <div className="mt-8 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
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
