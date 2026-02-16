import type { Metadata } from "next";
import type { SearchParams } from "@/lib/catalog-filters";
import { mapLegacyCategoryToCanonicalCategories, resolveSearchParams } from "@/lib/catalog-filters";
import { GENDER_ROUTE, labelize, labelizeSubcategory, normalizeGender } from "@/lib/navigation";
import type { CatalogPlpContext } from "@/lib/catalog-plp";
import CatalogoView from "@/app/catalogo/CatalogoView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GenderRouteParams = {
  gender: string;
  segments?: string[];
};

function humanizeKey(value: string) {
  const cleaned = String(value || "").trim().replace(/_/g, " ");
  if (!cleaned) return "";
  return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
}

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
  params,
  searchParams,
}: {
  params: GenderRouteParams | Promise<GenderRouteParams>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const genderLabel = normalizeGender(resolvedParams.gender);
  const segments = Array.isArray(resolvedParams.segments) ? resolvedParams.segments : [];

  const merged = await resolveSearchParams(searchParams);
  const next = new URLSearchParams(merged.toString());

  next.delete("gender");
  next.delete("category");
  next.delete("subcategory");
  next.append("gender", genderLabel);

  const rawCategory = segments[0]?.trim() ?? "";
  const rawSubcategory = segments[1]?.trim() ?? "";

  const category = rawCategory ? rawCategory.toLowerCase() : null;
  const subcategory = rawSubcategory ? rawSubcategory.toLowerCase() : null;

  const appendCategories = (values: string[]) => {
    for (const value of values) next.append("category", value);
  };

  const legacy = category ? mapLegacyCategoryToCanonicalCategories(category, subcategory ? [subcategory] : []) : null;
  if (legacy) {
    appendCategories(legacy);
  } else {
    if (rawCategory) next.append("category", rawCategory);
    if (rawSubcategory) next.append("subcategory", rawSubcategory);
  }

  // Canonical: el path ya representa género/categoría/subcategoría.
  const canonicalParams = new URLSearchParams(next.toString());
  canonicalParams.delete("page");
  if (canonicalParams.get("sort") === "new") canonicalParams.delete("sort");
  canonicalParams.delete("gender");
  canonicalParams.delete("category");
  canonicalParams.delete("subcategory");

  const safeSegments = segments
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
    .slice(0, 2);
  const basePath = `/g/${GENDER_ROUTE[genderLabel]}${safeSegments.length ? `/${safeSegments.join("/")}` : ""}`;
  const query = canonicalParams.toString();
  const canonical = query ? `${basePath}?${query}` : basePath;

  const title = rawSubcategory
    ? `${humanizeKey(rawSubcategory)} · ${humanizeKey(genderLabel)} | ODA`
    : rawCategory
      ? `${humanizeKey(rawCategory)} · ${humanizeKey(genderLabel)} | ODA`
      : `Catálogo ${humanizeKey(genderLabel)} | ODA`;

  const description =
    "Descubre moda colombiana curada: marcas locales con inventario disponible y enlaces directos a tiendas oficiales.";

  const indexable = isIndexableCatalog(canonicalParams);

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

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

  const rawCategory = segments[0]?.trim();
  const rawSubcategory = segments[1]?.trim();

  const category = rawCategory ? rawCategory.toLowerCase() : null;
  const subcategory = rawSubcategory ? rawSubcategory.toLowerCase() : null;

  const locked = new URLSearchParams();
  locked.append("gender", gender);

  const appendLockedCategories = (values: string[]) => {
    for (const value of values) locked.append("category", value);
  };

  // Back-compat: legacy URLs/categories (pre-taxonomy cleanup) should still work.
  // We map them to canonical category keys (and intentionally avoid mapping legacy "subcategories",
  // which were often coarse buckets like "tops/camisetas" rather than true taxonomy subcategories).
  const legacy = category ? mapLegacyCategoryToCanonicalCategories(category, subcategory ? [subcategory] : []) : null;

  if (legacy) {
    appendLockedCategories(legacy);
  } else {
    if (rawCategory) locked.append("category", rawCategory);
    if (rawSubcategory) locked.append("subcategory", rawSubcategory);
  }

  const rawCategoryLabel = rawCategory ? labelize(rawCategory) : "";
  const rawSubcategoryLabel = rawSubcategory ? labelizeSubcategory(rawSubcategory) : "";

  const plpTitle = rawSubcategory
    ? `${rawSubcategoryLabel} · ${gender}`
    : rawCategory
      ? `${rawCategoryLabel} · ${gender}`
      : `Catálogo ${gender}`;

  const plp: CatalogPlpContext = {
    title: plpTitle,
    subtitle: "Moda colombiana curada con inventario disponible.",
    lockedParams: locked.toString(),
    // En rutas /g/* el path manda y no permitimos que query intente re-definir estos filtros.
    lockedKeys: ["gender", "category", "subcategory"],
    hideFilters: { gender: true, category: Boolean(rawCategory) },
  };

  return CatalogoView({ searchParams: merged, plp });
}
