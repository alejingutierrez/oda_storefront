import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/catalog-filters";
import { mapLegacyCategoryToCanonicalCategories, resolveSearchParams } from "@/lib/catalog-filters";
import { safeGetPlpSeoPageByPath } from "@/lib/plp-seo/store";
import { GENDER_ROUTE, labelize, labelizeSubcategory, normalizeGender } from "@/lib/navigation";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";
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
    "price_change",
    "size",
    "fit",
    "occasion",
    "season",
    "style",
  ];
  return disallowKeys.every((key) => !params.has(key));
}

function isAllowedGenderSlug(value: string) {
  const slug = String(value || "").trim().toLowerCase();
  return slug === "femenino" || slug === "masculino" || slug === "unisex" || slug === "infantil";
}

function buildFallbackMetaDescription(params: {
  genderLabel: string;
  categoryLabel?: string | null;
  subcategoryLabel?: string | null;
  categoryDescription?: string | null;
  subcategoryDescription?: string | null;
}) {
  const gender = String(params.genderLabel || "").trim().toLowerCase();
  const categoryLabel = params.categoryLabel?.trim() || null;
  const subcategoryLabel = params.subcategoryLabel?.trim() || null;
  const categoryDescription = params.categoryDescription?.trim() || null;
  const subcategoryDescription = params.subcategoryDescription?.trim() || null;

  if (subcategoryLabel) {
    return `${subcategoryDescription ? `${subcategoryDescription} ` : ""}Explora ${subcategoryLabel.toLowerCase()} en moda colombiana ${gender}: marcas locales, inventario disponible y enlaces directos a tiendas oficiales.`;
  }
  if (categoryLabel) {
    return `${categoryDescription ? `${categoryDescription} ` : ""}Explora ${categoryLabel.toLowerCase()} ${gender} de moda colombiana: marcas locales, inventario disponible y enlaces directos a tiendas oficiales.`;
  }
  return `Explora moda colombiana ${gender}: prendas y accesorios de marcas locales, inventario disponible y enlaces directos a tiendas oficiales.`;
}

function buildFallbackSubtitle(params: {
  genderLabel: string;
  categoryLabel?: string | null;
  subcategoryLabel?: string | null;
  categoryDescription?: string | null;
  subcategoryDescription?: string | null;
}) {
  const gender = String(params.genderLabel || "").trim().toLowerCase();
  const categoryLabel = params.categoryLabel?.trim() || null;
  const subcategoryLabel = params.subcategoryLabel?.trim() || null;
  const categoryDescription = params.categoryDescription?.trim() || null;
  const subcategoryDescription = params.subcategoryDescription?.trim() || null;

  if (subcategoryLabel) {
    return `${subcategoryDescription ? `${subcategoryDescription} ` : ""}${subcategoryLabel} en moda colombiana ${gender}. Marcas locales, inventario disponible y enlaces directos a tiendas oficiales.`;
  }
  if (categoryLabel) {
    return `${categoryDescription ? `${categoryDescription} ` : ""}${categoryLabel} en moda colombiana ${gender}. Marcas locales, inventario disponible y enlaces directos a tiendas oficiales.`;
  }
  return `Moda colombiana ${gender} para descubrir. Marcas locales, inventario disponible y enlaces directos a tiendas oficiales.`;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: GenderRouteParams | Promise<GenderRouteParams>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const resolvedParams = await params;
  if (!isAllowedGenderSlug(resolvedParams.gender)) notFound();

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
  const basePath = `/${GENDER_ROUTE[genderLabel]}${safeSegments.length ? `/${safeSegments.join("/")}` : ""}`;
  const canonical = basePath;

  const taxonomy = await getPublishedTaxonomyOptions();
  const categoryLookupKey = (rawCategory && taxonomy.categoryLabels[rawCategory] ? rawCategory : legacy?.[0]) ?? rawCategory;
  const resolvedCategoryLabel = categoryLookupKey
    ? taxonomy.categoryLabels[categoryLookupKey] ?? labelize(categoryLookupKey)
    : null;
  const resolvedSubcategoryLabel = rawSubcategory
    ? taxonomy.subcategoryLabels[rawSubcategory] ?? labelizeSubcategory(rawSubcategory)
    : null;
  const resolvedCategoryDescription = categoryLookupKey
    ? taxonomy.categoryDescriptions?.[categoryLookupKey] ?? null
    : null;
  const resolvedSubcategoryDescription = rawSubcategory
    ? taxonomy.subcategoryDescriptions?.[rawSubcategory] ?? null
    : null;
  const defaultTitle = resolvedSubcategoryLabel
    ? `${resolvedSubcategoryLabel} · ${humanizeKey(genderLabel)} | ODA`
    : resolvedCategoryLabel
      ? `${resolvedCategoryLabel} · ${humanizeKey(genderLabel)} | ODA`
      : `Catálogo ${humanizeKey(genderLabel)} | ODA`;

  const defaultDescription = buildFallbackMetaDescription({
    genderLabel,
    categoryLabel: resolvedCategoryLabel,
    subcategoryLabel: resolvedSubcategoryLabel,
    categoryDescription: resolvedCategoryDescription,
    subcategoryDescription: resolvedSubcategoryDescription,
  });

  const seo = await safeGetPlpSeoPageByPath(basePath);
  const title = seo?.metaTitle?.trim() ? seo.metaTitle.trim() : defaultTitle;
  const description = seo?.metaDescription?.trim() ? seo.metaDescription.trim() : defaultDescription;

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
  if (!isAllowedGenderSlug(resolvedParams.gender)) notFound();

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
  const legacy = category ? mapLegacyCategoryToCanonicalCategories(category, subcategory ? [subcategory] : []) : null;

  if (legacy) {
    appendLockedCategories(legacy);
  } else {
    if (rawCategory) locked.append("category", rawCategory);
    if (rawSubcategory) locked.append("subcategory", rawSubcategory);
  }

  const taxonomy = await getPublishedTaxonomyOptions();
  const categoryLookupKey = (rawCategory && taxonomy.categoryLabels[rawCategory] ? rawCategory : legacy?.[0]) ?? rawCategory;
  const rawCategoryLabel = categoryLookupKey
    ? taxonomy.categoryLabels[categoryLookupKey] ?? labelize(categoryLookupKey)
    : "";
  const rawSubcategoryLabel = rawSubcategory
    ? taxonomy.subcategoryLabels[rawSubcategory] ?? labelizeSubcategory(rawSubcategory)
    : "";
  const rawCategoryDescription = categoryLookupKey ? taxonomy.categoryDescriptions?.[categoryLookupKey] ?? null : null;
  const rawSubcategoryDescription = rawSubcategory ? taxonomy.subcategoryDescriptions?.[rawSubcategory] ?? null : null;

  const plpTitle = rawSubcategory
    ? `${rawSubcategoryLabel} · ${gender}`
    : rawCategory
      ? `${rawCategoryLabel} · ${gender}`
      : `Catálogo ${gender}`;

  const safeSegments = segments
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
    .slice(0, 2);
  const basePath = `/${GENDER_ROUTE[gender]}${safeSegments.length ? `/${safeSegments.join("/")}` : ""}`;
  const seo = await safeGetPlpSeoPageByPath(basePath);

  const lockedKeys: string[] = ["gender"];
  if (rawCategory) lockedKeys.push("category");
  if (rawSubcategory) lockedKeys.push("subcategory");

  const fallbackSubtitle = buildFallbackSubtitle({
    genderLabel: gender,
    categoryLabel: rawCategoryLabel || null,
    subcategoryLabel: rawSubcategoryLabel || null,
    categoryDescription: rawCategoryDescription,
    subcategoryDescription: rawSubcategoryDescription,
  });

  const plp: CatalogPlpContext = {
    title: plpTitle,
    subtitle: seo?.subtitle?.trim() ? seo.subtitle.trim() : fallbackSubtitle,
    lockedParams: locked.toString(),
    // En rutas /{gender}/* el path manda y no permitimos que query intente re-definir estos filtros.
    lockedKeys,
    hideFilters: { gender: true, category: Boolean(rawCategory) },
  };

  return CatalogoView({ searchParams: merged, plp });
}
