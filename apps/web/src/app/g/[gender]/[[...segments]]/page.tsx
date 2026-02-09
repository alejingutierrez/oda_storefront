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
  const legacy = (() => {
    switch (category) {
      case "tops": {
        if (subcategory === "camisetas") return ["camisetas_y_tops"];
        if (subcategory === "camisas" || subcategory === "blusas") return ["camisas_y_blusas"];
        return ["camisetas_y_tops", "camisas_y_blusas"];
      }
      case "bottoms": {
        if (subcategory === "jeans") return ["jeans_y_denim"];
        if (subcategory === "pantalones") return ["pantalones_no_denim"];
        if (subcategory === "shorts") return ["shorts_y_bermudas"];
        if (subcategory === "faldas") return ["faldas"];
        return ["pantalones_no_denim", "jeans_y_denim", "shorts_y_bermudas", "faldas"];
      }
      case "outerwear": {
        if (subcategory === "blazers") return ["blazers_y_sastreria"];
        if (subcategory === "buzos") return ["buzos_hoodies_y_sueteres"];
        if (subcategory === "chaquetas" || subcategory === "abrigos") return ["chaquetas_y_abrigos"];
        return ["chaquetas_y_abrigos", "buzos_hoodies_y_sueteres", "blazers_y_sastreria"];
      }
      case "knitwear":
        return ["buzos_hoodies_y_sueteres"];
      case "enterizos":
        return ["enterizos_y_overoles"];
      case "deportivo":
        return ["ropa_deportiva_y_performance"];
      case "trajes_de_bano":
        return ["trajes_de_bano_y_playa"];
      case "ropa_interior":
      case "ropa interior":
        return ["ropa_interior_basica"];
      // "accesorios" historically meant "everything accessories-like" in navigation.
      case "accesorios":
        return [
          "accesorios_textiles_y_medias",
          "bolsos_y_marroquineria",
          "joyeria_y_bisuteria",
          "calzado",
          "gafas_y_optica",
          "hogar_y_lifestyle",
          "tarjeta_regalo",
          "ropa_interior_basica",
          "lenceria_y_fajas_shapewear",
          "pijamas_y_ropa_de_descanso_loungewear",
          "trajes_de_bano_y_playa",
        ];
      default:
        return null;
    }
  })();

  if (legacy) {
    appendCategories(legacy);
  } else {
    if (rawCategory) next.append("category", rawCategory);
    if (rawSubcategory) next.append("subcategory", rawSubcategory);
  }

  return CatalogoPage({ searchParams: next });
}
