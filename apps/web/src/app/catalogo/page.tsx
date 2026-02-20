import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CatalogoView from "@/app/catalogo/CatalogoView";
import {
  canonicalizeCatalogSearchParams,
  resolveSearchParams,
  type SearchParams,
} from "@/lib/catalog-filters";
import { GENDER_ROUTE, normalizeGender } from "@/lib/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const rawParams = await resolveSearchParams(searchParams);
  const canon = canonicalizeCatalogSearchParams(rawParams);
  const params = new URLSearchParams(canon.params.toString());

  // Evita URLs duplicadas por default UI.
  params.delete("page");
  if (params.get("sort") === "new") params.delete("sort");

  const query = params.toString();
  const canonical = query ? `/catalogo?${query}` : "/catalogo";

  const gender = params.get("gender");
  const category = params.get("category");
  const subcategory = params.get("subcategory");

  const baseTitle = "Catálogo | ODA";
  const title = subcategory
    ? `${humanizeKey(subcategory)} | ODA`
    : category
      ? `${humanizeKey(category)} | Catálogo ODA`
      : gender
        ? `Catálogo ${humanizeKey(gender)} | ODA`
        : baseTitle;

  const description =
    "Descubre moda colombiana curada: marcas locales con inventario disponible y enlaces directos a tiendas oficiales.";

  const indexable = isIndexableCatalog(params);

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function CatalogoPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await resolveSearchParams(searchParams);
  const canon = canonicalizeCatalogSearchParams(rawParams);
  if (canon.changed) {
    const query = canon.params.toString();
    redirect(query ? `/catalogo?${query}` : "/catalogo");
  }

  // Hygiene: avoid duplicate indexable PLPs living under `/catalogo?...`.
  // Only redirect when the query is strictly gender/category/subcategory.
  const plpParams = new URLSearchParams(canon.params.toString());
  plpParams.delete("page");
  if (plpParams.get("sort") === "new") plpParams.delete("sort");
  const keys = Array.from(new Set(Array.from(plpParams.keys())));
  const allowed = new Set(["gender", "category", "subcategory"]);
  const onlyPlpKeys = keys.every((key) => allowed.has(key));
  if (onlyPlpKeys) {
    const genderRaw = plpParams
      .getAll("gender")
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    const categories = plpParams
      .getAll("category")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const subcategories = plpParams
      .getAll("subcategory")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (genderRaw && categories.length <= 1 && subcategories.length <= 1) {
      const genderKey = normalizeGender(genderRaw);
      const genderSlug = GENDER_ROUTE[genderKey];
      const category = categories[0] ?? null;
      const subcategory = subcategories[0] ?? null;
      if (!subcategory || category) {
        const basePath = `/${genderSlug}${category ? `/${category}` : ""}${subcategory ? `/${subcategory}` : ""}`;
        redirect(basePath);
      }
    }
  }

  return CatalogoView({ searchParams: canon.params });
}
