"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import type { MegaMenuData } from "@/lib/home-data";
import { logExperienceEvent } from "@/lib/experience-events";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];
type MenuSectionKey = "Superiores" | "Inferiores" | "Accesorios";

const splitColumns = <T,>(items: T[], columns: number) => {
  if (columns <= 1) return [items];
  const perColumn = Math.ceil(items.length / columns);
  return Array.from({ length: columns }, (_, index) =>
    items.slice(index * perColumn, (index + 1) * perColumn),
  );
};

export default function MegaMenu({ menu }: { menu: MegaMenuData }) {
  const [hoveredGender, setHoveredGender] = useState<GenderKey | null>(null);
  const [pinnedGender, setPinnedGender] = useState<GenderKey | null>(null);
  const [panelGeometry, setPanelGeometry] = useState<{ left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const lastOpenRef = useRef<GenderKey | null>(null);
  const panelId = useId();

  const openGender = pinnedGender ?? hoveredGender;
  const openData = openGender ? menu[openGender] : null;

  const sectionData = useMemo(() => {
    if (!openData) return null;
    return {
      SuperioresColumns: splitColumns(openData.Superiores, 2),
      Inferiores: openData.Inferiores,
      Accesorios: openData.Accesorios,
    };
  }, [openData]);

  const closeMenu = useCallback(() => {
    setPinnedGender(null);
    setHoveredGender(null);
  }, []);

  const syncPanelGeometry = useCallback(() => {
    const nav = rootRef.current;
    if (!nav) return;
    const container = nav.closest(".oda-container");
    if (!(container instanceof HTMLElement)) return;
    const navRect = nav.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setPanelGeometry({
      left: containerRect.left - navRect.left,
      width: containerRect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!openGender) return;
    syncPanelGeometry();
    const onResize = () => syncPanelGeometry();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [openGender, syncPanelGeometry]);

  useEffect(() => {
    if (!openGender) {
      lastOpenRef.current = null;
      return;
    }
    if (lastOpenRef.current === openGender) return;
    logExperienceEvent({
      type: "menu_open",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        surface: "desktop",
        gender: openGender,
        pinned: pinnedGender === openGender,
      },
    });
    lastOpenRef.current = openGender;
  }, [openGender, pinnedGender]);

  useEffect(() => {
    if (!openGender) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current) return;
      if (!rootRef.current.contains(target)) {
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeMenu, openGender]);

  useEffect(() => {
    if (!openGender) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, openGender]);

  const handleBlurCapture = (event: FocusEvent<HTMLElement>) => {
    if (pinnedGender) return;
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !rootRef.current?.contains(nextTarget as Node)) {
      setHoveredGender(null);
    }
  };

  const handleTriggerClick = (gender: GenderKey, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const nextPinned = pinnedGender === gender ? null : gender;
    setPinnedGender(nextPinned);
    setHoveredGender(gender);
    logExperienceEvent({
      type: "menu_pin_toggle",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        surface: "desktop",
        gender,
        pinned: nextPinned === gender,
      },
    });
  };

  const handleItemClick = (
    gender: GenderKey | null,
    section: MenuSectionKey | "Novedades" | "VerTodo",
    href: string,
    label: string,
  ) => {
    logExperienceEvent({
      type: "menu_item_click",
      path: `${window.location.pathname}${window.location.search}`,
      properties: {
        surface: "desktop",
        gender,
        section,
        href,
        label,
      },
    });
    window.requestAnimationFrame(() => closeMenu());
  };

  return (
    <nav
      ref={rootRef}
      className="relative w-full min-w-0"
      onMouseLeave={() => {
        if (!pinnedGender) setHoveredGender(null);
      }}
      onBlurCapture={handleBlurCapture}
    >
      <ul className="flex min-w-0 items-center gap-4 text-sm uppercase tracking-[0.18em] text-[color:var(--oda-ink)] xl:gap-6">
        <li>
          <Link
            prefetch={false}
            href="/novedades"
            className={[
              "relative block py-6 text-xs font-medium transition-colors hover:text-[color:var(--oda-ink-soft)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
              "after:absolute after:left-1/2 after:bottom-4 after:h-[2px] after:w-0 after:-translate-x-1/2 after:rounded-full after:bg-[color:var(--oda-ink)] after:transition-all after:duration-200 hover:after:w-10",
            ].join(" ")}
            onMouseEnter={() => {
              if (!pinnedGender) setHoveredGender(null);
            }}
            onFocus={() => {
              if (!pinnedGender) setHoveredGender(null);
            }}
            onClick={() => handleItemClick(null, "Novedades", "/novedades", "Novedades")}
          >
            Novedades
          </Link>
        </li>
        {GENDERS.map((gender) => {
          const isOpen = openGender === gender;
          const isPinned = pinnedGender === gender;
          return (
            <li key={gender}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onMouseEnter={() => setHoveredGender(gender)}
                onFocus={() => setHoveredGender(gender)}
                onClick={(event) => handleTriggerClick(gender, event)}
                className={[
                  "relative block py-6 text-xs font-medium uppercase tracking-[0.18em] transition-colors hover:text-[color:var(--oda-ink-soft)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                  "after:absolute after:left-1/2 after:bottom-4 after:h-[2px] after:w-0 after:-translate-x-1/2 after:rounded-full after:bg-[color:var(--oda-ink)] after:transition-all after:duration-200",
                  isOpen ? "text-[color:var(--oda-ink)] after:w-10" : "after:w-0 hover:after:w-10",
                  isPinned ? "text-[color:var(--oda-ink-soft)]" : "",
                ].join(" ")}
              >
                {gender}
              </button>
            </li>
          );
        })}
      </ul>
      {openGender && openData && sectionData ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10 bg-white/10 backdrop-blur-xl backdrop-saturate-150"
          />
          <div
            id={panelId}
            className="oda-glass-noise absolute top-full rounded-2xl border border-white/50 bg-white/85 p-8 shadow-[0_30px_80px_rgba(23,21,19,0.18)] backdrop-blur-2xl"
            onMouseEnter={() => setHoveredGender(openGender)}
            role="region"
            aria-label={`Menu ${openGender}`}
            style={
              panelGeometry
                ? {
                    left: `${panelGeometry.left}px`,
                    width: `${panelGeometry.width}px`,
                  }
                : undefined
            }
          >
            <div className="grid grid-cols-4 gap-8">
              <div className="col-span-2 flex flex-col gap-4">
                <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Superiores
                </span>
                <div className="grid grid-cols-2 gap-6">
                  {sectionData.SuperioresColumns.map((items, columnIndex) => (
                    <div
                      key={`${openGender}-superiores-${columnIndex}`}
                      className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-2"
                    >
                      {items.map((item) => (
                        <div key={item.key} className="flex flex-col gap-2">
                          <Link
                            prefetch={false}
                            href={item.href}
                            className={[
                              "-mx-2 inline-flex rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--oda-ink)] transition",
                              "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink-soft)]",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                            ].join(" ")}
                            onClick={() => handleItemClick(openGender, "Superiores", item.href, item.label)}
                          >
                            {item.label}
                          </Link>
                          {item.subcategories && item.subcategories.length > 0 ? (
                            <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                              {item.subcategories.map((sub) => (
                                <Link
                                  prefetch={false}
                                  key={sub.key}
                                  href={sub.href}
                                  className={[
                                    "-mx-2 inline-flex rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] transition",
                                    "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                  ].join(" ")}
                                  onClick={() =>
                                    handleItemClick(openGender, "Superiores", sub.href, sub.label)
                                  }
                                >
                                  {sub.label}
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Inferiores
                </span>
                <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-2">
                  {sectionData.Inferiores.map((item) => (
                    <div key={item.key} className="flex flex-col gap-2">
                      <Link
                        prefetch={false}
                        href={item.href}
                        className={[
                          "-mx-2 inline-flex rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--oda-ink)] transition",
                          "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink-soft)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                        ].join(" ")}
                        onClick={() => handleItemClick(openGender, "Inferiores", item.href, item.label)}
                      >
                        {item.label}
                      </Link>
                      {item.subcategories && item.subcategories.length > 0 ? (
                        <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                          {item.subcategories.map((sub) => (
                            <Link
                              prefetch={false}
                              key={sub.key}
                              href={sub.href}
                              className={[
                                "-mx-2 inline-flex rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] transition",
                                "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                              ].join(" ")}
                              onClick={() =>
                                handleItemClick(openGender, "Inferiores", sub.href, sub.label)
                              }
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
              <div className="flex flex-col gap-4">
                <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                  Accesorios
                </span>
                <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-2">
                  {sectionData.Accesorios.map((item) => (
                    <div key={item.key} className="flex flex-col gap-2">
                      <Link
                        prefetch={false}
                        href={item.href}
                        className={[
                          "-mx-2 inline-flex rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--oda-ink)] transition",
                          "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink-soft)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                        ].join(" ")}
                        onClick={() => handleItemClick(openGender, "Accesorios", item.href, item.label)}
                      >
                        {item.label}
                      </Link>
                      {item.subcategories && item.subcategories.length > 0 ? (
                        <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                          {item.subcategories.map((sub) => (
                            <Link
                              prefetch={false}
                              key={sub.key}
                              href={sub.href}
                              className={[
                                "-mx-2 inline-flex rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] transition",
                                "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                              ].join(" ")}
                              onClick={() =>
                                handleItemClick(openGender, "Accesorios", sub.href, sub.label)
                              }
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
            </div>
            <div className="mt-6 border-t border-[color:var(--oda-border)] pt-4 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              <Link
                prefetch={false}
                href={`/${GENDER_ROUTE[openGender]}`}
                className="inline-flex items-center gap-2 hover:text-[color:var(--oda-ink)]"
                onClick={() =>
                    handleItemClick(
                      openGender,
                      "VerTodo",
                      `/${GENDER_ROUTE[openGender]}`,
                      `Ver todo ${openGender}`,
                    )
                }
              >
                Ver todo {openGender}
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </nav>
  );
}
