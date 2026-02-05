"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@descope/nextjs-sdk/client";

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
  useSession();
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

    if (typeof window !== "undefined" && path !== "/sign-in") {
      window.sessionStorage.setItem("oda_last_path", path);
    }

    const utm =
      typeof window !== "undefined"
        ? getUtmPayload(new URLSearchParams(window.location.search))
        : undefined;

    fetch("/api/experience/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "page_view",
        path,
        referrer: typeof document !== "undefined" ? document.referrer : undefined,
        utm,
        sessionId,
      }),
      keepalive: true,
    }).catch((error) => {
      console.error("Failed to log experience event", error);
    });
  }, [pathname, sessionId]);

  return null;
}
