"use client";

import type { ReactNode } from "react";

export default function StickyActionBar({
  selectedCount,
  busy,
  children,
}: {
  selectedCount: number;
  busy: boolean;
  children: ReactNode;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-lg">
      <span className="shrink-0 text-sm font-semibold text-indigo-700">
        {selectedCount} producto{selectedCount > 1 ? "s" : ""}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {children}
      </div>
      {busy && (
        <span className="text-xs text-indigo-400">Asignando...</span>
      )}
    </div>
  );
}
