"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logExperienceEvent } from "@/lib/experience-events";

type StyleOption = {
  key: string;
  label: string;
};

export default function StyleNavigator({ styles }: { styles: readonly StyleOption[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver to track which style section is visible
  useEffect(() => {
    const sections = styles
      .map((s) => document.getElementById(`style-${s.key}`))
      .filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestKey: string | null = null;
        let bestRatio = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestKey = entry.target.id.replace("style-", "");
          }
        }
        if (bestKey) setActiveKey(bestKey);
      },
      { rootMargin: "-30% 0px -40% 0px", threshold: [0.1, 0.3, 0.5, 0.7] },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [styles]);

  const handleClick = useCallback(
    (styleKey: string) => {
      const el = document.getElementById(`style-${styleKey}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setActiveKey(styleKey);
      logExperienceEvent({
        type: "style_nav_click",
        path: typeof window !== "undefined" ? window.location.pathname : "/",
        properties: { styleKey, surface: "home_style_nav" },
      });
    },
    [],
  );

  // Auto-scroll the pill strip to keep active pill visible
  useEffect(() => {
    if (!activeKey || !scrollRef.current) return;
    const activeBtn = scrollRef.current.querySelector(`[data-style-key="${activeKey}"]`) as HTMLElement | null;
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeKey]);

  return (
    <nav
      className="sticky top-[var(--oda-header-h)] z-30 border-b border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]/90 backdrop-blur-md"
      aria-label="Navegación de estilos"
    >
      <div className="oda-container">
        <div
          ref={scrollRef}
          className="home-hide-scroll flex items-center gap-2 overflow-x-auto py-3 lg:justify-center"
        >
          {styles.map((style) => {
            const isActive = activeKey === style.key;
            return (
              <button
                key={style.key}
                type="button"
                data-style-key={style.key}
                onClick={() => handleClick(style.key)}
                className={`shrink-0 rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
                  isActive
                    ? "border border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink-soft)] hover:border-[color:var(--oda-ink-soft)]"
                }`}
              >
                {style.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
