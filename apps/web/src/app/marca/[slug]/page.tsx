import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/catalog-filters";
import { resolveSearchParams } from "@/lib/catalog-filters";
import type { CatalogPlpContext } from "@/lib/catalog-plp";
import { prisma } from "@/lib/prisma";
import CatalogoView from "@/app/catalogo/CatalogoView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BrandRouteParams = { slug: string };

function isIndexableCatalog(params: URLSearchParams) {
  const disallowKeys = [
    "sort",
    "q",
    // locked: brandId (se evalúa aparte)
    "color",
    "material",
    "pattern",
    "price_min",
    "price_max",
    "price_range",
    "size",
    "fit",
    "occasion",
    "season",
    "style",
  ];
  return disallowKeys.every((key) => !params.has(key));
}

async function resolveBrandBySlug(slug: string) {
  const key = String(slug || "").trim();
  if (!key) return null;
  return prisma.brand.findUnique({
    where: { slug: key },
    select: { id: true, slug: true, name: true, description: true },
  });
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: BrandRouteParams | Promise<BrandRouteParams>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const slug = String(resolvedParams.slug || "").trim();
  if (!slug) notFound();

  const brand = await resolveBrandBySlug(slug);
  if (!brand) notFound();

  const merged = await resolveSearchParams(searchParams);
  const next = new URLSearchParams(merged.toString());
  next.delete("brandId");
  next.append("brandId", brand.id);

  const canonicalParams = new URLSearchParams(next.toString());
  canonicalParams.delete("page");
  if (canonicalParams.get("sort") === "new") canonicalParams.delete("sort");
  canonicalParams.delete("brandId");

  const query = canonicalParams.toString();
  const basePath = `/marca/${encodeURIComponent(brand.slug)}`;
  const canonical = query ? `${basePath}?${query}` : basePath;

  const title = `${brand.name} | ODA`;
  const description =
    (brand.description && brand.description.trim().length > 0
      ? brand.description.trim()
      : "Explora esta marca colombiana: catálogo curado con inventario disponible y enlaces a su tienda oficial.") ??
    "Explora esta marca colombiana en ODA.";

  const indexable = isIndexableCatalog(canonicalParams);

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function MarcaPage({
  params,
  searchParams,
}: {
  params: BrandRouteParams | Promise<BrandRouteParams>;
  searchParams: SearchParams;
}) {
  const resolvedParams = await params;
  const slug = String(resolvedParams.slug || "").trim();
  if (!slug) notFound();

  const brand = await resolveBrandBySlug(slug);
  if (!brand) notFound();

  const merged = await resolveSearchParams(searchParams);

  const plp: CatalogPlpContext = {
    title: brand.name,
    subtitle: "Explora lo más nuevo de esta marca.",
    lockedParams: new URLSearchParams({ brandId: brand.id }).toString(),
    lockedKeys: ["brandId"],
    hideFilters: { brand: true },
  };

  return CatalogoView({ searchParams: merged, plp });
}
