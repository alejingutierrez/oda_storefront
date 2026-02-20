"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import CatalogFiltersPanel from "@/components/CatalogFiltersPanel";
import {
  GENDER_LABELS,
  SEASON_LABELS,
} from "@/lib/product-enrichment/constants";
import type { TaxonomyOptions } from "@/lib/taxonomy/types";
import BulkEditModal, { type BulkChange, type QueueResult } from "./BulkEditModal";
import CurationQueuePanel, {
  type CurationQueueItem,
  type QueueStatusFilter,
} from "./CurationQueuePanel";

type FacetItem = {
  value: string;
  label: string;
  count: number;
  swatch?: string | null;
};

type Facets = {
  categories: FacetItem[];
  genders: FacetItem[];
  brands: FacetItem[];
  seoTags: FacetItem[];
  colors: FacetItem[];
  sizes: FacetItem[];
  fits: FacetItem[];
  materials: FacetItem[];
  patterns: FacetItem[];
  occasions: FacetItem[];
  seasons: FacetItem[];
  styles: FacetItem[];
};

type CurationProduct = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brandName: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  season: string | null;
  stylePrimary: string | null;
  styleSecondary: string | null;
  editorialFavoriteRank: number | null;
  editorialTopPickRank: number | null;
  status: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  variantCount: number;
  inStockCount: number;
  hasEnrichment: boolean;
};

type ProductsResponse = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  items: CurationProduct[];
};

type QueueSummary = {
  pending: number;
  applying: number;
  applied: number;
  failed: number;
  cancelled: number;
};

type SelectionBanner = { kind: "info" | "warning"; text: string };

type QueueConflictInfo = {
  withIds: string[];
  overlapCount: number;
};

const PAGE_SIZE = 36;
const SELECT_ALL_LIMIT = 1200;

const DEFAULT_QUEUE_SUMMARY: QueueSummary = {
  pending: 0,
  applying: 0,
  applied: 0,
  failed: 0,
  cancelled: 0,
};

type CssVarStyle = CSSProperties & Record<`--${string}`, string>;

function buildSearchKey(params: URLSearchParams) {
  const next = new URLSearchParams(params.toString());
  // Infinite scroll maneja page internamente.
  next.delete("page");
  next.delete("pageSize");
  return next.toString();
}

function isAbortError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  if (!("name" in err)) return false;
  return (err as { name?: unknown }).name === "AbortError";
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) return "Consultar";
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? "COP"} ${value.toFixed(0)}`;
  }
}

function formatPriceRange(minPrice: string | null, maxPrice: string | null, currency: string | null) {
  if (!minPrice && !maxPrice) return "Consultar";
  if (!maxPrice || minPrice === maxPrice) return formatPrice(minPrice ?? maxPrice, currency);
  return `${formatPrice(minPrice, currency)} · ${formatPrice(maxPrice, currency)}`;
}

function formatStyleProfile(key: string | null, labels?: Record<string, string> | null) {
  if (!key) return "—";
  return labels?.[key] ?? key;
}

function formatLabel(value: string | null, map: Record<string, string>) {
  if (!value) return "—";
  return map[value] ?? value;
}

function normalizeQueueStatus(raw: unknown): CurationQueueItem["status"] {
  if (
    raw === "pending" ||
    raw === "applying" ||
    raw === "applied" ||
    raw === "failed" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "pending";
}

function normalizeQueueItem(raw: unknown): CurationQueueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string") return null;

  const targetIds = Array.isArray(item.targetIds)
    ? item.targetIds.filter((value): value is string => typeof value === "string")
    : [];

  return {
    id: item.id,
    status: normalizeQueueStatus(item.status),
    orderIndex: typeof item.orderIndex === "number" ? item.orderIndex : 0,
    note: typeof item.note === "string" ? item.note : null,
    source: typeof item.source === "string" ? item.source : null,
    targetScope: typeof item.targetScope === "string" ? item.targetScope : null,
    targetCount: typeof item.targetCount === "number" ? item.targetCount : targetIds.length,
    targetIds,
    searchKeySnapshot: typeof item.searchKeySnapshot === "string" ? item.searchKeySnapshot : null,
    changesJson: item.changesJson ?? null,
    createdByEmail: typeof item.createdByEmail === "string" ? item.createdByEmail : null,
    lastError: typeof item.lastError === "string" ? item.lastError : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    appliedAt: typeof item.appliedAt === "string" ? item.appliedAt : null,
  };
}

function extractFieldSet(changesJson: unknown): Set<string> {
  const fields = new Set<string>();
  if (!Array.isArray(changesJson)) return fields;
  for (const entry of changesJson) {
    if (!entry || typeof entry !== "object") continue;
    const field = (entry as { field?: unknown }).field;
    if (typeof field !== "string") continue;
    fields.add(field);
  }
  return fields;
}

function countOverlap(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  let count = 0;
  for (const value of small) {
    if (large.has(value)) count += 1;
  }
  return count;
}

function hasFieldOverlap(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return false;
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  for (const value of small) {
    if (large.has(value)) return true;
  }
  return false;
}

function buildQueueConflicts(items: CurationQueueItem[]): Record<string, QueueConflictInfo> {
  const pending = items
    .filter((item) => item.status === "pending")
    .slice()
    .sort((a, b) => (a.orderIndex === b.orderIndex ? a.createdAt.localeCompare(b.createdAt) : a.orderIndex - b.orderIndex));

  const byId: Record<string, QueueConflictInfo> = {};
  const targetMap = new Map(pending.map((item) => [item.id, new Set(item.targetIds)]));
  const fieldMap = new Map(pending.map((item) => [item.id, extractFieldSet(item.changesJson)]));

  for (let i = 0; i < pending.length; i += 1) {
    const current = pending[i];
    const currentTargets = targetMap.get(current.id) ?? new Set<string>();
    const currentFields = fieldMap.get(current.id) ?? new Set<string>();

    for (let j = 0; j < i; j += 1) {
      const previous = pending[j];
      const previousTargets = targetMap.get(previous.id) ?? new Set<string>();
      const previousFields = fieldMap.get(previous.id) ?? new Set<string>();
      if (!hasFieldOverlap(currentFields, previousFields)) continue;

      const overlapCount = countOverlap(currentTargets, previousTargets);
      if (overlapCount <= 0) continue;

      const currentInfo = byId[current.id] ?? { withIds: [], overlapCount: 0 };
      if (!currentInfo.withIds.includes(previous.id)) {
        currentInfo.withIds.push(previous.id);
      }
      currentInfo.overlapCount += overlapCount;
      byId[current.id] = currentInfo;

      const previousInfo = byId[previous.id] ?? { withIds: [], overlapCount: 0 };
      if (!previousInfo.withIds.includes(current.id)) {
        previousInfo.withIds.push(current.id);
      }
      previousInfo.overlapCount += overlapCount;
      byId[previous.id] = previousInfo;
    }
  }

  return byId;
}

export default function ProductCurationPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [facets, setFacets] = useState<Facets | null>(null);
  const [subcategories, setSubcategories] = useState<FacetItem[]>([]);
  const [products, setProducts] = useState<CurationProduct[]>([]);
  const [taxonomyOptions, setTaxonomyOptions] = useState<TaxonomyOptions | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectionBanner, setSelectionBanner] = useState<SelectionBanner | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);

  const [queueItems, setQueueItems] = useState<CurationQueueItem[]>([]);
  const [queueSummary, setQueueSummary] = useState<QueueSummary>(DEFAULT_QUEUE_SUMMARY);
  const [queueFilter, setQueueFilter] = useState<QueueStatusFilter>("pending");
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  const [quickEditorialProductId, setQuickEditorialProductId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem("oda_admin_product_curation_selected");
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((item) => typeof item === "string"));
    } catch {
      return new Set();
    }
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const searchKey = useMemo(() => buildSearchKey(searchParams), [searchParams]);
  const filterCategoryKeys = useMemo(() => {
    const params = new URLSearchParams(searchKey);
    const raw = params
      .getAll("category")
      .map((value) => value.trim())
      .filter(Boolean);
    return Array.from(new Set(raw));
  }, [searchKey]);
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const selectedQueueIdList = useMemo(() => Array.from(selectedQueueIds), [selectedQueueIds]);

  const visibleQueueItems = useMemo(() => {
    if (queueFilter === "all") return queueItems;
    return queueItems.filter((item) => item.status === queueFilter);
  }, [queueFilter, queueItems]);

  const queueConflicts = useMemo(() => buildQueueConflicts(queueItems), [queueItems]);

  const pendingQueueItems = useMemo(
    () => queueItems.filter((item) => item.status === "pending"),
    [queueItems],
  );

  const fetchTaxonomyOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/taxonomy/options", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "No se pudo cargar taxonomía");
      }
      const payload = await res.json().catch(() => ({}));
      setTaxonomyOptions(payload?.options ?? null);
    } catch (err) {
      console.warn(err);
      setTaxonomyOptions(null);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await fetch("/api/admin/product-curation/queue?status=all&limit=500", {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ?? "No se pudo cargar la cola");
      }

      const nextItemsRaw = Array.isArray(payload?.items) ? payload.items : [];
      const nextItems = nextItemsRaw
        .map((entry: unknown) => normalizeQueueItem(entry))
        .filter((entry: CurationQueueItem | null): entry is CurationQueueItem => Boolean(entry));

      const rawSummary = payload?.summary && typeof payload.summary === "object"
        ? (payload.summary as Record<string, unknown>)
        : {};

      setQueueItems(nextItems);
      setQueueSummary({
        pending: typeof rawSummary.pending === "number" ? rawSummary.pending : 0,
        applying: typeof rawSummary.applying === "number" ? rawSummary.applying : 0,
        applied: typeof rawSummary.applied === "number" ? rawSummary.applied : 0,
        failed: typeof rawSummary.failed === "number" ? rawSummary.failed : 0,
        cancelled: typeof rawSummary.cancelled === "number" ? rawSummary.cancelled : 0,
      });
    } catch (err) {
      console.warn(err);
      setQueueError(err instanceof Error ? err.message : "Error cargando cola");
      setQueueItems([]);
      setQueueSummary(DEFAULT_QUEUE_SUMMARY);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        "oda_admin_product_curation_selected",
        JSON.stringify(Array.from(selectedIds).slice(0, 5000)),
      );
    } catch {
      // ignore
    }
  }, [selectedIds]);

  useEffect(() => {
    fetchTaxonomyOptions();
    fetchQueue();
  }, [fetchQueue, fetchTaxonomyOptions]);

  useEffect(() => {
    setSelectedQueueIds((prev) => {
      if (prev.size === 0) return prev;
      const available = new Set(queueItems.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => available.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [queueItems]);

  const fetchFacets = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/product-curation/facets?${searchKey}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "No se pudieron cargar filtros");
      }
      const payload = await res.json();
      setFacets(payload.facets ?? null);
      setSubcategories(payload.subcategories ?? []);
    } catch (err) {
      console.warn(err);
      setFacets(null);
      setSubcategories([]);
      setError(err instanceof Error ? err.message : "Error cargando filtros");
    }
  }, [searchKey]);

  const fetchPage = useCallback(
    async (nextPage: number, mode: "reset" | "append") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === "reset") setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams(searchKey);
        params.set("page", String(nextPage));
        params.set("pageSize", String(PAGE_SIZE));
        const res = await fetch(`/api/admin/product-curation/products?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error ?? "No se pudieron cargar productos");
        }
        const payload: ProductsResponse = await res.json();
        const items = Array.isArray(payload.items) ? payload.items : [];

        setTotalCount(typeof payload.totalCount === "number" ? payload.totalCount : null);
        setHasMore(Boolean(payload.hasMore));
        setPage(payload.page ?? nextPage);

        setProducts((prev) => {
          if (mode === "reset") return items;
          const existing = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of items) {
            if (existing.has(item.id)) continue;
            merged.push(item);
          }
          return merged;
        });
      } catch (err) {
        if (isAbortError(err)) return;
        console.warn(err);
        setError(err instanceof Error ? err.message : "Error cargando productos");
        setHasMore(false);
      } finally {
        if (mode === "reset") setLoading(false);
        else setLoadingMore(false);
      }
    },
    [searchKey],
  );

  useEffect(() => {
    setSelectionBanner(null);
    setPage(1);
    setHasMore(true);
    setTotalCount(null);
    setProducts([]);
    fetchFacets();
    fetchPage(1, "reset");
  }, [fetchFacets, fetchPage, searchKey]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, "append");
  }, [fetchPage, hasMore, loading, loadingMore, page]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMore();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedCount = selectedIds.size;

  const handleSelectAll = useCallback(async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    setSelectionBanner(null);
    try {
      const params = new URLSearchParams(searchKey);
      params.set("limit", String(SELECT_ALL_LIMIT));
      const res = await fetch(`/api/admin/product-curation/ids?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "No se pudieron seleccionar los productos");
      }
      const payload = await res.json().catch(() => ({}));
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id: unknown) => typeof id === "string") : [];
      const hasMoreIds = Boolean(payload?.hasMore);
      const limit = typeof payload?.limit === "number" ? payload.limit : SELECT_ALL_LIMIT;
      setSelectedIds(new Set(ids));
      if (hasMoreIds) {
        setSelectionBanner({
          kind: "warning",
          text: `Seleccionados ${ids.length.toLocaleString("es-CO")}. Hay más resultados; ajusta filtros para no exceder el límite (${limit.toLocaleString("es-CO")}).`,
        });
      } else {
        setSelectionBanner({
          kind: "info",
          text: `Seleccionados ${ids.length.toLocaleString("es-CO")} producto(s).`,
        });
      }
    } catch (err) {
      console.warn(err);
      setSelectionBanner({
        kind: "warning",
        text: err instanceof Error ? err.message : "No se pudieron seleccionar los productos",
      });
    } finally {
      setSelectingAll(false);
    }
  }, [searchKey, selectingAll]);

  const enqueueOperation = useCallback(
    async (payload: {
      productIds: string[];
      changes: BulkChange[];
      note?: string;
      source?: string;
      targetScope?: string;
      searchKeySnapshot?: string;
    }): Promise<QueueResult> => {
      const res = await fetch("/api/admin/product-curation/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responsePayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(responsePayload?.error ?? "No se pudo encolar la operación");
      }
      const itemId =
        responsePayload?.item && typeof responsePayload.item.id === "string"
          ? responsePayload.item.id
          : undefined;

      setQueueMessage(
        `Operación en cola${itemId ? ` #${itemId.slice(0, 8)}` : ""} para ${payload.productIds.length.toLocaleString("es-CO")} producto(s).`,
      );
      setQueueError(null);
      await fetchQueue();

      return {
        ok: true,
        itemId,
      };
    },
    [fetchQueue],
  );

  const runQueueApply = useCallback(
    async (itemIds?: string[]) => {
      setQueueBusy(true);
      setQueueError(null);
      try {
        const res = await fetch("/api/admin/product-curation/queue/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemIds && itemIds.length > 0 ? { itemIds } : {}),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error ?? "No se pudo aplicar la cola");
        }

        const summary = payload?.summary && typeof payload.summary === "object"
          ? (payload.summary as Record<string, unknown>)
          : null;

        const applied = typeof summary?.applied === "number" ? summary.applied : 0;
        const failed = typeof summary?.failed === "number" ? summary.failed : 0;
        const total = typeof summary?.total === "number" ? summary.total : 0;

        setQueueMessage(
          `Run completado: ${applied.toLocaleString("es-CO")} aplicadas, ${failed.toLocaleString("es-CO")} con error, ${total.toLocaleString("es-CO")} total.`,
        );
        setSelectedQueueIds(new Set());

        await Promise.all([fetchQueue(), fetchFacets(), fetchPage(1, "reset")]);
      } catch (err) {
        console.warn(err);
        setQueueError(err instanceof Error ? err.message : "Error aplicando cola");
      } finally {
        setQueueBusy(false);
      }
    },
    [fetchFacets, fetchPage, fetchQueue],
  );

  const deleteQueueItems = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setQueueBusy(true);
      setQueueError(null);
      try {
        await Promise.all(
          ids.map(async (id) => {
            const res = await fetch(`/api/admin/product-curation/queue/${id}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const payload = await res.json().catch(() => ({}));
              throw new Error(payload?.error ?? "No se pudo eliminar operación de cola");
            }
          }),
        );

        setQueueMessage(`Se eliminaron ${ids.length.toLocaleString("es-CO")} operación(es) de la cola.`);
        setSelectedQueueIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        await fetchQueue();
      } catch (err) {
        console.warn(err);
        setQueueError(err instanceof Error ? err.message : "Error eliminando operaciones");
      } finally {
        setQueueBusy(false);
      }
    },
    [fetchQueue],
  );

  const duplicateQueueItem = useCallback(
    async (id: string) => {
      setQueueBusy(true);
      setQueueError(null);
      try {
        const res = await fetch(`/api/admin/product-curation/queue/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duplicate" }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error ?? "No se pudo duplicar operación");
        }
        setQueueMessage("Operación duplicada en cola.");
        await fetchQueue();
      } catch (err) {
        console.warn(err);
        setQueueError(err instanceof Error ? err.message : "Error duplicando operación");
      } finally {
        setQueueBusy(false);
      }
    },
    [fetchQueue],
  );

  const handleQuickEditorial = useCallback(
    async (product: CurationProduct, kind: "favorite" | "top_pick") => {
      if (queueBusy) return;
      const isCurrentKind =
        kind === "favorite"
          ? typeof product.editorialFavoriteRank === "number"
          : typeof product.editorialTopPickRank === "number";

      const actionLabel = kind === "favorite" ? "favorito" : "top pick";

      try {
        setQuickEditorialProductId(product.id);
        await enqueueOperation({
          productIds: [product.id],
          source: "quick_editorial",
          note: isCurrentKind
            ? `Quitar ${actionLabel} desde acción rápida`
            : `Asignar ${actionLabel} desde acción rápida`,
          searchKeySnapshot: searchKey,
          changes: [
            isCurrentKind
              ? { field: "editorialBadge", op: "clear", value: null }
              : { field: "editorialBadge", op: "replace", value: { kind } },
          ],
        });
      } catch (err) {
        console.warn(err);
        setQueueError(err instanceof Error ? err.message : "Error creando operación rápida");
      } finally {
        setQuickEditorialProductId(null);
      }
    },
    [enqueueOperation, queueBusy, searchKey],
  );

  const toggleQueueSelection = useCallback((id: string) => {
    setSelectedQueueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisibleQueue = useCallback(() => {
    const ids = visibleQueueItems.map((item) => item.id);
    setSelectedQueueIds(new Set(ids));
  }, [visibleQueueItems]);

  const clearQueueSelection = useCallback(() => setSelectedQueueIds(new Set()), []);

  const applySelectedQueue = useCallback(() => {
    const pendingIds = queueItems
      .filter((item) => selectedQueueIds.has(item.id) && item.status === "pending")
      .map((item) => item.id);
    if (pendingIds.length === 0) return;
    runQueueApply(pendingIds);
  }, [queueItems, runQueueApply, selectedQueueIds]);

  const applyAllQueue = useCallback(() => {
    runQueueApply();
  }, [runQueueApply]);

  const applySingleQueue = useCallback(
    (id: string) => {
      runQueueApply([id]);
    },
    [runQueueApply],
  );

  const deleteSelectedQueue = useCallback(() => {
    const ids = Array.from(selectedQueueIds);
    void deleteQueueItems(ids);
  }, [deleteQueueItems, selectedQueueIds]);

  const catalogThemeVars = useMemo(() => {
    const vars: CssVarStyle = {
      "--oda-ink": "#0f172a",
      "--oda-ink-soft": "#334155",
      "--oda-cream": "#f8fafc",
      "--oda-stone": "#f1f5f9",
      "--oda-taupe": "#64748b",
      "--oda-gold": "#e2e8f0",
      "--oda-border": "#e2e8f0",
    };
    return vars;
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div style={catalogThemeVars}>
        {facets ? (
          <CatalogFiltersPanel facets={facets} subcategories={subcategories} />
        ) : (
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            Cargando filtros…
          </aside>
        )}
      </div>

      <section className="space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Módulo de curación humana</p>
              <p className="mt-2 text-sm text-slate-600">
                {totalCount === null ? "—" : totalCount.toLocaleString("es-CO")} productos ·{" "}
                {loading ? "cargando…" : products.length.toLocaleString("es-CO")} en vista
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                disabled={loading || selectingAll || totalCount === 0}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                title="Abre composer para crear operaciones en cola."
              >
                Crear operación
              </button>
              <button
                type="button"
                onClick={applyAllQueue}
                disabled={queueBusy || pendingQueueItems.length === 0}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {queueBusy ? "Aplicando…" : `Aplicar pendientes (${pendingQueueItems.length.toLocaleString("es-CO")})`}
              </button>
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={loading || selectingAll}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {selectingAll ? "Seleccionando…" : "Seleccionar todos"}
              </button>
              <button
                type="button"
                onClick={() => fetchPage(1, "reset")}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Recargar
              </button>
              <button
                type="button"
                onClick={() => router.replace("/admin/product-curation", { scroll: false })}
                className="rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Limpiar filtros
              </button>
            </div>
          </div>
          {error ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {selectionBanner ? (
            <p
              className={classNames(
                "mt-4 rounded-xl border px-4 py-3 text-sm",
                selectionBanner.kind === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-700",
              )}
            >
              {selectionBanner.text}
            </p>
          ) : null}
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            {loading && products.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
                Cargando productos…
              </div>
            ) : products.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                <p className="text-lg font-semibold text-slate-900">No encontramos productos con esos filtros.</p>
                <p className="mt-2 text-sm text-slate-600">Ajusta filtros o limpia para ampliar resultados.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((product) => {
                  const selected = selectedIds.has(product.id);
                  const isFavorite = typeof product.editorialFavoriteRank === "number";
                  const isTopPick = typeof product.editorialTopPickRank === "number";
                  const quickBusy = quickEditorialProductId === product.id;

                  return (
                    <article
                      key={product.id}
                      className={classNames(
                        "relative overflow-hidden rounded-2xl border bg-white shadow-sm transition",
                        selected ? "border-slate-900 ring-2 ring-slate-900/10" : "border-slate-200",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSelection(product.id)}
                        className="absolute left-2 top-2 z-10 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm sm:left-3 sm:top-3 sm:px-3 sm:text-xs"
                      >
                        <span
                          className={classNames(
                            "h-3 w-3 rounded-[6px] border",
                            selected ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white",
                          )}
                          aria-hidden
                        />
                        {selected ? "Seleccionado" : "Seleccionar"}
                      </button>

                      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1 sm:right-3 sm:top-3">
                        {product.hasEnrichment ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-700 sm:px-3 sm:text-[10px]">
                            Enriquecido
                          </span>
                        ) : null}
                        {isFavorite ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[9px] font-semibold text-rose-700 sm:px-3 sm:text-[10px]">
                            ❤️ Favorito #{product.editorialFavoriteRank}
                          </span>
                        ) : null}
                        {isTopPick ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-800 sm:px-3 sm:text-[10px]">
                            👑 Top Pick #{product.editorialTopPickRank}
                          </span>
                        ) : null}
                      </div>

                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
                        {product.imageCoverUrl ? (
                          <Image
                            src={product.imageCoverUrl}
                            alt={product.name}
                            fill
                            className="object-cover object-center"
                            sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 50vw"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-400">
                            Sin imagen
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 p-3 sm:space-y-3 sm:p-5">
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 sm:text-xs">
                            {product.brandName}
                          </p>
                          <h3 className="text-xs font-semibold text-slate-900 line-clamp-2 sm:text-sm">
                            {product.name}
                          </h3>
                          <p className="text-[11px] text-slate-600 sm:text-xs">
                            {formatPriceRange(product.minPrice, product.maxPrice, product.currency)}
                            <span className="hidden sm:inline">
                              {" "}
                              · {product.inStockCount}/{product.variantCount} en stock
                            </span>
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2 text-[10px] sm:text-xs">
                          <button
                            type="button"
                            onClick={() => handleQuickEditorial(product, "favorite")}
                            disabled={quickBusy || queueBusy}
                            className={classNames(
                              "rounded-full border px-3 py-1 font-semibold disabled:opacity-50",
                              isFavorite
                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                : "border-slate-200 bg-white text-slate-700",
                            )}
                          >
                            {quickBusy ? "Guardando…" : isFavorite ? `❤️ Favorito #${product.editorialFavoriteRank}` : "♡ Favorito"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickEditorial(product, "top_pick")}
                            disabled={quickBusy || queueBusy}
                            className={classNames(
                              "rounded-full border px-3 py-1 font-semibold disabled:opacity-50",
                              isTopPick
                                ? "border-amber-300 bg-amber-50 text-amber-800"
                                : "border-slate-200 bg-white text-slate-700",
                            )}
                          >
                            {quickBusy ? "Guardando…" : isTopPick ? `👑 Top #${product.editorialTopPickRank}` : "👑 Top Pick"}
                          </button>
                        </div>

                        <div className="hidden gap-2 text-xs text-slate-700 sm:grid">
                          <p>
                            <span className="font-semibold text-slate-800">Categoría:</span>{" "}
                            {formatLabel(product.category, taxonomyOptions?.categoryLabels ?? {})}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Subcategoría:</span>{" "}
                            {formatLabel(product.subcategory, taxonomyOptions?.subcategoryLabels ?? {})}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Género:</span>{" "}
                            {formatLabel(product.gender, GENDER_LABELS)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Temporada:</span>{" "}
                            {formatLabel(product.season, SEASON_LABELS)}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Estilo:</span>{" "}
                            {formatStyleProfile(product.stylePrimary, taxonomyOptions?.styleProfileLabels)}
                          </p>
                        </div>

                        <div className="hidden flex-wrap items-center justify-between gap-2 text-xs sm:flex">
                          {product.sourceUrl ? (
                            <a
                              href={product.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700"
                            >
                              Ver fuente
                            </a>
                          ) : (
                            <span className="text-slate-400">Sin fuente</span>
                          )}
                          <span className="text-slate-400">
                            Actualizado: {new Date(product.updatedAt).toLocaleDateString("es-CO")}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div ref={sentinelRef} className="h-10" aria-hidden />

            {loadingMore ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600">
                Cargando más…
              </div>
            ) : !hasMore && products.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-500">
                No hay más resultados.
              </div>
            ) : null}
          </div>

          <CurationQueuePanel
            loading={queueLoading}
            busy={queueBusy}
            error={queueError}
            message={queueMessage}
            items={visibleQueueItems}
            summary={queueSummary}
            filter={queueFilter}
            selectedIds={selectedQueueIdList}
            conflictsById={queueConflicts}
            taxonomyOptions={taxonomyOptions}
            onRefresh={fetchQueue}
            onFilterChange={setQueueFilter}
            onToggleSelect={toggleQueueSelection}
            onSelectAllVisible={selectAllVisibleQueue}
            onClearSelection={clearQueueSelection}
            onApplyAll={applyAllQueue}
            onApplySelected={applySelectedQueue}
            onApplySingle={applySingleQueue}
            onDuplicate={(id) => {
              void duplicateQueueItem(id);
            }}
            onDeleteSingle={(id) => {
              void deleteQueueItems([id]);
            }}
            onDeleteSelected={deleteSelectedQueue}
          />
        </div>
      </section>

      {selectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{selectedCount}</span> seleccionado(s)
              <span className="ml-2 text-xs text-slate-400">(pueden no estar en la vista actual)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={selectingAll}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {selectingAll ? "Seleccionando…" : "Seleccionar todos"}
              </button>
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                disabled={selectingAll}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Programar cambios
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectingAll}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Limpiar selección
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <BulkEditModal
        open={bulkOpen}
        selectedCount={selectedCount}
        selectedIds={selectedIdList}
        categoriesFromFilters={filterCategoryKeys}
        searchKey={searchKey}
        taxonomyOptions={taxonomyOptions}
        onClose={() => setBulkOpen(false)}
        onQueue={enqueueOperation}
      />
    </div>
  );
}
