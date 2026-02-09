"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CatalogProductCard from "@/components/CatalogProductCard";
import type { CatalogProduct } from "@/lib/catalog-data";

type ApiResponse = {
  items: CatalogProduct[];
  totalCount: number;
  pageSize?: number;
};

export default function CatalogProductsInfinite({
  initialItems,
  totalCount,
  initialSearchParams,
}: {
  initialItems: CatalogProduct[];
  totalCount: number;
  initialSearchParams: string;
}) {
  const [items, setItems] = useState<CatalogProduct[]>(initialItems);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadedIdsRef = useRef(new Set(initialItems.map((item) => item.id)));

  useEffect(() => {
    setItems(initialItems);
    setPage(1);
    setLoading(false);
    setError(null);
    loadedIdsRef.current = new Set(initialItems.map((item) => item.id));
  }, [initialItems, initialSearchParams]);

  const hasMore = useMemo(() => items.length < totalCount, [items.length, totalCount]);
  const progressPct = useMemo(() => {
    if (!totalCount) return 0;
    return Math.max(0, Math.min(100, (items.length / totalCount) * 100));
  }, [items.length, totalCount]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);

    const nextPage = page + 1;
    const nextParams = new URLSearchParams(initialSearchParams);
    nextParams.delete("page");
    nextParams.set("page", String(nextPage));

    try {
      const res = await fetch(`/api/catalog/products?${nextParams.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`http_${res.status}`);
      }
      const data = (await res.json()) as ApiResponse;
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => {
        const merged = [...prev];
        for (const item of nextItems) {
          if (!loadedIdsRef.current.has(item.id)) {
            loadedIdsRef.current.add(item.id);
            merged.push(item);
          }
        }
        return merged;
      });
      setPage(nextPage);
    } catch (err) {
      const message = err instanceof Error ? err.message : "load_failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [hasMore, initialSearchParams, loading, page]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "900px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-10 text-center">
        <p className="text-lg font-semibold text-[color:var(--oda-ink)]">
          No encontramos productos con esos filtros.
        </p>
        <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
          Prueba ajustar genero, categoria o rango de precio para ampliar resultados.
        </p>
        <a
          href="/catalogo"
          className="mt-6 inline-flex rounded-full bg-[color:var(--oda-ink)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
        >
          Volver al catálogo
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((product) => (
          <CatalogProductCard key={product.id} product={product} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="w-full rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Mostrando{" "}
              <span className="font-semibold text-[color:var(--oda-ink)]">
                {items.length.toLocaleString("es-CO")}
              </span>{" "}
              de{" "}
              <span className="font-semibold text-[color:var(--oda-ink)]">
                {totalCount.toLocaleString("es-CO")}
              </span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              {Math.round(progressPct)}%
            </p>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-[color:var(--oda-stone)]">
            <div
              className="h-2 rounded-full bg-[color:var(--oda-ink)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4 text-center">
            <p className="text-sm text-[color:var(--oda-ink-soft)]">
              No pudimos cargar más productos. Intenta de nuevo.
            </p>
            <button
              type="button"
              onClick={() => void loadMore()}
              className="mt-3 rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {hasMore ? (
          <div className="w-full">
            <div ref={sentinelRef} />
            <div className="mt-2 flex items-center justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className={[
                  "rounded-full border border-[color:var(--oda-border)] bg-white px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]",
                  loading ? "cursor-not-allowed opacity-60" : "",
                ].join(" ")}
              >
                {loading ? "Cargando…" : "Cargar más"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Fin del catálogo
          </p>
        )}
      </div>
    </div>
  );
}
