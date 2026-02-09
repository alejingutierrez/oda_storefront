import type { SearchParams } from "@/lib/catalog-filters";
import { mapLegacyCategoryToCanonicalCategories, resolveSearchParams } from "@/lib/catalog-filters";
import { normalizeGender } from "@/lib/navigation";
import CatalogoView from "@/app/catalogo/CatalogoView";

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

  const rawCategory = segments[0]?.trim();
  const rawSubcategory = segments[1]?.trim();

  const category = rawCategory ? rawCategory.toLowerCase() : null;
  const subcategory = rawSubcategory ? rawSubcategory.toLowerCase() : null;

  const appendCategories = (values: string[]) => {
    for (const value of values) next.append("category", value);
  };

  // Back-compat: legacy URLs/categories (pre-taxonomy cleanup) should still work.
  // We map them to canonical category keys (and intentionally avoid mapping legacy "subcategories",
  // which were often coarse buckets like "tops/camisetas" rather than true taxonomy subcategories).
  const legacy = category ? mapLegacyCategoryToCanonicalCategories(category, subcategory ? [subcategory] : []) : null;

  if (legacy) {
    appendCategories(legacy);
  } else {
    if (rawCategory) next.append("category", rawCategory);
    if (rawSubcategory) next.append("subcategory", rawSubcategory);
  }

  return CatalogoView({ searchParams: next });
}
