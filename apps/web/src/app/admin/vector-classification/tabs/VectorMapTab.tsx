"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ScatterPlot from "./vector-map/ScatterPlot";
import CentroidTooltip from "./vector-map/CentroidTooltip";
import CentroidInfoPanel from "./vector-map/CentroidInfoPanel";
import DistanceMatrix from "./vector-map/DistanceMatrix";
import MergeWizard from "./vector-map/MergeWizard";
import MergeAuditLog from "./vector-map/MergeAuditLog";
import { useVectorMapData } from "./vector-map/useVectorMapData";
import { useSelection } from "./vector-map/useSelection";
import { MENU_GROUP_COLORS } from "./vector-map/colors";
import type { ViewLevel, ProjectedCentroid } from "./vector-map/types";

const PLOT_WIDTH = 700;
const PLOT_HEIGHT = 520;

export default function VectorMapTab() {
  const [level, setLevel] = useState<ViewLevel>("subcategory");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [showDistances, setShowDistances] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { projections, loading, error, refetch } = useVectorMapData(level, categoryFilter);
  const { selectedIds, selectedCount, toggle, clear } = useSelection();

  const focusedCentroid = useMemo(() => {
    const id = hoveredId ?? (selectedIds.size === 1 ? [...selectedIds][0] : null);
    return projections.find((p) => p.id === id) ?? null;
  }, [hoveredId, selectedIds, projections]);

  const selectedCentroids = useMemo(
    () => projections.filter((p) => selectedIds.has(p.id)),
    [projections, selectedIds],
  );

  // Unique categories for the dropdown filter
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of projections) set.add(p.category);
    return [...set].sort();
  }, [projections]);

  const handleHover = useCallback(
    (id: string | null, event?: React.MouseEvent) => {
      setHoveredId(id);
      if (event) {
        setTooltipPos({ x: event.clientX, y: event.clientY });
      }
    },
    [],
  );

  const handleSelect = useCallback(
    (id: string, multi: boolean) => {
      toggle(id, multi);
    },
    [toggle],
  );

  const handleMergeComplete = useCallback(() => {
    clear();
    refetch();
  }, [clear, refetch]);

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Level toggle */}
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          {(["category", "subcategory"] as const).map((l) => (
            <button
              key={l}
              onClick={() => {
                setLevel(l);
                setCategoryFilter(null);
                clear();
              }}
              className={`px-4 py-1.5 text-xs font-medium transition ${
                level === l
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {l === "category" ? "Categorías" : "Subcategorías"}
            </button>
          ))}
        </div>

        {/* Category filter (only for subcategory view) */}
        {level === "subcategory" && (
          <select
            value={categoryFilter ?? ""}
            onChange={(e) => {
              setCategoryFilter(e.target.value || null);
              clear();
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 ml-auto text-[10px] text-slate-500">
          {Object.entries(MENU_GROUP_COLORS).map(([name, color]) => (
            <span key={name} className="flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {name}
            </span>
          ))}
        </div>

        {/* History button */}
        <button
          onClick={() => setShowHistory(true)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          Historial
        </button>
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex items-center justify-center h-[520px] rounded-lg border border-slate-200 bg-white">
          <div className="text-center">
            <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
            <p className="mt-3 text-sm text-slate-500">
              Calculando proyecciones UMAP...
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-[520px] rounded-lg border border-red-200 bg-red-50">
          <div className="text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={refetch}
              className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700"
            >
              Reintentar
            </button>
          </div>
        </div>
      ) : projections.length === 0 ? (
        <div className="flex items-center justify-center h-[520px] rounded-lg border border-slate-200 bg-white">
          <p className="text-sm text-slate-400">
            No hay centroids entrenados para esta vista. Entrena modelos en la pestaña Modelo primero.
          </p>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Scatter plot */}
          <div className="flex-1 min-w-0">
            <ScatterPlot
              data={projections}
              level={level}
              selectedIds={selectedIds}
              hoveredId={hoveredId}
              onHover={handleHover}
              onSelect={handleSelect}
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Scroll para zoom · Arrastra para mover · Click para seleccionar · Shift+click para multi-selección
            </p>
          </div>

          {/* Info panel */}
          <div className="w-72 shrink-0">
            <div className="rounded-lg border border-slate-200 bg-white p-4 h-[520px] overflow-y-auto">
              <CentroidInfoPanel centroid={focusedCentroid} level={level} />
            </div>
          </div>
        </div>
      )}

      {/* Sticky action bar */}
      {selectedCount >= 2 && (
        <div className="sticky bottom-4 z-40 flex items-center justify-between rounded-xl bg-slate-900 px-5 py-3 shadow-xl">
          <span className="text-sm text-white">
            {selectedCount} centroids seleccionados
          </span>
          <div className="flex gap-2">
            <button
              onClick={clear}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Limpiar
            </button>
            <button
              onClick={() => setShowDistances(true)}
              className="rounded-lg bg-slate-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
            >
              Ver distancias
            </button>
            <button
              onClick={() => setShowMerge(true)}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Fusionar {level === "category" ? "categorías" : "subcategorías"}
            </button>
          </div>
        </div>
      )}

      {/* Tooltip */}
      <CentroidTooltip
        centroid={projections.find((p) => p.id === hoveredId) ?? null}
        x={tooltipPos.x}
        y={tooltipPos.y}
      />

      {/* Modals */}
      <DistanceMatrix
        centroidIds={[...selectedIds]}
        level={level}
        open={showDistances}
        onClose={() => setShowDistances(false)}
      />

      <MergeWizard
        open={showMerge}
        onClose={() => setShowMerge(false)}
        onComplete={handleMergeComplete}
        selectedCentroids={selectedCentroids}
        level={level}
      />

      <MergeAuditLog
        open={showHistory}
        onClose={() => setShowHistory(false)}
      />
    </div>
  );
}
