"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const ROUTE_LOADING_START_EVENT = "oda:route-loading:start";
const ROUTE_LOADING_STOP_EVENT = "oda:route-loading:stop";
const WATCHDOG_MS = 10_000;
const MIN_VISIBLE_MS = 220;

export default function GlobalRouteLoadingIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = useMemo(() => `${pathname}?${searchParams.toString()}`, [pathname, searchParams]);

  const [visible, setVisible] = useState(false);
  const activeRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const routeKeyRef = useRef<string | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  const clearTimer = useCallback((ref: MutableRefObject<number | null>) => {
    if (ref.current === null) return;
    window.clearTimeout(ref.current);
    ref.current = null;
  }, []);

  const startLoading = useCallback(() => {
    if (typeof window === "undefined") return;
    if (activeRef.current) return;

    activeRef.current = true;
    startedAtRef.current = Date.now();
    clearTimer(hideTimeoutRef);
    setVisible(true);

    clearTimer(watchdogRef);
    watchdogRef.current = window.setTimeout(() => {
      activeRef.current = false;
      startedAtRef.current = null;
      setVisible(false);
      watchdogRef.current = null;
    }, WATCHDOG_MS);
  }, [clearTimer]);

  const stopLoading = useCallback(() => {
    if (typeof window === "undefined") return;

    activeRef.current = false;
    clearTimer(watchdogRef);

    const startedAt = startedAtRef.current ?? Date.now();
    startedAtRef.current = null;
    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, MIN_VISIBLE_MS - elapsed);

    clearTimer(hideTimeoutRef);
    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = null;
      setVisible(false);
    }, waitMs);
  }, [clearTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStart = () => startLoading();
    const onStop = () => stopLoading();

    const onClickCapture = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (anchor.hasAttribute("download")) return;
      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#")) return;
      if (rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:")) return;

      let nextUrl: URL;
      try {
        nextUrl = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (nextUrl.origin !== window.location.origin) return;
      if (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search) return;

      startLoading();
    };

    const onPopState = () => startLoading();

    window.addEventListener(ROUTE_LOADING_START_EVENT, onStart as EventListener);
    window.addEventListener(ROUTE_LOADING_STOP_EVENT, onStop as EventListener);
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener(ROUTE_LOADING_START_EVENT, onStart as EventListener);
      window.removeEventListener(ROUTE_LOADING_STOP_EVENT, onStop as EventListener);
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [startLoading, stopLoading]);

  useEffect(() => {
    const prev = routeKeyRef.current;
    routeKeyRef.current = routeKey;
    if (prev === null || prev === routeKey) return;
    stopLoading();
  }, [routeKey, stopLoading]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      clearTimer(watchdogRef);
      clearTimer(hideTimeoutRef);
    };
  }, [clearTimer]);

  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none fixed inset-x-0 top-0 z-[260] h-[3px] transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div className="oda-route-loader-track h-full w-full">
        <span className="oda-route-loader-bar" />
      </div>
    </div>
  );
}
