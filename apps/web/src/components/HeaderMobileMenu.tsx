"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import AccountLink from "@/components/AccountLink";
import type { MegaMenuData } from "@/lib/home-data";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];

export default function HeaderMobileMenu({ menu }: { menu: MegaMenuData }) {
  const [open, setOpen] = useState(false);

  const portalRoot = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
        <span className="inline-flex h-8 w-8 items-center justify-center text-base text-[color:var(--oda-taupe)]">
          ▾
        </span>
      </button>

      {open && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[200] lg:hidden" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-black/30 backdrop-blur-lg backdrop-saturate-150"
                aria-label="Cerrar menu"
                onClick={() => setOpen(false)}
              />

              <div className="oda-glass-noise absolute inset-x-4 bottom-6 top-24 overflow-hidden rounded-3xl border border-white/50 bg-white/85 shadow-[0_30px_90px_rgba(23,21,19,0.30)] backdrop-blur-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/40 bg-white/75 px-5 py-4 backdrop-blur-xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                    Menu
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-sm font-semibold text-[color:var(--oda-ink)]"
                    aria-label="Cerrar"
                    title="Cerrar"
                  >
                    ×
                  </button>
                </div>

                <div className="max-h-[calc(100vh-10rem)] overflow-auto overscroll-contain px-5 pb-8 pt-5">
                  <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-3">
                    <input
                      type="text"
                      placeholder="Buscar"
                      // iOS: >= 16px evita el zoom automático al focus.
                      className="w-full bg-transparent text-base uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
                    />
                  </div>

                  <div className="mt-6 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                    <span>Explorar</span>
                    <div className="flex items-center gap-1">
                      <Link prefetch={false}
                        href="/novedades"
                        className="rounded-full px-3 py-2 text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                        onClick={() => setOpen(false)}
                      >
                        Novedades
                      </Link>
                      <Link prefetch={false}
                        href="/buscar"
                        className="rounded-full px-3 py-2 text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                        onClick={() => setOpen(false)}
                      >
                        Ver todo
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-4">
                    {GENDERS.map((gender) => {
                      const data = menu[gender];
                      return (
                        <details
                          key={gender}
                          className="group/section border-t border-[color:var(--oda-border)] pt-4"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
                            {gender}
                            <span className="inline-flex h-8 w-8 items-center justify-center text-base text-[color:var(--oda-taupe)] transition group-open/section:rotate-180">
                              ▾
                            </span>
                          </summary>
                          <div className="mt-4 flex flex-col gap-4">
                            {([
                              ["Superiores", data.Superiores],
                              ["Inferiores", data.Inferiores],
                              ["Accesorios", data.Accesorios],
                            ] as const).map(([title, items]) => (
                              <div key={title} className="flex flex-col gap-2">
                                <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                                  {title}
                                </span>
                                <div className="flex flex-col gap-2">
                                  {items.map((item) => (
                                    <div key={item.key} className="flex flex-col gap-1">
                                      <Link prefetch={false}
                                        href={item.href}
                                        className="rounded-xl px-3 py-2 text-xs font-medium text-[color:var(--oda-ink)] transition hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                                        onClick={() => setOpen(false)}
                                      >
                                        {item.label}
                                      </Link>
                                      {item.subcategories && item.subcategories.length > 0 ? (
                                        <div className="flex flex-wrap gap-2 px-3 text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
                                          {item.subcategories.map((sub) => (
                                            <Link prefetch={false}
                                              key={sub.key}
                                              href={sub.href}
                                              className="rounded-full px-2 py-1 transition hover:bg-white/70 hover:text-[color:var(--oda-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                                              onClick={() => setOpen(false)}
                                            >
                                              {sub.label}
                                            </Link>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <Link prefetch={false}
                              href={`/${GENDER_ROUTE[gender]}`}
                              className="inline-flex rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)] transition hover:bg-white/70 hover:text-[color:var(--oda-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                              onClick={() => setOpen(false)}
                            >
                              Ver todo {gender}
                            </Link>
                          </div>
                        </details>
                      );
                    })}
                  </div>

                  <div className="mt-8 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                    <span>Cuenta</span>
                    <AccountLink />
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
