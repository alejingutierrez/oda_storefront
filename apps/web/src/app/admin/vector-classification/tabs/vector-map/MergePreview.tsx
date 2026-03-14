"use client";

import type { MergePreviewResult } from "@/lib/vector-classification/types";

type Props = {
  preview: MergePreviewResult | null;
  loading: boolean;
};

export default function MergePreview({ preview, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-6 rounded bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!preview) return null;

  const rows = [
    { label: "Productos afectados", count: preview.counts.products },
    { label: "Ground truth actualizados", count: preview.counts.groundTruth },
    { label: "Sugerencias cerradas", count: preview.counts.suggestions },
    { label: "Páginas SEO eliminadas", count: preview.counts.seoPages },
    { label: "Centroids eliminados", count: preview.counts.centroids },
  ];

  if (preview.counts.subcategoriesMoved != null) {
    rows.push({
      label: "Subcategorías movidas",
      count: preview.counts.subcategoriesMoved,
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex justify-between px-3 py-2 text-sm"
          >
            <span className="text-slate-600">{r.label}</span>
            <span className="font-semibold text-slate-800">
              {r.count.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs font-medium text-amber-800 mb-1">Advertencias</p>
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
