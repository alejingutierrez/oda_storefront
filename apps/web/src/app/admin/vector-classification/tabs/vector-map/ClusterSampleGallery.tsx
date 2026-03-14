"use client";

import { useEffect, useState } from "react";
import type { SampleProduct, ViewLevel } from "./types";

type Props = {
  centroidId: string;
  level: ViewLevel;
};

export default function ClusterSampleGallery({ centroidId, level }: Props) {
  const [products, setProducts] = useState<SampleProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          centroidId,
          level,
          limit: "20",
        });
        const res = await fetch(
          `/api/admin/vector-classification/vector-map/samples?${params}`,
        );
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) setProducts(data.products ?? []);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [centroidId, level]);

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded bg-slate-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">Sin productos disponibles</p>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {products.map((p) => (
        <div
          key={p.id}
          className="group relative aspect-square overflow-hidden rounded bg-slate-50"
          title={`${p.name}\n${p.brandName ?? ""}`}
        >
          {p.imageCoverUrl ? (
            <img
              src={p.imageCoverUrl}
              alt={p.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-slate-300">
              Sin img
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
