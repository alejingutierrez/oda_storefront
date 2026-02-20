"use client";

import { useEffect } from "react";

export default function HeaderHeightSync() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>("[data-oda-header='true']");
    if (!header) return;

    const commit = () => {
      const height = Math.ceil(header.getBoundingClientRect().height || 0);
      if (!height) return;
      root.style.setProperty("--oda-header-h", `${height}px`);
    };

    commit();

    const onResize = () => commit();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      };
    }

    const observer = new ResizeObserver(() => commit());
    observer.observe(header);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return null;
}
