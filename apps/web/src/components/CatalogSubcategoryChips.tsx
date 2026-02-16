"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { proxiedImageUrl } from "@/lib/image-proxy";

type SubcategoryItem = {
  value: string;
  label: string;
  count: number;
  previewImageUrl?: string | null;
  previewProductId?: string | null;
};

function isAbortError(err: unknown) {
  if (!err) return false;
  if (err instanceof DOMException) return err.name === "AbortError";
  if (err instanceof Error) return err.name === "AbortError";
  return false;
}

function readSessionJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function coerceItems(input: unknown): SubcategoryItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const obj = row as Partial<SubcategoryItem>;
      const value = typeof obj.value === "string" ? obj.value.trim() : "";
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      const count =
        typeof obj.count === "number" && Number.isFinite(obj.count) && obj.count >= 0 ? Math.round(obj.count) : 0;
      const previewImageUrl = typeof obj.previewImageUrl === "string" ? obj.previewImageUrl.trim() : null;
      const previewProductId = typeof obj.previewProductId === "string" ? obj.previewProductId.trim() : null;
      return {
        value,
        label: label || value,
        count,
        previewImageUrl: previewImageUrl || null,
        previewProductId: previewProductId || null,
      } satisfies SubcategoryItem;
    })
    .filter((item) => item.value.length > 0);
}

function buildCategoryAndGenderKey(paramsString: string) {
  const base = new URLSearchParams(paramsString);
  const category = base
    .getAll("category")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  const genders = base
    .getAll("gender")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const next = new URLSearchParams();
  if (category) next.set("category", category);
  for (const gender of genders) next.append("gender", gender);
  return { category: category ?? "", key: next.toString() };
}

function RailSkeleton({ density }: { density: "desktop" | "mobile" }) {
  const circle = density === "mobile" ? "h-7 w-7" : "h-8 w-8";
  const label = density === "mobile" ? "h-3 w-20" : "h-3 w-28";
  const chip = density === "mobile" ? "px-2.5 py-1.5" : "px-3 py-2";
  return (
    <div className="oda-no-scrollbar flex gap-2 overflow-x-auto py-1">
      {Array.from({ length: 7 }).map((_, idx) => (
        <div
          key={idx}
          className={[
            "flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)]",
            chip,
          ].join(" ")}
        >
          <div className={[circle, "rounded-full bg-[color:var(--oda-stone)]"].join(" ")} />
          <div className="grid gap-1">
            <div className={[label, "rounded-full bg-[color:var(--oda-stone)]"].join(" ")} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CatalogSubcategoryChips({
  mode = "toolbar",
  paramsString,
  lockedKeys: lockedKeysList = [],
}: {
  mode?: "toolbar" | "mobile";
  paramsString?: string;
  lockedKeys?: string[];
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const lockedKeysKey = lockedKeysList.join("|");
  const lockedKeys = useMemo(
    () => new Set(lockedKeysList.filter(Boolean)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lockedKeysKey],
  );
  const paramsStringResolved = (paramsString ?? params.toString()).trim();

  // Si la subcategoría está bloqueada por el path (p.ej. /g/.../ropa_deportiva_y_performance/<sub>),
  // los chips serían engañosos porque no pueden cambiar el resultado.
  const pathParts = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);
  const isLockedSubcategoryRoute = pathParts[0] === "g" && pathParts.length >= 4;

  const { category, key } = useMemo(() => {
    if (isLockedSubcategoryRoute) return { category: "", key: "" };
    return buildCategoryAndGenderKey(paramsStringResolved);
  }, [isLockedSubcategoryRoute, paramsStringResolved]);
  const sessionKey = useMemo(
    () => `oda_catalog_subcategories_chips_v1:${key || "base"}`,
    [key],
  );

  const selected = useMemo(() => {
    const current = new URLSearchParams(paramsStringResolved);
    return current
      .getAll("subcategory")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }, [paramsStringResolved]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const [items, setItems] = useState<SubcategoryItem[] | null>(() => {
    if (!category) return null;
    const cached = readSessionJson<unknown>(sessionKey);
    const parsed = coerceItems(cached);
    return parsed.length > 0 ? parsed : null;
  });
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const isDesktop =
      typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true;
    if (mode === "toolbar" && !isDesktop) return;
    if (mode === "mobile" && isDesktop) return;

    if (!category) {
      abortRef.current?.abort();
      setItems(null);
      setLoading(false);
      return;
    }

    const cached = readSessionJson<unknown>(sessionKey);
    const cachedItems = coerceItems(cached);
    if (cachedItems.length > 0) setItems(cachedItems);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const timeout = window.setTimeout(async () => {
      const watchdog = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/catalog/subcategories?${key}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`http_${res.status}`);
        const payload = (await res.json()) as { items?: unknown };
        const next = coerceItems(payload?.items);
        setItems(next);
        writeSessionJson(sessionKey, next);
      } catch (err) {
        if (isAbortError(err)) return;
        setItems((prev) => prev);
      } finally {
        window.clearTimeout(watchdog);
        setLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [category, key, mode, sessionKey]);

  const applyParams = (next: URLSearchParams) => {
    next.set("page", "1");
    const urlParams = new URLSearchParams(next.toString());
    for (const key of lockedKeys) urlParams.delete(key);
    const query = urlParams.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const toggleAll = () => {
    const next = new URLSearchParams(paramsStringResolved);
    next.delete("subcategory");
    applyParams(next);
  };

  const toggleSubcategory = (value: string) => {
    const next = new URLSearchParams(paramsStringResolved);
    const current = next
      .getAll("subcategory")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const has = current.includes(value);
    const updated = has ? current.filter((item) => item !== value) : [...current, value];
    next.delete("subcategory");
    for (const item of updated) next.append("subcategory", item);
    applyParams(next);
  };

  if (isLockedSubcategoryRoute) return null;
  if (!category) return null;

  const resolved = items ?? [];
  if (!loading && resolved.length === 0) return null;

  const density = mode === "mobile" ? "mobile" : "desktop";
  const showCounts = density === "desktop";
  const labelMaxW = density === "mobile" ? "max-w-[8.5rem]" : "max-w-[10rem]";
  const circle = density === "mobile" ? "h-7 w-7" : "h-8 w-8";
  const circleSizes = density === "mobile" ? "28px" : "32px";
  const chip = density === "mobile" ? "px-2.5 py-1.5" : "px-3 py-2";
  const chipGap = density === "mobile" ? "gap-2" : "gap-2.5";
  const labelClass = density === "mobile" ? "text-[12px]" : "text-[13px]";

  const wrapperClassName =
    mode === "toolbar"
      ? "mt-2 border-t border-[color:var(--oda-border)] pt-2"
      : [
          // Avoid mobile horizontal overflow: Safari sometimes counts shadows/backdrop-filter
          // towards the scrollable overflow area, which makes the whole PLP "wider".
          "sticky top-20 z-30 w-full min-w-0 max-w-[100vw] overflow-x-hidden border-b border-[color:var(--oda-border)]",
          "bg-[color:var(--oda-cream)] py-2",
          "lg:hidden",
        ].join(" ");

  return (
    <div className={wrapperClassName} aria-label="Subcategorías" aria-busy={isPending || loading}>
      <div className="relative">
        {loading && resolved.length === 0 ? (
          <RailSkeleton density={density} />
        ) : (
          <>
            <div
              className={[
                "oda-no-scrollbar flex w-full min-w-0 max-w-full gap-2 overflow-x-auto py-1",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={toggleAll}
                aria-pressed={selected.length === 0}
                className={[
                  `group inline-flex shrink-0 items-center ${chipGap} rounded-full border text-left transition`,
                  chip,
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                  selected.length === 0
                    ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                ].join(" ")}
                title="Ver todas"
              >
                <span
                  className={[
                    `flex ${circle} items-center justify-center rounded-full border`,
                    selected.length === 0
                      ? "border-white/40 bg-white/10 text-[color:var(--oda-cream)]"
                      : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)]",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  *
                </span>
                <span className="min-w-0">
                  <span className={["block truncate font-semibold leading-tight", labelMaxW, labelClass].join(" ")}>
                    Todas
                    {showCounts ? (
                      <span
                        className={[
                          "ml-2 text-[11px] font-normal text-[color:var(--oda-taupe)]",
                          selected.length === 0 ? "text-white/80" : "",
                        ].join(" ")}
                      >
                        {resolved.reduce((acc, item) => acc + (item.count ?? 0), 0).toLocaleString("es-CO")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>

              {resolved.map((item) => {
                const active = selectedSet.has(item.value);
                const img = proxiedImageUrl(item.previewImageUrl, {
                  productId: item.previewProductId ?? null,
                  kind: "cover",
                });
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => toggleSubcategory(item.value)}
                    aria-pressed={active}
                    className={[
                      `group inline-flex shrink-0 items-center ${chipGap} rounded-full border text-left transition`,
                      chip,
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      active
                        ? [
                            "border-[color:var(--oda-ink)] bg-white text-[color:var(--oda-ink)]",
                            density === "desktop" ? "shadow-[0_14px_30px_rgba(23,21,19,0.08)]" : "",
                          ].join(" ")
                        : "border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                    ].join(" ")}
                    title={item.label}
                  >
                    <span
                      className={[
                        "relative overflow-hidden rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]",
                        circle,
                      ].join(" ")}
                    >
                      {img ? (
                        <Image
                          src={img}
                          alt={item.label}
                          fill
                          sizes={circleSizes}
                          unoptimized={img.startsWith("/api/image-proxy")}
                          className="object-cover object-center transition duration-500 group-hover:scale-[1.08] motion-reduce:transition-none"
                          priority={false}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] text-[color:var(--oda-taupe)]">
                          -
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={["block truncate font-semibold leading-tight", labelMaxW, labelClass].join(" ")}>
                        {item.label}
                        {showCounts ? (
                          <span className="ml-2 text-[11px] font-normal text-[color:var(--oda-taupe)]">
                            {item.count.toLocaleString("es-CO")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
