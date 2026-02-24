"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { isAuthFlowPathname } from "@/lib/auth-return";

const SESSION_KEY = "oda_session_id";

const getSessionId = () => {
  if (typeof window === "undefined") return undefined;
  let sessionId = window.sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
};

const getUtmPayload = (params: URLSearchParams) => {
  const utmKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ];
  const payload: Record<string, string> = {};
  for (const key of utmKeys) {
    const value = params.get(key);
    if (value) payload[key] = value;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
};

export default function ExperienceTracker() {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);
  const sessionId = useMemo(() => getSessionId(), []);

  useEffect(() => {
    if (!pathname) return;
    const search =
      typeof window !== "undefined" && window.location.search
        ? window.location.search.replace(/^\?/, "")
        : "";
    const path = search ? `${pathname}?${search}` : pathname;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;

    if (typeof window !== "undefined" && !isAuthFlowPathname(pathname)) {
      window.sessionStorage.setItem("oda_last_path", path);
    }

    const utm =
      typeof window !== "undefined"
        ? getUtmPayload(new URLSearchParams(window.location.search))
        : undefined;

    const payload = {
      type: "page_view",
      path,
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
      utm,
      sessionId,
    };

    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const send = () => {
      fetch("/api/experience/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // No bloqueamos UX por fallas de telemetria.
      });
    };

    const withIdle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number })
      .requestIdleCallback;
    if (typeof withIdle === "function") {
      idleId = withIdle(send, { timeout: 1400 });
    } else {
      timeoutId = window.setTimeout(send, 700);
    }

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && "cancelIdleCallback" in window) {
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
      }
    };
  }, [pathname, sessionId]);

  return null;
}
