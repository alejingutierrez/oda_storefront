"use client";

import { useEffect, useState } from "react";

type MergeLog = {
  id: string;
  mergeType: string;
  sourceKeys: string[];
  targetKey: string;
  targetCategory: string | null;
  productsUpdated: number;
  groundTruthUpdated: number;
  suggestionsUpdated: number;
  seoUpdated: number;
  taxonomyPublished: boolean;
  centroidRetrained: boolean;
  status: string;
  error: string | null;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function MergeAuditLog({ open, onClose }: Props) {
  const [logs, setLogs] = useState<MergeLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          "/api/admin/vector-classification/vector-map/merge/history",
        );
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) setLogs(data.logs ?? []);
      } catch {
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Historial de fusiones
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
          <div className="flex items-center justify-center h-32 text-sm text-slate-400">
            Cargando historial...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-slate-400">
            No hay fusiones registradas
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`rounded-lg border p-3 text-xs ${
                  log.status === "completed"
                    ? "border-green-200 bg-green-50/50"
                    : "border-red-200 bg-red-50/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-700">
                    {log.mergeType === "category" ? "Categoría" : "Subcategoría"}
                    {" · "}
                    {log.sourceKeys.join(", ")} → {log.targetKey}
                  </span>
                  <span className="text-slate-500">
                    {new Date(log.createdAt).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex gap-4 text-slate-600">
                  <span>Productos: {log.productsUpdated}</span>
                  <span>GT: {log.groundTruthUpdated}</span>
                  <span>Sug: {log.suggestionsUpdated}</span>
                  <span>SEO: {log.seoUpdated}</span>
                </div>
                {log.error && (
                  <p className="mt-1 text-red-600">{log.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
