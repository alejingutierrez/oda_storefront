"use client";

import type { ProjectedCentroid } from "./types";
import { getMenuGroupColor } from "./colors";

type Props = {
  centroid: ProjectedCentroid | null;
  x: number;
  y: number;
};

export default function CentroidTooltip({ centroid, x, y }: Props) {
  if (!centroid) return null;

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
      style={{
        left: x + 12,
        top: y - 10,
        maxWidth: 260,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: getMenuGroupColor(centroid.menuGroup) }}
        />
        <span className="font-semibold">{centroid.displayLabel}</span>
      </div>

      <div className="text-slate-300 space-y-0.5">
        <div>Categoría: {centroid.category}</div>
        <div>Grupo: {centroid.menuGroup}</div>
        <div>Muestras: {centroid.sampleCount.toLocaleString()}</div>
        {centroid.avgIntraDistance != null && (
          <div>Dist. intra-cluster: {centroid.avgIntraDistance.toFixed(4)}</div>
        )}
      </div>
    </div>
  );
}
