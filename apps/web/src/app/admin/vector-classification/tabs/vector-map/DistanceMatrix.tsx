"use client";

import { useEffect, useState } from "react";
import { distanceColor } from "./colors";
import type { DistanceEntry, ViewLevel } from "./types";

type Props = {
  centroidIds: string[];
  level: ViewLevel;
  open: boolean;
  onClose: () => void;
};

export default function DistanceMatrix({ centroidIds, level, open, onClose }: Props) {
  const [distances, setDistances] = useState<DistanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open || centroidIds.length < 2) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          "/api/admin/vector-classification/vector-map/distances",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ centroidIds, level }),
          },
        );
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (cancelled) return;

        const dist: DistanceEntry[] = data.distances ?? [];
        setDistances(dist);

        const lblMap = new Map<string, string>();
        for (const d of dist) {
          lblMap.set(d.a, d.aLabel);
          lblMap.set(d.b, d.bLabel);
        }
        setLabels(lblMap);
      } catch {
        if (!cancelled) setDistances([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [open, centroidIds, level]);

  if (!open) return null;

  const maxDist = Math.max(0.01, ...distances.map((d) => d.distance));

  // Build lookup
  const distMap = new Map<string, number>();
  for (const d of distances) {
    distMap.set(`${d.a}:${d.b}`, d.distance);
    distMap.set(`${d.b}:${d.a}`, d.distance);
  }

  const ids = centroidIds;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="max-w-[90vw] max-h-[80vh] overflow-auto rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Matriz de distancias ({ids.length} centroids)
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-slate-400">
            Calculando distancias...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-2" />
                  {ids.map((id) => (
                    <th
                      key={id}
                      className="p-2 font-medium text-slate-600 max-w-[120px] truncate"
                      title={labels.get(id) ?? id}
                    >
                      {labels.get(id) ?? id.slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ids.map((rowId) => (
                  <tr key={rowId}>
                    <td
                      className="p-2 font-medium text-slate-600 max-w-[120px] truncate"
                      title={labels.get(rowId) ?? rowId}
                    >
                      {labels.get(rowId) ?? rowId.slice(0, 8)}
                    </td>
                    {ids.map((colId) => {
                      if (rowId === colId) {
                        return (
                          <td key={colId} className="p-2 text-center text-slate-300">
                            —
                          </td>
                        );
                      }
                      const dist = distMap.get(`${rowId}:${colId}`);
                      return (
                        <td
                          key={colId}
                          className="p-2 text-center font-mono rounded"
                          style={{
                            backgroundColor: dist != null
                              ? distanceColor(dist, maxDist)
                              : undefined,
                            color: dist != null && dist / maxDist > 0.5
                              ? "white"
                              : "#334155",
                          }}
                        >
                          {dist != null ? dist.toFixed(4) : "?"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[10px] text-slate-400">
          Verde = cercanos · Rojo = distantes · Distancia coseno (0 = idéntico, 2 = opuesto)
        </p>
      </div>
    </div>
  );
}
