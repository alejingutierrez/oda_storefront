"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectedCentroid, ViewLevel } from "./types";
import type { MergePreviewResult, MergeResult } from "@/lib/vector-classification/types";
import { getMenuGroupColor } from "./colors";
import MergePreview from "./MergePreview";

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  selectedCentroids: ProjectedCentroid[];
  level: ViewLevel;
};

type Step = "select-target" | "preview" | "confirm" | "executing" | "done";

export default function MergeWizard({
  open,
  onClose,
  onComplete,
  selectedCentroids,
  level,
}: Props) {
  const [step, setStep] = useState<Step>("select-target");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("select-target");
      setTargetId(null);
      setPreview(null);
      setConfirmText("");
      setResult(null);
      setError(null);
    }
  }, [open]);

  const target = selectedCentroids.find((c) => c.id === targetId);
  const sources = selectedCentroids.filter((c) => c.id !== targetId);

  const mergeType = level === "category" ? "category" : "subcategory";

  const loadPreview = useCallback(async () => {
    if (!target || sources.length === 0) return;
    setPreviewLoading(true);
    setError(null);

    try {
      const res = await fetch(
        "/api/admin/vector-classification/vector-map/merge/preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mergeType,
            sourceKeys: sources.map((s) => s.label),
            targetKey: target.label,
            targetCategory: mergeType === "subcategory" ? target.category : undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error cargando preview");
      setPreview(data);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setPreviewLoading(false);
    }
  }, [target, sources, mergeType]);

  const executeMerge = useCallback(async () => {
    if (!target || sources.length === 0) return;
    setExecuting(true);
    setError(null);
    setStep("executing");

    try {
      const res = await fetch(
        "/api/admin/vector-classification/vector-map/merge/execute",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mergeType,
            sourceKeys: sources.map((s) => s.label),
            targetKey: target.label,
            targetCategory: mergeType === "subcategory" ? target.category : undefined,
          }),
        },
      );
      const data = await res.json();
      setResult(data);
      setStep("done");

      if (data.ok) {
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error ejecutando merge");
      setStep("confirm");
    } finally {
      setExecuting(false);
    }
  }, [target, sources, mergeType, onComplete]);

  if (!open) return null;

  const targetLabel = target?.displayLabel ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Fusionar {mergeType === "category" ? "Categorías" : "Subcategorías"}
          </h3>
          <button
            onClick={onClose}
            disabled={executing}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Step 1: Select target */}
          {step === "select-target" && (
            <>
              <p className="text-sm text-slate-600">
                Selecciona cuál será el <strong>target</strong> (el que sobrevive).
                Las demás se fusionarán en esta.
              </p>
              <div className="space-y-1.5">
                {selectedCentroids.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setTargetId(c.id)}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                      targetId === c.id
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: getMenuGroupColor(c.menuGroup) }}
                    />
                    <span className="flex-1">
                      {c.displayLabel}
                      <span className="ml-2 text-xs opacity-60">
                        ({c.sampleCount} muestras)
                      </span>
                    </span>
                    {targetId === c.id && (
                      <span className="text-xs font-medium bg-white/20 rounded-full px-2 py-0.5">
                        TARGET
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step 2: Preview */}
          {step === "preview" && preview && (
            <>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
                <strong>Fusionar</strong>:{" "}
                {sources.map((s) => s.displayLabel).join(", ")}{" "}
                <strong>→</strong> {targetLabel}
              </div>
              <MergePreview preview={preview} loading={false} />
              <p className="text-xs text-slate-500">
                La taxonomía se publicará automáticamente después de la fusión.
              </p>
            </>
          )}

          {/* Step 3: Confirm */}
          {step === "confirm" && (
            <>
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-medium text-red-800 mb-2">
                  Esta acción es irreversible. Escribe el nombre del target para confirmar:
                </p>
                <p className="text-xs text-red-700 font-mono mb-2">{targetLabel}</p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Escribe el nombre aquí..."
                  className="w-full rounded border border-red-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
            </>
          )}

          {/* Step 4: Executing */}
          {step === "executing" && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
              <p className="mt-3 text-sm text-slate-600">Ejecutando fusión...</p>
            </div>
          )}

          {/* Step 5: Done */}
          {step === "done" && result && (
            <div
              className={`rounded-lg p-4 ${
                result.ok
                  ? "bg-green-50 border border-green-200"
                  : "bg-red-50 border border-red-200"
              }`}
            >
              <p className={`text-sm font-medium ${result.ok ? "text-green-800" : "text-red-800"}`}>
                {result.ok ? "Fusión completada" : "Error en la fusión"}
              </p>
              {result.ok ? (
                <div className="mt-2 text-xs text-green-700 space-y-0.5">
                  <div>Productos actualizados: {result.productsUpdated}</div>
                  <div>Ground truth: {result.groundTruthUpdated}</div>
                  <div>Sugerencias cerradas: {result.suggestionsUpdated}</div>
                  <div>SEO pages: {result.seoUpdated}</div>
                  <div>Taxonomía publicada: {result.taxonomyPublished ? "Sí" : "No"}</div>
                  <div>Centroid re-entrenado: {result.centroidRetrained ? "Sí" : "No"}</div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-red-700">{result.error}</p>
              )}
            </div>
          )}

          {/* Error */}
          {error && step !== "done" && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {step === "select-target" && (
            <>
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={loadPreview}
                disabled={!targetId || previewLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {previewLoading ? "Cargando..." : "Ver impacto"}
              </button>
            </>
          )}

          {step === "preview" && (
            <>
              <button
                onClick={() => setStep("select-target")}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Atrás
              </button>
              <button
                onClick={() => setStep("confirm")}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Proceder a confirmar
              </button>
            </>
          )}

          {step === "confirm" && (
            <>
              <button
                onClick={() => setStep("preview")}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Atrás
              </button>
              <button
                onClick={executeMerge}
                disabled={confirmText !== targetLabel}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Fusionar
              </button>
            </>
          )}

          {step === "done" && (
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
