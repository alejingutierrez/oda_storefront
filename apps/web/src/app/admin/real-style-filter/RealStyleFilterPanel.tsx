"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/image-proxy";
import { REAL_STYLE_OPTIONS } from "@/lib/real-style/constants";
import type { RealStyleKey } from "@/lib/real-style/constants";

/* ── Types ── */

type Product = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brandName: string;
  category: string | null;
  realStyle: string;
  editorialFavoriteRank: number | null;
  editorialTopPickRank: number | null;
  sourceUrl: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string;
};

type ProductsResponse = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  items: Product[];
};

type BadgeAction = "set_top_pick" | "set_favorite" | "clear";

/* ── Helpers ── */

const formatPrice = (value: string | null) => {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(num);
};

/* ── Component ── */

export default function RealStyleFilterPanel() {
  const [selectedStyle, setSelectedStyle] = useState<RealStyleKey | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [topPicks, setTopPicks] = useState<Product[]>([]);
  const [favorites, setFavorites] = useState<Product[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  /* ── Fetch products ── */

  const fetchProducts = useCallback(
    async (realStyle: RealStyleKey, pageNum: number, q: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          realStyle,
          page: String(pageNum),
          pageSize: "36",
        });
        if (q) params.set("q", q);

        const res = await fetch(`/api/admin/real-style-filter/products?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: ProductsResponse = await res.json();

        setProducts(data.items);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);

        // Extract ranked lists from all products in this response
        // For the ranked sidebar, we need to track them separately
        updateRankedLists(data.items);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const updateRankedLists = (items: Product[]) => {
    setTopPicks(
      items
        .filter((p) => p.editorialTopPickRank !== null)
        .sort((a, b) => (a.editorialTopPickRank ?? 0) - (b.editorialTopPickRank ?? 0)),
    );
    setFavorites(
      items
        .filter((p) => p.editorialFavoriteRank !== null)
        .sort((a, b) => (a.editorialFavoriteRank ?? 0) - (b.editorialFavoriteRank ?? 0)),
    );
  };

  /* ── Re-fetch when style / page / search changes ── */

  useEffect(() => {
    if (!selectedStyle) return;
    fetchProducts(selectedStyle, page, searchQuery);
  }, [selectedStyle, page, searchQuery, fetchProducts]);

  /* ── Apply badge ── */

  const applyBadge = useCallback(
    async (productIds: string[], action: BadgeAction, startPriority?: number | null) => {
      if (!selectedStyle) return;
      setSavingId(productIds[0] ?? null);
      setError(null);

      try {
        const res = await fetch("/api/admin/real-style-filter/badge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds,
            action,
            ...(startPriority != null ? { startPriority } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Error ${res.status}`);
        }

        // Refetch products to get updated ranks
        await fetchProducts(selectedStyle, page, searchQuery);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSavingId(null);
      }
    },
    [selectedStyle, page, searchQuery, fetchProducts],
  );

  const handleToggleBadge = useCallback(
    (product: Product, action: BadgeAction) => {
      // If the product already has this badge, clear it
      if (action === "set_top_pick" && product.editorialTopPickRank !== null) {
        applyBadge([product.id], "clear");
      } else if (action === "set_favorite" && product.editorialFavoriteRank !== null) {
        applyBadge([product.id], "clear");
      } else {
        applyBadge([product.id], action);
      }
    },
    [applyBadge],
  );

  /* ── Move rank ── */

  const handleMoveRank = useCallback(
    (product: Product, direction: "up" | "down", listType: "top_pick" | "favorite") => {
      const list = listType === "top_pick" ? topPicks : favorites;
      const idx = list.findIndex((p: Product) => p.id === product.id);
      if (idx === -1) return;

      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= list.length) return;

      // The rank we want to insert at is the rank of the item at newIdx
      const targetRank =
        listType === "top_pick"
          ? list[newIdx]?.editorialTopPickRank
          : list[newIdx]?.editorialFavoriteRank;

      if (targetRank == null) return;

      const action: BadgeAction = listType === "top_pick" ? "set_top_pick" : "set_favorite";
      applyBadge([product.id], action, targetRank);
    },
    [topPicks, favorites, applyBadge],
  );

  const handleRemoveFromList = useCallback(
    (productId: string) => {
      applyBadge([productId], "clear");
    },
    [applyBadge],
  );

  /* ── Style selector ── */

  const handleSelectStyle = (key: RealStyleKey) => {
    setSelectedStyle(key);
    setPage(1);
    setSearchQuery("");
    setProducts([]);
    setTopPicks([]);
    setFavorites([]);
  };

  /* ── Render ── */

  return (
    <div className="space-y-6">
      {/* ── Category selector ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Categoría Real Style
        </p>
        <div className="flex flex-wrap gap-2">
          {REAL_STYLE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => handleSelectStyle(option.key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                selectedStyle === option.key
                  ? "bg-slate-900 text-white shadow-md"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!selectedStyle && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-400">Selecciona una categoría Real Style para ver los productos</p>
        </div>
      )}

      {selectedStyle && (
        <>
          {/* ── Search bar ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
              <input
                type="text"
                placeholder="Buscar por nombre o marca..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <span className="text-sm text-slate-500">
                {totalCount} producto{totalCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {/* ── Main layout: grid + sidebar ── */}
          <div className="flex flex-col gap-6 xl:flex-row">
            {/* ── Product grid ── */}
            <div className="min-w-0 flex-1">
              {loading && products.length === 0 ? (
                <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 shadow-sm">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
                </div>
              ) : products.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                  <p className="text-slate-400">No se encontraron productos</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        saving={savingId === product.id}
                        onToggleBadge={handleToggleBadge}
                      />
                    ))}
                  </div>

                  {/* ── Pagination ── */}
                  {totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                      >
                        Anterior
                      </button>
                      <span className="text-sm text-slate-500">
                        {page} / {totalPages}
                      </span>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                      >
                        Siguiente
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Ranked lists sidebar ── */}
            <div className="w-full shrink-0 space-y-4 xl:w-80">
              <RankedListSection
                title="Top Picks"
                colorScheme="indigo"
                items={topPicks}
                rankKey="editorialTopPickRank"
                listType="top_pick"
                onMoveRank={handleMoveRank}
                onRemove={handleRemoveFromList}
                savingId={savingId}
              />
              <RankedListSection
                title="Favoritos"
                colorScheme="amber"
                items={favorites}
                rankKey="editorialFavoriteRank"
                listType="favorite"
                onMoveRank={handleMoveRank}
                onRemove={handleRemoveFromList}
                savingId={savingId}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Product Card ── */

function ProductCard({
  product,
  saving,
  onToggleBadge,
}: {
  product: Product;
  saving: boolean;
  onToggleBadge: (product: Product, action: BadgeAction) => void;
}) {
  const coverUrl =
    proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" }) ??
    product.imageCoverUrl;

  const isTopPick = product.editorialTopPickRank !== null;
  const isFavorite = product.editorialFavoriteRank !== null;

  const priceDisplay = formatPrice(product.minPrice);
  const maxPriceDisplay = formatPrice(product.maxPrice);
  const priceRange =
    priceDisplay && maxPriceDisplay && priceDisplay !== maxPriceDisplay
      ? `${priceDisplay} - ${maxPriceDisplay}`
      : priceDisplay;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      {/* ── Image ── */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}

        {/* ── Badge pill ── */}
        {isTopPick && (
          <span className="absolute left-2 top-2 rounded-lg bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white shadow">
            Top Pick #{product.editorialTopPickRank}
          </span>
        )}
        {isFavorite && (
          <span className="absolute left-2 top-2 rounded-lg bg-amber-500 px-2 py-0.5 text-xs font-bold text-white shadow">
            Favorito #{product.editorialFavoriteRank}
          </span>
        )}
      </div>

      {/* ── Info ── */}
      <div className="p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {product.brandName}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs font-medium text-slate-700">{product.name}</p>
        {priceRange && <p className="mt-1 text-xs font-semibold text-slate-900">{priceRange}</p>}
        {product.category && (
          <p className="mt-0.5 text-[10px] text-slate-400">{product.category}</p>
        )}
      </div>

      {/* ── Action buttons ── */}
      <div className="flex border-t border-slate-100">
        <button
          type="button"
          disabled={saving}
          onClick={() => onToggleBadge(product, "set_top_pick")}
          className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-semibold transition ${
            isTopPick
              ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              : "text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
          } ${saving ? "opacity-50" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isTopPick ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Top Pick
        </button>
        <div className="w-px bg-slate-100" />
        <button
          type="button"
          disabled={saving}
          onClick={() => onToggleBadge(product, "set_favorite")}
          className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-semibold transition ${
            isFavorite
              ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "text-slate-500 hover:bg-slate-50 hover:text-amber-600"
          } ${saving ? "opacity-50" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          Favorito
        </button>
      </div>
    </div>
  );
}

/* ── Ranked List Section ── */

function RankedListSection({
  title,
  colorScheme,
  items,
  rankKey,
  listType,
  onMoveRank,
  onRemove,
  savingId,
}: {
  title: string;
  colorScheme: "indigo" | "amber";
  items: Product[];
  rankKey: "editorialTopPickRank" | "editorialFavoriteRank";
  listType: "top_pick" | "favorite";
  onMoveRank: (product: Product, direction: "up" | "down", listType: "top_pick" | "favorite") => void;
  onRemove: (productId: string) => void;
  savingId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const pillBg = colorScheme === "indigo" ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700";
  const headerBorder = colorScheme === "indigo" ? "border-indigo-200" : "border-amber-200";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((v: boolean) => !v)}
        className={`flex w-full items-center justify-between border-b ${headerBorder} px-4 py-3`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${pillBg}`}>{items.length}</span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-slate-400 transition ${collapsed ? "" : "rotate-180"}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && (
        <div className="max-h-[50vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              Sin productos asignados
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((product, idx) => {
                const rank = product[rankKey];
                const coverUrl =
                  proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" }) ??
                  product.imageCoverUrl;
                const isSaving = savingId === product.id;

                return (
                  <li
                    key={product.id}
                    className={`flex items-center gap-3 px-3 py-2 ${isSaving ? "opacity-50" : ""}`}
                  >
                    {/* Rank number */}
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${pillBg}`}>
                      {rank}
                    </span>

                    {/* Thumbnail */}
                    <div className="relative h-10 w-8 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {coverUrl ? (
                        <Image src={coverUrl} alt="" fill className="object-cover" sizes="32px" />
                      ) : null}
                    </div>

                    {/* Name + brand */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-700">{product.name}</p>
                      <p className="truncate text-[10px] text-slate-400">{product.brandName}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0 || isSaving}
                        onClick={() => onMoveRank(product, "up", listType)}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                        title="Subir"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={idx === items.length - 1 || isSaving}
                        onClick={() => onMoveRank(product, "down", listType)}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                        title="Bajar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => onRemove(product.id)}
                        className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"
                        title="Quitar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
