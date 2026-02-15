import type { Metadata } from "next";
import type { SearchParams } from "@/lib/catalog-filters";
import CatalogoView from "@/app/catalogo/CatalogoView";
import { canonicalizeCatalogSearchParams, resolveSearchParams } from "@/lib/catalog-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const rawParams = await resolveSearchParams(searchParams);
  const canon = canonicalizeCatalogSearchParams(rawParams);
  const params = new URLSearchParams(canon.params.toString());
  params.delete("page");
  if (params.get("sort") === "new") params.delete("sort");
  const query = params.toString();
  const canonical = query ? `/catalogo?${query}` : "/catalogo";

  return {
    title: "Buscar | ODA",
    description: "Explora el catálogo de moda colombiana en ODA.",
    alternates: { canonical },
    // Legacy alias: preferimos que indexe /catalogo.
    robots: { index: false, follow: true },
  };
}

export default async function BuscarPage({ searchParams }: { searchParams: SearchParams }) {
  // Alias a `/catalogo` para mantener links legacy (`/buscar`) sin 404 ni errores de prefetch.
  return CatalogoView({ searchParams });
}
