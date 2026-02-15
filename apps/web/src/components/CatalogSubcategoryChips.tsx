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

function RailSkeleton() {
  return (
    <div className="oda-no-scrollbar flex gap-2 overflow-x-auto py-1">
      {Array.from({ length: 7 }).map((_, idx) => (
        <div
          key={idx}
          className="flex shrink-0 items-center gap-3 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2"
        >
          <div className="h-9 w-9 rounded-full bg-[color:var(--oda-stone)]" />
          <div className="grid gap-1">
            <div className="h-3 w-24 rounded-full bg-[color:var(--oda-stone)]" />
            <div className="h-2 w-14 rounded-full bg-[color:var(--oda-stone)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ArrowIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

export default function CatalogSubcategoryChips({
  mode = "toolbar",
}: {
  mode?: "toolbar" | "mobile";
}) {
  const params = useSearchParams();
  const paramsString = params.toString();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { category, key } = useMemo(() => buildCategoryAndGenderKey(paramsString), [paramsString]);
  const sessionKey = useMemo(
    () => `oda_catalog_subcategories_chips_v1:${key || "base"}`,
    [key],
  );

  const selected = useMemo(() => {
    const current = new URLSearchParams(paramsString);
    return current
      .getAll("subcategory")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }, [paramsString]);
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

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    if (mode !== "toolbar") return;
    const node = scrollerRef.current;
    if (!node) return;

    const update = () => {
      const max = Math.max(0, node.scrollWidth - node.clientWidth);
      setCanScrollLeft(node.scrollLeft > 6);
      setCanScrollRight(node.scrollLeft < max - 6);
    };

    update();
    node.addEventListener("scroll", update, { passive: true });

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    ro?.observe(node);

    return () => {
      node.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [items?.length, mode]);

  const scrollBy = (dir: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    const delta = Math.max(180, Math.round(node.clientWidth * 0.8)) * dir;
    node.scrollBy({ left: delta, behavior: "smooth" });
  };

  const applyParams = (next: URLSearchParams) => {
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const toggleAll = () => {
    const next = new URLSearchParams(paramsString);
    next.delete("subcategory");
    applyParams(next);
  };

  const toggleSubcategory = (value: string) => {
    const next = new URLSearchParams(paramsString);
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

  if (!category) return null;

  const resolved = items ?? [];
  if (!loading && resolved.length === 0) return null;

  const wrapperClassName =
    mode === "toolbar"
      ? "mt-3 border-t border-[color:var(--oda-border)] pt-3"
      : "sticky top-20 z-30 rounded-2xl border border-[color:var(--oda-border)] bg-white/92 px-4 py-3 shadow-[0_18px_50px_rgba(23,21,19,0.10)] backdrop-blur lg:hidden";

  return (
    <div className={wrapperClassName} aria-label="Subcategorías">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
          Subcategorías
        </p>
        {isPending || loading ? (
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Actualizando...
          </p>
        ) : null}
      </div>

      <div className="relative mt-2">
        {loading && resolved.length === 0 ? (
          <RailSkeleton />
        ) : (
          <>
            <div
              ref={scrollerRef}
              className={[
                "oda-no-scrollbar flex gap-2 overflow-x-auto py-1",
                mode === "toolbar" ? "pr-8" : "",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={toggleAll}
                aria-pressed={selected.length === 0}
                className={[
                  "group inline-flex shrink-0 items-center gap-3 rounded-full border px-3 py-2 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                  selected.length === 0
                    ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                ].join(" ")}
                title="Ver todas"
              >
                <span
                  className={[
                    "flex h-9 w-9 items-center justify-center rounded-full border",
                    selected.length === 0
                      ? "border-white/40 bg-white/10 text-[color:var(--oda-cream)]"
                      : "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)]",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  *
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[11rem] truncate text-sm font-semibold">Todas</span>
                  <span
                    className={[
                      "mt-0.5 block text-[10px] uppercase tracking-[0.2em]",
                      selected.length === 0 ? "text-white/80" : "text-[color:var(--oda-taupe)]",
                    ].join(" ")}
                  >
                    {resolved.reduce((acc, item) => acc + (item.count ?? 0), 0).toLocaleString("es-CO")} productos
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
                      "group inline-flex shrink-0 items-center gap-3 rounded-full border px-3 py-2 text-left transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      active
                        ? "border-[color:var(--oda-ink)] bg-white text-[color:var(--oda-ink)] shadow-[0_14px_30px_rgba(23,21,19,0.10)]"
                        : "border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
                    ].join(" ")}
                    title={item.label}
                  >
                    <span className="relative h-9 w-9 overflow-hidden rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]">
                      {img ? (
                        <Image
                          src={img}
                          alt={item.label}
                          fill
                          sizes="36px"
                          unoptimized={img.startsWith("/api/image-proxy")}
                          className="object-cover object-center transition duration-500 group-hover:scale-[1.08] motion-reduce:transition-none"
                          priority={false}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] text-[color:var(--oda-taupe)]">-</span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[11rem] truncate text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                        {item.count.toLocaleString("es-CO")} productos
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {mode === "toolbar" ? (
              <>
                {canScrollLeft ? (
                  <div className="pointer-events-none absolute left-0 top-0 h-full w-10 bg-gradient-to-r from-white to-white/0" />
                ) : null}
                {canScrollRight ? (
                  <div className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-white to-white/0" />
                ) : null}

                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => scrollBy(-1)}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white shadow-[0_18px_50px_rgba(23,21,19,0.12)] transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      canScrollLeft
                        ? "border-[color:var(--oda-border)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]"
                        : "cursor-not-allowed border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] opacity-50",
                    ].join(" ")}
                    disabled={!canScrollLeft}
                    aria-label="Desplazar subcategorías a la izquierda"
                    title="Izquierda"
                  >
                    <ArrowIcon dir="left" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollBy(1)}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white shadow-[0_18px_50px_rgba(23,21,19,0.12)] transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      canScrollRight
                        ? "border-[color:var(--oda-border)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]"
                        : "cursor-not-allowed border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] opacity-50",
                    ].join(" ")}
                    disabled={!canScrollRight}
                    aria-label="Desplazar subcategorías a la derecha"
                    title="Derecha"
                  >
                    <ArrowIcon dir="right" />
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
