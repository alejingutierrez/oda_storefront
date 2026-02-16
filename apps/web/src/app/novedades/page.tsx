import type { Metadata } from "next";
import type { SearchParams } from "@/lib/catalog-filters";
import { canonicalizeCatalogSearchParams, resolveSearchParams } from "@/lib/catalog-filters";
import type { CatalogPlpContext } from "@/lib/catalog-plp";
import CatalogoView from "@/app/catalogo/CatalogoView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isIndexableCatalog(params: URLSearchParams) {
  const disallowKeys = [
    "sort",
    "q",
    "brandId",
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const rawParams = await resolveSearchParams(searchParams);
  const canon = canonicalizeCatalogSearchParams(rawParams);
  const params = new URLSearchParams(canon.params.toString());

  // Evita URLs duplicadas por defaults UI.
  params.delete("page");
  if (params.get("sort") === "new") params.delete("sort");

  const query = params.toString();
  const canonical = query ? `/novedades?${query}` : "/novedades";

  const title = "Novedades | ODA";
  const description =
    "Novedades del catálogo: moda colombiana curada con inventario disponible y enlaces directos a tiendas oficiales.";

  const indexable = isIndexableCatalog(params);

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function NovedadesPage({ searchParams }: { searchParams: SearchParams }) {
  const plp: CatalogPlpContext = {
    title: "Novedades",
    subtitle: "Lo más nuevo del catálogo, actualizado continuamente.",
    lockedParams: "",
    lockedKeys: [],
  };
  return CatalogoView({ searchParams, plp });
}

