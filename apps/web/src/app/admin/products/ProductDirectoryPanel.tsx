"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  SUBCATEGORY_LABELS,
  SEASON_LABELS,
  GENDER_LABELS,
  FIT_LABELS,
  STYLE_TAG_FRIENDLY,
  MATERIAL_TAG_FRIENDLY,
  PATTERN_TAG_FRIENDLY,
  OCCASION_TAG_FRIENDLY,
} from "@/lib/product-enrichment/constants";

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
  currency: string | null;
  imageCoverUrl: string | null;
  imageGallery: string[];
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
  currency: string | null;
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
    colorPantone: string | null;
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
const MAX_GALLERY_IMAGES = 8;

const COLOR_SWATCHES: Record<string, string> = {
  blanco: "#f8fafc",
  negro: "#0f172a",
  gris: "#94a3b8",
  "gris claro": "#cbd5e1",
  "gris oscuro": "#475569",
  rojo: "#dc2626",
  azul: "#2563eb",
  "azul oscuro": "#1e3a8a",
  "azul marino": "#1e3a8a",
  verde: "#16a34a",
  "verde militar": "#4d7c0f",
  "verde oliva": "#6b8e23",
  rosado: "#f472b6",
  "rosado claro": "#fbcfe8",
  "palo de rosa": "#b76e79",
  vino: "#7f1d1d",
  beige: "#f5f5dc",
  marfil: "#fffff0",
  crudo: "#f8f5e6",
  piel: "#f2c9ac",
  cafe: "#7c2d12",
  marron: "#7c2d12",
  mostaza: "#d97706",
  amarillo: "#facc15",
  naranja: "#f97316",
};

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

const getColorHex = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^#([0-9a-f]{3}){1,2}$/i.test(trimmed)) return trimmed;
  const normalized = trimmed.toLowerCase();
  if (COLOR_SWATCHES[normalized]) return COLOR_SWATCHES[normalized];
  if (normalized.includes("azul")) return COLOR_SWATCHES.azul;
  if (normalized.includes("rojo")) return COLOR_SWATCHES.rojo;
  if (normalized.includes("verde")) return COLOR_SWATCHES.verde;
  if (normalized.includes("gris")) return COLOR_SWATCHES.gris;
  if (normalized.includes("negro")) return COLOR_SWATCHES.negro;
  if (normalized.includes("blanco")) return COLOR_SWATCHES.blanco;
  if (normalized.includes("rosado")) return COLOR_SWATCHES.rosado;
  if (normalized.includes("beige")) return COLOR_SWATCHES.beige;
  return null;
};

const collectUnique = (values: Array<string | null | undefined>) => {
  const set = new Set<string>();
  values.forEach((value) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    set.add(trimmed);
  });
  return Array.from(set);
};

const buildGallery = (product: ProductRow) => {
  const urls = [product.imageCoverUrl, ...product.imageGallery].filter(Boolean) as string[];
  const unique = Array.from(new Set(urls));
  return unique.slice(0, MAX_GALLERY_IMAGES);
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

const formatPriceRange = (minPrice: number | null, maxPrice: number | null, currency: string | null) => {
  const currencyLabel = currency ?? "COP";
  if (minPrice === null && maxPrice === null) return "—";
  if (minPrice !== null && maxPrice !== null && minPrice !== maxPrice) {
    return `${minPrice.toLocaleString("es-CO")} – ${maxPrice.toLocaleString("es-CO")} ${currencyLabel}`;
  }
  const price = (minPrice ?? maxPrice ?? 0).toLocaleString("es-CO");
  return `${price} ${currencyLabel}`;
};

const renderFriendlyTags = (
  label: string,
  tags: string[],
  map: Record<string, string>,
) => {
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
            {map[tag] ?? tag}
          </span>
        ))}
      </div>
    </div>
  );
};

const formatLabel = (value: string | null, map: Record<string, string>) => {
  if (!value) return "—";
  return map[value] ?? value;
};

const ColorSwatch = ({
  color,
  sizeClass = "h-4 w-4",
  labelClass = "text-sm text-slate-700",
}: {
  color: string | null;
  sizeClass?: string;
  labelClass?: string;
}) => {
  const hex = getColorHex(color);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex ${sizeClass} rounded-full border border-slate-200 shadow-sm ${
          hex ? "" : "bg-gradient-to-br from-slate-200 via-slate-300 to-slate-100"
        }`}
        style={hex ? { backgroundColor: hex } : undefined}
        aria-hidden
      />
      <span className={labelClass}>{color ?? "—"}</span>
    </span>
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
  const [imageIndexByProduct, setImageIndexByProduct] = useState<Record<string, number>>({});

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

  useEffect(() => {
    setImageIndexByProduct({});
  }, [products]);

  const variantSummary = useMemo(() => {
    if (!detail) return null;
    const colors = collectUnique(detail.variants.map((variant) => variant.color));
    const sizes = collectUnique(detail.variants.map((variant) => variant.size));
    const fits = collectUnique(detail.variants.map((variant) => variant.fit));
    const materials = collectUnique(detail.variants.map((variant) => variant.material));
    let minPrice: number | null = null;
    let maxPrice: number | null = null;
    let currency = detail.currency ?? null;
    let inStock = 0;
    detail.variants.forEach((variant) => {
      const numericPrice = typeof variant.price === "number" ? variant.price : Number(variant.price);
      if (Number.isFinite(numericPrice)) {
        minPrice = minPrice === null ? numericPrice : Math.min(minPrice, numericPrice);
        maxPrice = maxPrice === null ? numericPrice : Math.max(maxPrice, numericPrice);
      }
      if (!currency && variant.currency) currency = variant.currency;
      if (variant.stockStatus === "in_stock" || (typeof variant.stock === "number" && variant.stock > 0)) {
        inStock += 1;
      }
    });
    return {
      colors,
      sizes,
      fits,
      materials,
      minPrice,
      maxPrice,
      currency,
      totalVariants: detail.variants.length,
      inStock,
    };
  }, [detail]);

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
        {products.map((product) => {
          const gallery = buildGallery(product);
          const currentIndex = gallery.length
            ? (imageIndexByProduct[product.id] ?? 0) % gallery.length
            : 0;
          const currentImage = gallery[currentIndex];
          const showControls = gallery.length > 1;
          const handlePrev = () => {
            if (!gallery.length) return;
            setImageIndexByProduct((prev) => {
              const prevIndex = prev[product.id] ?? 0;
              const nextIndex = (prevIndex - 1 + gallery.length) % gallery.length;
              return { ...prev, [product.id]: nextIndex };
            });
          };
          const handleNext = () => {
            if (!gallery.length) return;
            setImageIndexByProduct((prev) => {
              const prevIndex = prev[product.id] ?? 0;
              const nextIndex = (prevIndex + 1) % gallery.length;
              return { ...prev, [product.id]: nextIndex };
            });
          };

          return (
            <article key={product.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                {currentImage ? (
                  <img src={currentImage} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-400">
                    Sin imagen
                  </div>
                )}
                {showControls && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrev}
                      aria-label="Imagen anterior"
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-white/80 p-1 text-xs font-semibold text-slate-700 shadow-sm"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      aria-label="Imagen siguiente"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-white/80 p-1 text-xs font-semibold text-slate-700 shadow-sm"
                    >
                      ›
                    </button>
                    <div className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {currentIndex + 1}/{gallery.length}
                    </div>
                  </>
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
                    {formatLabel(product.category, CATEGORY_LABELS)}{" "}
                    {product.subcategory ? `· ${formatLabel(product.subcategory, SUBCATEGORY_LABELS)}` : ""}
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
                <span>Precio: {formatPriceRange(product.minPrice, product.maxPrice, product.currency)}</span>
                <span>
                  Variantes: {product.variantCount} · Stock: {product.inStockCount}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {product.status && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{product.status}</span>
                )}
                {product.gender && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                    {formatLabel(product.gender, GENDER_LABELS)}
                  </span>
                )}
                {product.season && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                    {formatLabel(product.season, SEASON_LABELS)}
                  </span>
                )}
              </div>
              {renderFriendlyTags("Tags estilo", product.styleTags, STYLE_TAG_FRIENDLY)}
            </div>
          </article>
        );
        })}
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
                          {formatLabel(detail.category, CATEGORY_LABELS)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Subcategoría:</span>{" "}
                          {formatLabel(detail.subcategory, SUBCATEGORY_LABELS)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Género:</span>{" "}
                          {formatLabel(detail.gender, GENDER_LABELS)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-800">Temporada:</span>{" "}
                          {formatLabel(detail.season, SEASON_LABELS)}
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

                  {variantSummary && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        Variantes y disponibilidad
                      </p>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Precio</p>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatPriceRange(
                              variantSummary.minPrice,
                              variantSummary.maxPrice,
                              variantSummary.currency,
                            )}
                          </p>
                          <p className="text-xs text-slate-500">
                            {variantSummary.inStock} en stock de {variantSummary.totalVariants} variantes
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Tallas</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {variantSummary.sizes.length ? (
                              variantSummary.sizes.slice(0, 10).map((size) => (
                                <span
                                  key={size}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600"
                                >
                                  {size}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Colores</p>
                          <div className="mt-2 flex flex-wrap gap-3">
                            {variantSummary.colors.length ? (
                              variantSummary.colors.slice(0, 12).map((color) => (
                                <span
                                  key={color}
                                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1"
                                >
                                  <ColorSwatch
                                    color={color}
                                    sizeClass="h-3 w-3"
                                    labelClass="text-xs font-semibold text-slate-600"
                                  />
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Fit</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {variantSummary.fits.length ? (
                              variantSummary.fits.slice(0, 8).map((fit) => (
                                <span
                                  key={fit}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600"
                                >
                                  {formatLabel(fit, FIT_LABELS)}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Material variante</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {variantSummary.materials.length ? (
                              variantSummary.materials.slice(0, 8).map((material) => (
                                <span
                                  key={material}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600"
                                >
                                  {material}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Descripción</p>
                      <p className="mt-3 text-sm text-slate-700">{toText(detail.description)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Tags</p>
                      <div className="mt-3 space-y-3 text-sm text-slate-700">
                        {renderFriendlyTags("Estilo", detail.styleTags, STYLE_TAG_FRIENDLY)}
                        {renderFriendlyTags("Material", detail.materialTags, MATERIAL_TAG_FRIENDLY)}
                        {renderFriendlyTags("Patrón", detail.patternTags, PATTERN_TAG_FRIENDLY)}
                        {renderFriendlyTags("Ocasión", detail.occasionTags, OCCASION_TAG_FRIENDLY)}
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
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                  <ColorSwatch
                                    color={variant.color}
                                    sizeClass="h-3 w-3"
                                    labelClass="text-sm font-semibold text-slate-800"
                                  />
                                  {variant.size ? (
                                    <span className="text-xs text-slate-500">· {variant.size}</span>
                                  ) : null}
                                </div>
                                <p className="text-xs text-slate-500">
                                  SKU: {variant.sku ?? "—"} · Stock: {variant.stockStatus ?? "—"}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Fit: {variant.fit ? formatLabel(variant.fit, FIT_LABELS) : "—"} · Material:{" "}
                                  {variant.material ?? "—"} · Pantone: {variant.colorPantone ?? "—"}
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
