"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BrandOption = {
  id: string;
  name: string;
  productCount: number;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  gender: string | null;
  season: string | null;
  care: string | null;
  origin: string | null;
  status: string | null;
  sourceUrl: string | null;
  imageCoverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  brand: { id: string; name: string; logoUrl: string | null };
  variantCount: number;
  inStockCount: number;
  minPrice: number | null;
  maxPrice: number | null;
};

type ProductListResponse = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  products: ProductRow[];
};

type ProductDetail = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  gender: string | null;
  season: string | null;
  care: string | null;
  origin: string | null;
  status: string | null;
  sourceUrl: string | null;
  imageCoverUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  brand: { id: string; name: string; logoUrl: string | null };
  variants: Array<{
    id: string;
    sku: string | null;
    color: string | null;
    size: string | null;
    fit: string | null;
    material: string | null;
    price: number | string;
    currency: string;
    stock: number | null;
    stockStatus: string | null;
    images: string[];
    metadata: Record<string, unknown> | null;
  }>;
};

const PAGE_SIZE = 15;

const toText = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO");
};

const normalizeLink = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
};

const renderLink = (value: string | null, label?: string) => {
  const href = normalizeLink(value);
  if (!href) return "—";
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-slate-700 underline">
      {label ?? href}
    </a>
  );
};

const formatPriceRange = (minPrice: number | null, maxPrice: number | null) => {
  if (minPrice === null && maxPrice === null) return "—";
  if (minPrice !== null && maxPrice !== null && minPrice !== maxPrice) {
    return `${minPrice.toLocaleString("es-CO")} – ${maxPrice.toLocaleString("es-CO")} COP`;
  }
  const price = (minPrice ?? maxPrice ?? 0).toLocaleString("es-CO");
  return `${price} COP`;
};

const renderTags = (label: string, tags: string[]) => {
  if (!tags.length) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.slice(0, 6).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
};

export default function ProductDirectoryPanel() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/products/brands", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setBrands(payload.brands ?? []);
    } catch {
      setBrands([]);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (brandFilter) params.set("brandId", brandFilter);
      const res = await fetch(`/api/admin/products?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el catálogo");
      const payload: ProductListResponse = await res.json();
      setProducts(payload.products ?? []);
      setTotalPages(payload.totalPages ?? 1);
      setTotalCount(payload.totalCount ?? 0);
    } catch (error) {
      console.warn(error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [page, brandFilter]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    setPage(1);
  }, [brandFilter]);

  const openDetail = async (productId: string) => {
    setDetailId(productId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo cargar el detalle");
      const payload = await res.json();
      setDetail(payload.product ?? null);
    } catch (error) {
      console.warn(error);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
  };

  const pageNumbers = useMemo(() => {
    const pages = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let p = start; p <= end; p += 1) pages.push(p);
    return pages;
  }, [page, totalPages]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Directorio de productos</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Catálogo de productos scrapeados con sus atributos principales y variantes.
          </p>
        </div>
        <div className="min-w-[240px]">
          <label className="text-xs uppercase tracking-wide text-slate-500">Filtrar por marca</label>
          <select
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={brandFilter}
            onChange={(event) => setBrandFilter(event.target.value)}
          >
            <option value="">Todas las marcas</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name} ({brand.productCount})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
        <p>
          {totalCount.toLocaleString("es-CO")} productos · página {page} de {totalPages}
        </p>
        {loading && <span className="text-xs text-slate-400">Cargando…</span>}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {products.map((product) => (
          <article key={product.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
              {product.imageCoverUrl ? (
                <img src={product.imageCoverUrl} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-400">
                  Sin imagen
                </div>
              )}
              <div className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700">
                {product.brand.name}
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{product.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {product.category ?? "—"} {product.subcategory ? `· ${product.subcategory}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openDetail(product.id)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                >
                  Ver más
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>Precio: {formatPriceRange(product.minPrice, product.maxPrice)}</span>
                <span>
                  Variantes: {product.variantCount} · Stock: {product.inStockCount}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {product.status && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{product.status}</span>
                )}
                {product.gender && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{product.gender}</span>
                )}
                {product.season && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{product.season}</span>
                )}
              </div>
              {renderTags("Tags estilo", product.styleTags)}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-600">
        <p>
          Mostrando {products.length} de {totalCount.toLocaleString("es-CO")}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Anterior
          </button>
          {pageNumbers.map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => setPage(number)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                number === page
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              {number}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>

      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Detalle de producto</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">
                  {detail?.name ?? "Producto"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
              {detailLoading ? (
                <p className="text-sm text-slate-500">Cargando detalle...</p>
              ) : detail ? (
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Identidad</p>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <p>
                          <span className="font-semibold text-slate-800">Marca:</span>{" "}
                          {detail.brand.name}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Nombre:</span>{" "}
                          {detail.name}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Fuente:</span>{" "}
                          {renderLink(detail.sourceUrl, "Ver producto")}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Estado:</span>{" "}
                          {toText(detail.status)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Actualizado:</span>{" "}
                          {formatDate(detail.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Clasificación</p>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <p>
                          <span className="font-semibold text-slate-800">Categoría:</span>{" "}
                          {toText(detail.category)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Subcategoría:</span>{" "}
                          {toText(detail.subcategory)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Género:</span>{" "}
                          {toText(detail.gender)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Temporada:</span>{" "}
                          {toText(detail.season)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Cuidado:</span>{" "}
                          {toText(detail.care)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Origen:</span>{" "}
                          {toText(detail.origin)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Descripción</p>
                      <p className="mt-3 text-sm text-slate-700">{toText(detail.description)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Tags</p>
                      <div className="mt-3 space-y-3 text-sm text-slate-700">
                        {renderTags("Estilo", detail.styleTags)}
                        {renderTags("Material", detail.materialTags)}
                        {renderTags("Patrón", detail.patternTags)}
                        {renderTags("Ocasión", detail.occasionTags)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Variantes</p>
                    <div className="mt-3 max-h-[260px] overflow-y-auto text-sm text-slate-700">
                      {detail.variants.length ? (
                        <div className="space-y-2">
                          {detail.variants.map((variant) => (
                            <div
                              key={variant.id}
                              className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-2"
                            >
                              <div>
                                <p className="font-semibold text-slate-800">
                                  {variant.color ?? "—"} {variant.size ? `· ${variant.size}` : ""}
                                </p>
                                <p className="text-xs text-slate-500">
                                  SKU: {variant.sku ?? "—"} · Stock: {variant.stockStatus ?? "—"}
                                </p>
                              </div>
                              <div className="text-right text-sm font-semibold text-slate-800">
                                {typeof variant.price === "number"
                                  ? `${variant.price.toLocaleString("es-CO")} ${variant.currency}`
                                  : `${variant.price} ${variant.currency}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">Sin variantes registradas.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Metadata</p>
                    <pre className="mt-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap text-xs text-slate-600">
                      {toText(detail.metadata)}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No se pudo cargar el detalle.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
