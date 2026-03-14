"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectedCentroid, ViewLevel } from "./types";

type State = {
  projections: ProjectedCentroid[];
  loading: boolean;
  error: string | null;
};

export function useVectorMapData(level: ViewLevel, category: string | null) {
  const [state, setState] = useState<State>({
    projections: [],
    loading: true,
    error: null,
  });

  const fetchProjections = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const params = new URLSearchParams({ level });
      if (category) params.set("category", category);

      const res = await fetch(
        `/api/admin/vector-classification/vector-map/projections?${params}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setState({ projections: data.projections ?? [], loading: false, error: null });
    } catch (err) {
      setState({
        projections: [],
        loading: false,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }, [level, category]);

  useEffect(() => {
    fetchProjections();
  }, [fetchProjections]);

  return { ...state, refetch: fetchProjections };
}
