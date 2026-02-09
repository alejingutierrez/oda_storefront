import { redirect } from "next/navigation";
import CatalogoView from "@/app/catalogo/CatalogoView";
import {
  canonicalizeCatalogSearchParams,
  resolveSearchParams,
  type SearchParams,
} from "@/lib/catalog-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CatalogoPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await resolveSearchParams(searchParams);
  const canon = canonicalizeCatalogSearchParams(rawParams);
  if (canon.changed) {
    const query = canon.params.toString();
    redirect(query ? `/catalogo?${query}` : "/catalogo");
  }

  return CatalogoView({ searchParams: canon.params });
}
