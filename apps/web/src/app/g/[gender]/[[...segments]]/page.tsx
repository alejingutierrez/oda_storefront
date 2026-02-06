import type { SearchParams } from "@/lib/catalog-filters";
import { resolveSearchParams } from "@/lib/catalog-filters";
import { normalizeGender } from "@/lib/navigation";
import CatalogoPage from "@/app/catalogo/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GenderRouteParams = {
  gender: string;
  segments?: string[];
};

export default async function GenderCatalogPage({
  params,
  searchParams,
}: {
  params: GenderRouteParams | Promise<GenderRouteParams>;
  searchParams: SearchParams;
}) {
  const resolvedParams = await params;
  const gender = normalizeGender(resolvedParams.gender);
  const segments = Array.isArray(resolvedParams.segments) ? resolvedParams.segments : [];

  const merged = await resolveSearchParams(searchParams);
  const next = new URLSearchParams(merged.toString());

  // El path manda sobre los filtros: evita acumulaciones (e.g. /g/unisex + ?gender=femenino).
  next.delete("gender");
  next.delete("category");
  next.delete("subcategory");

  next.append("gender", gender);

  const category = segments[0]?.trim();
  const subcategory = segments[1]?.trim();

  if (category) next.append("category", category);
  if (subcategory) next.append("subcategory", subcategory);

  return CatalogoPage({ searchParams: next });
}

