"use client";

import type { ProjectedCentroid, ViewLevel } from "./types";
import { getMenuGroupColor } from "./colors";
import ClusterSampleGallery from "./ClusterSampleGallery";

type Props = {
  centroid: ProjectedCentroid | null;
  level: ViewLevel;
};

function MetricRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-700">{value ?? "—"}</span>
    </div>
  );
}

function qualityBadge(avgDist: number | null): { label: string; color: string } {
  if (avgDist == null) return { label: "Sin datos", color: "bg-slate-100 text-slate-500" };
  if (avgDist < 0.3) return { label: "Excelente", color: "bg-green-100 text-green-700" };
  if (avgDist < 0.5) return { label: "Buena", color: "bg-yellow-100 text-yellow-700" };
  return { label: "Difusa", color: "bg-red-100 text-red-700" };
}

export default function CentroidInfoPanel({ centroid, level }: Props) {
  if (!centroid) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Selecciona un centroid para ver detalles
      </div>
    );
  }

  const quality = qualityBadge(centroid.avgIntraDistance);

  return (
    <div className="space-y-4 overflow-y-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: getMenuGroupColor(centroid.menuGroup) }}
          />
          <h3 className="text-sm font-semibold text-slate-800">
            {centroid.displayLabel}
          </h3>
        </div>
        <p className="text-xs text-slate-500">
          {level === "subcategory" && <>Categoría: {centroid.category} · </>}
          Grupo: {centroid.menuGroup}
        </p>
      </div>

      {/* Metrics */}
      <div className="space-y-1.5 rounded-lg bg-slate-50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-600">Métricas</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${quality.color}`}>
            {quality.label}
          </span>
        </div>
        <MetricRow label="Muestras" value={centroid.sampleCount.toLocaleString()} />
        <MetricRow
          label="Dist. promedio"
          value={centroid.avgIntraDistance?.toFixed(4) ?? null}
        />
        <MetricRow
          label="Dist. máxima"
          value={centroid.maxIntraDistance?.toFixed(4) ?? null}
        />
        <MetricRow
          label="Desv. estándar"
          value={centroid.stdIntraDistance?.toFixed(4) ?? null}
        />
        <MetricRow
          label="Último entrenamiento"
          value={
            centroid.lastTrainedAt
              ? new Date(centroid.lastTrainedAt).toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null
          }
        />
      </div>

      {/* Product samples */}
      <div>
        <h4 className="text-xs font-medium text-slate-600 mb-2">
          Productos del cluster
        </h4>
        <ClusterSampleGallery centroidId={centroid.id} level={level} />
      </div>
    </div>
  );
}
