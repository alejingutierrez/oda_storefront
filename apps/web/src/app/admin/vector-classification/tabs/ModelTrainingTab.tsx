"use client";

import { useCallback, useEffect, useState } from "react";
import EmbeddingJobPanel from "../EmbeddingJobPanel";
import { CATEGORY_OPTIONS } from "@/lib/product-enrichment/constants";

/* ── Types (matching actual API responses) ── */

type CategoryReadiness = {
  category: string;
  totalProducts: number;
  confirmedCount: number;
  isReady: boolean;
};

type SubcategoryReadiness = {
  subcategory: string;
  category: string;
  totalProducts: number;
  confirmedCount: number;
  isReady: boolean;
};

type ModelInfo = {
  lastRun: {
    id: string;
    modelType: string;
    status: string;
    totalSamples: number | null;
    totalCentroids: number | null;
    metrics: Record<string, unknown> | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
  centroidCount: number;
  totalSamples: number;
};

type RunRecord = {
  id: string;
  modelType: string;
  status: string;
  totalSamples: number | null;
  totalCentroids: number | null;
  metrics: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

/* ── Helpers ── */

const fmt = (n: number) => n.toLocaleString("es-CO");
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "--";
  return new Date(d).toLocaleString("es-CO");
};

const CheckIcon = () => (
  <svg className="mx-auto h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const XIcon = () => (
  <svg className="mx-auto h-4 w-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/* ── Component ── */

export default function ModelTrainingTab() {
  // Category model
  const [categoryReadiness, setCategoryReadiness] = useState<CategoryReadiness[]>([]);
  const [categoryModel, setCategoryModel] = useState<ModelInfo | null>(null);
  const [trainingCategory, setTrainingCategory] = useState(false);
  const [reclassifyingCategory, setReclassifyingCategory] = useState(false);

  // Subcategory model (per-category)
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [subcatReadiness, setSubcatReadiness] = useState<SubcategoryReadiness[]>([]);
  const [subcatModel, setSubcatModel] = useState<ModelInfo | null>(null);
  const [trainingSubcat, setTrainingSubcat] = useState(false);
  const [reclassifyingSubcat, setReclassifyingSubcat] = useState(false);

  // Gender model
  const [genderModel, setGenderModel] = useState<ModelInfo | null>(null);
  const [trainingGender, setTrainingGender] = useState(false);
  const [reclassifyingGender, setReclassifyingGender] = useState(false);

  // Shared
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);

  /* ── Fetch category readiness ── */
  const fetchCategoryReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/ground-truth/stats?level=category", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.stats)) {
        setCategoryReadiness(data.stats);
      }
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch subcategory readiness (for selected category) ── */
  const fetchSubcatReadiness = useCallback(async (category: string) => {
    if (!category) {
      setSubcatReadiness([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/vector-classification/ground-truth/stats?category=${encodeURIComponent(category)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.stats)) {
        setSubcatReadiness(data.stats);
      }
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch model status ── */
  const fetchModelStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/model/status", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.categoryModel) setCategoryModel(data.categoryModel);
      if (data.subcategoryModel) setSubcatModel(data.subcategoryModel);
      if (data.genderModel) setGenderModel(data.genderModel);
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch recent runs ── */
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vector-classification/model/runs", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.runs)) setRuns(data.runs);
    } catch {
      // silent
    }
  }, []);

  /* ── Initial load ── */
  useEffect(() => {
    Promise.all([
      fetchCategoryReadiness(),
      fetchModelStatus(),
      fetchRuns(),
    ]).finally(() => setLoadingInit(false));
  }, [fetchCategoryReadiness, fetchModelStatus, fetchRuns]);

  /* ── Reload subcategory readiness when category changes ── */
  useEffect(() => {
    if (selectedCategory) {
      fetchSubcatReadiness(selectedCategory);
    } else {
      setSubcatReadiness([]);
    }
  }, [selectedCategory, fetchSubcatReadiness]);

  /* ── Train model ── */
  const handleTrain = useCallback(
    async (modelType: "category" | "subcategory" | "gender", category?: string) => {
      const setTraining =
        modelType === "category"
          ? setTrainingCategory
          : modelType === "subcategory"
            ? setTrainingSubcat
            : setTrainingGender;
      setTraining(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/vector-classification/model/train", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelType, ...(category ? { category } : {}) }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "Error al entrenar modelo");
        }
        await fetchModelStatus();
        await fetchRuns();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al entrenar modelo");
      } finally {
        setTraining(false);
      }
    },
    [fetchModelStatus, fetchRuns],
  );

  /* ── Run reclassification ── */
  const handleReclassify = useCallback(
    async (modelType: "category" | "subcategory" | "gender", category?: string) => {
      const setRunning =
        modelType === "category"
          ? setReclassifyingCategory
          : modelType === "subcategory"
            ? setReclassifyingSubcat
            : setReclassifyingGender;
      setRunning(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/vector-classification/reclassification/run", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelType, ...(category ? { category } : {}) }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "Error al ejecutar reclasificacion");
        }
        await fetchRuns();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al ejecutar reclasificacion");
      } finally {
        setRunning(false);
      }
    },
    [fetchRuns],
  );

  /* ── Derived ── */
  const categoryReadyCount = categoryReadiness.filter((s) => s.isReady).length;
  const subcatReadyCount = subcatReadiness.filter((s) => s.isReady).length;
  const categoryTrained = (categoryModel?.centroidCount ?? 0) > 0;
  const subcatTrained = (subcatModel?.centroidCount ?? 0) > 0;
  const genderTrained = (genderModel?.centroidCount ?? 0) > 0;

  if (loadingInit) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Cargando datos del modelo...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {/* ── Section A: Embeddings (dedicated panel) ── */}
      <EmbeddingJobPanel />

      {/* ── Section B: Category Model ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-base font-semibold text-slate-900">
          Modelo Categoria (Nivel 1)
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Clasifica productos en 26 categorias. {categoryReadyCount} de {categoryReadiness.length} categorias listas.
        </p>

        <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Confirmados</th>
                <th className="px-3 py-2 text-center">Listo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categoryReadiness.map((row) => (
                <tr key={row.category} className={row.isReady ? "bg-emerald-50/60" : ""}>
                  <td className="px-3 py-1.5 font-medium text-slate-800">{row.category}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{fmt(row.totalProducts)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{fmt(row.confirmedCount)}</td>
                  <td className="px-3 py-1.5 text-center">{row.isReady ? <CheckIcon /> : <XIcon />}</td>
                </tr>
              ))}
              {categoryReadiness.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-400">
                    Sin datos de categorias.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {categoryTrained && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Centroides entrenados
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {categoryModel?.centroidCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Muestras usadas
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt(categoryModel?.totalSamples ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Estado ultimo run
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {categoryModel?.lastRun?.status ?? "--"}
              </p>
            </div>
          </div>
        )}

        {categoryModel?.lastRun?.completedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Ultimo entrenamiento: {fmtDate(categoryModel.lastRun.completedAt)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => handleTrain("category")}
            disabled={trainingCategory}
          >
            {trainingCategory ? "Entrenando..." : "Entrenar modelo categoria"}
          </button>
          {categoryTrained && (
            <button
              type="button"
              className="rounded-xl border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handleReclassify("category")}
              disabled={reclassifyingCategory}
            >
              {reclassifyingCategory ? "Ejecutando reclasificacion..." : "Correr reclasificacion (todos los productos)"}
            </button>
          )}
        </div>
      </div>

      {/* ── Section C: Subcategory Model (per category, on-demand) ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-base font-semibold text-slate-900">
          Modelo Subcategoria (Nivel 2 — por categoria)
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Selecciona una categoria para entrenar y ejecutar el modelo de subcategorias a demanda.
        </p>

        {/* Category selector */}
        <div className="mt-4">
          <select
            className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">Seleccionar categoria...</option>
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Subcategory readiness (when category selected) */}
        {selectedCategory && (
          <>
            <p className="mt-3 text-sm text-slate-500">
              {subcatReadyCount} de {subcatReadiness.length} subcategorias listas para entrenamiento.
            </p>

            <div className="mt-3 max-h-60 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Subcategoria</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Confirmados</th>
                    <th className="px-3 py-2 text-center">Listo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subcatReadiness.map((row) => (
                    <tr key={row.subcategory} className={row.isReady ? "bg-emerald-50/60" : ""}>
                      <td className="px-3 py-1.5 font-medium text-slate-800">{row.subcategory}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600">{fmt(row.totalProducts)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600">{fmt(row.confirmedCount)}</td>
                      <td className="px-3 py-1.5 text-center">{row.isReady ? <CheckIcon /> : <XIcon />}</td>
                    </tr>
                  ))}
                  {subcatReadiness.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-400">
                        Sin subcategorias para esta categoria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {subcatTrained && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Centroides entrenados (global)
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {subcatModel?.centroidCount ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Muestras usadas (global)
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {fmt(subcatModel?.totalSamples ?? 0)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Estado ultimo run
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {subcatModel?.lastRun?.status ?? "--"}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => handleTrain("subcategory", selectedCategory)}
                disabled={trainingSubcat}
              >
                {trainingSubcat
                  ? "Entrenando..."
                  : `Entrenar subcategorias de "${selectedCategory}"`}
              </button>
              {subcatTrained && (
                <button
                  type="button"
                  className="rounded-xl border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => handleReclassify("subcategory", selectedCategory)}
                  disabled={reclassifyingSubcat}
                >
                  {reclassifyingSubcat
                    ? "Ejecutando reclasificacion..."
                    : `Reclasificar en "${selectedCategory}"`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Section D: Gender Model ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-base font-semibold text-slate-900">Modelo Genero</h3>
        <p className="mt-1 text-sm text-slate-500">
          Entrenamiento y clasificacion por genero (masculino, femenino, no_binario_unisex, infantil).
        </p>

        {genderTrained && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Centroides entrenados
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {genderModel?.centroidCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Muestras usadas
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt(genderModel?.totalSamples ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Estado ultimo run
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {genderModel?.lastRun?.status ?? "--"}
              </p>
            </div>
          </div>
        )}

        {genderModel?.lastRun?.completedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Ultimo entrenamiento: {fmtDate(genderModel.lastRun.completedAt)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => handleTrain("gender")}
            disabled={trainingGender}
          >
            {trainingGender ? "Entrenando..." : "Entrenar modelo"}
          </button>
          {genderTrained && (
            <button
              type="button"
              className="rounded-xl border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handleReclassify("gender")}
              disabled={reclassifyingGender}
            >
              {reclassifyingGender ? "Ejecutando reclasificacion..." : "Correr reclasificacion"}
            </button>
          )}
        </div>
      </div>

      {/* ── Recent runs ── */}
      {runs.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <h3 className="text-base font-semibold text-slate-900">Ejecuciones recientes</h3>
          <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-right">Muestras</th>
                  <th className="px-3 py-2 text-right">Centroides</th>
                  <th className="px-3 py-2 text-left">Inicio</th>
                  <th className="px-3 py-2 text-left">Fin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">
                      {run.modelType === "category"
                        ? "Categoria"
                        : run.modelType === "subcategory"
                          ? "Subcategoria"
                          : "Genero"}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          run.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : run.status === "running"
                              ? "bg-amber-100 text-amber-700"
                              : run.status === "failed"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600">
                      {run.totalSamples != null ? fmt(run.totalSamples) : "--"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600">
                      {run.totalCentroids != null ? fmt(run.totalCentroids) : "--"}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(run.startedAt)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(run.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
