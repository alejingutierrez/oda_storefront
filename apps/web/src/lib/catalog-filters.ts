import { normalizeGender, type GenderKey } from "@/lib/navigation";
import { type CatalogFilters } from "@/lib/catalog-query";

export type SearchParamsValue = Record<string, string | string[] | undefined> | URLSearchParams;
export type SearchParams = SearchParamsValue | Promise<SearchParamsValue>;

export function buildSearchParams(searchParams: SearchParamsValue): URLSearchParams {
  if (typeof (searchParams as URLSearchParams).get === "function") {
    return new URLSearchParams((searchParams as URLSearchParams).toString());
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) params.append(key, item);
      }
      continue;
    }
    if (value) params.set(key, value);
  }
  return params;
}

export async function resolveSearchParams(searchParams: SearchParams): Promise<URLSearchParams> {
  const resolved = await searchParams;
  return buildSearchParams(resolved);
}

export function getParamFromSearch(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  if (!values || values.length === 0) return undefined;
  const found = values.find((item) => item && item.trim().length > 0);
  return found && found.trim().length > 0 ? found : undefined;
}

export function getListFromSearch(params: URLSearchParams, key: string): string[] | undefined {
  const values = params.getAll(key);
  if (!values || values.length === 0) return undefined;
  const cleaned = values.map((item) => item.trim()).filter((item) => item.length > 0);
  if (cleaned.length === 0) return undefined;
  return Array.from(new Set(cleaned));
}

export function getNumberParamFromSearch(params: URLSearchParams, key: string): number | undefined {
  const value = getParamFromSearch(params, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePriceRanges(values?: string[]): Array<{ min?: number; max?: number }> | undefined {
  if (!values || values.length === 0) return undefined;
  const ranges: Array<{ min?: number; max?: number }> = [];

  for (const raw of values) {
    const token = String(raw || "").trim();
    if (!token) continue;

    const parts = token.includes(":") ? token.split(":") : token.includes("-") ? token.split("-") : null;
    if (!parts || parts.length !== 2) continue;

    const [minRaw, maxRaw] = parts;
    const minValue = minRaw.trim().length > 0 ? Number(minRaw.trim()) : null;
    const maxValue = maxRaw.trim().length > 0 ? Number(maxRaw.trim()) : null;

    const min = minValue !== null && Number.isFinite(minValue) ? Math.max(0, Math.floor(minValue)) : null;
    const max = maxValue !== null && Number.isFinite(maxValue) ? Math.max(0, Math.floor(maxValue)) : null;

    if (min === null && max === null) continue;
    if (min !== null && max !== null && max < min) continue;

    const out: { min?: number; max?: number } = {};
    if (min !== null) out.min = min;
    if (max !== null) out.max = max;
    ranges.push(out);
  }

  if (ranges.length === 0) return undefined;
  return ranges;
}

export function getBooleanParamFromSearch(params: URLSearchParams, key: string): boolean {
  const value = getParamFromSearch(params, key);
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

export function parseGenderList(values?: string[]): GenderKey[] | undefined {
  if (!values || values.length === 0) return undefined;
  const normalized = values
    .map((value) => {
      const candidate = normalizeGender(value);
      const lower = value.toLowerCase();
      if (lower === "unisex" || lower === "no_binario_unisex" || lower === "unknown") return candidate;
      if (candidate === "Unisex" && value !== "Unisex") return undefined;
      return candidate;
    })
    .filter((value): value is GenderKey => Boolean(value));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

export function parseCatalogFiltersFromSearchParams(params: URLSearchParams): CatalogFilters {
  const priceRanges = parsePriceRanges(getListFromSearch(params, "price_range"));
  // En PLP, `category` es single-select (tomamos solo la primera).
  const categoriesRaw = getListFromSearch(params, "category");
  const categories = categoriesRaw && categoriesRaw.length > 0 ? [categoriesRaw[0]!] : undefined;
  return {
    q: getParamFromSearch(params, "q"),
    categories,
    subcategories: getListFromSearch(params, "subcategory"),
    genders: parseGenderList(getListFromSearch(params, "gender")),
    brandIds: getListFromSearch(params, "brandId"),
    priceMin: priceRanges ? undefined : getNumberParamFromSearch(params, "price_min"),
    priceMax: priceRanges ? undefined : getNumberParamFromSearch(params, "price_max"),
    priceRanges,
    colors: getListFromSearch(params, "color"),
    sizes: getListFromSearch(params, "size"),
    fits: getListFromSearch(params, "fit"),
    materials: getListFromSearch(params, "material"),
    patterns: getListFromSearch(params, "pattern"),
    occasions: getListFromSearch(params, "occasion"),
    seasons: getListFromSearch(params, "season"),
    styles: getListFromSearch(params, "style"),
    inStock: getBooleanParamFromSearch(params, "in_stock"),
  };
}

export function parseCatalogPageFromSearchParams(params: URLSearchParams, fallback = 1): number {
  const raw = getParamFromSearch(params, "page");
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

export function parseCatalogSortFromSearchParams(
  params: URLSearchParams,
  fallback = "relevancia",
): string {
  return getParamFromSearch(params, "sort") ?? fallback;
}

// --- Legacy category URL canonicalization ---

const LEGACY_CATEGORY_KEYS = new Set([
  "tops",
  "bottoms",
  "outerwear",
  "knitwear",
  "enterizos",
  "deportivo",
  "trajes_de_bano",
  "ropa_interior",
  "ropa interior",
  "accesorios",
]);

const LEGACY_SUBCATEGORY_KEYS = new Set([
  // Legacy navigation buckets (pre-taxonomy cleanup).
  "camisetas",
  "camisas",
  "blusas",
  "jeans",
  "pantalones",
  "shorts",
  "faldas",
  "blazers",
  "buzos",
  "chaquetas",
  "abrigos",
  "bolsos",
]);

function dedupePreserveOrder(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function mapLegacyCategoryToCanonicalCategories(
  category: string,
  subcategories: Iterable<string> = [],
): string[] | null {
  const cat = String(category || "").trim().toLowerCase();
  if (!LEGACY_CATEGORY_KEYS.has(cat)) return null;

  const subSet = new Set(Array.from(subcategories, (value) => String(value || "").trim().toLowerCase()));
  const hasAny = (values: string[]) => values.some((value) => subSet.has(value));

  switch (cat) {
    case "tops": {
      const out: string[] = [];
      if (subSet.has("camisetas")) out.push("camisetas_y_tops");
      if (hasAny(["camisas", "blusas"])) out.push("camisas_y_blusas");
      if (out.length === 0) out.push("camisetas_y_tops", "camisas_y_blusas");
      return out;
    }
    case "bottoms": {
      const out: string[] = [];
      if (subSet.has("jeans")) out.push("jeans_y_denim");
      if (subSet.has("pantalones")) out.push("pantalones_no_denim");
      if (subSet.has("shorts")) out.push("shorts_y_bermudas");
      if (subSet.has("faldas")) out.push("faldas");
      if (out.length === 0) out.push("pantalones_no_denim", "jeans_y_denim", "shorts_y_bermudas", "faldas");
      return out;
    }
    case "outerwear": {
      const out: string[] = [];
      if (subSet.has("blazers")) out.push("blazers_y_sastreria");
      if (subSet.has("buzos")) out.push("buzos_hoodies_y_sueteres");
      if (hasAny(["chaquetas", "abrigos"])) out.push("chaquetas_y_abrigos");
      if (out.length === 0) out.push("chaquetas_y_abrigos", "buzos_hoodies_y_sueteres", "blazers_y_sastreria");
      return out;
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
    case "accesorios":
      // "accesorios" historically meant "everything accessories-like" in navigation.
      if (subSet.has("bolsos")) return ["bolsos_y_marroquineria"];
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
}

export function canonicalizeCatalogSearchParams(params: URLSearchParams): {
  params: URLSearchParams;
  changed: boolean;
} {
  const rawCategories = params
    .getAll("category")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const rawSubcategories = params
    .getAll("subcategory")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const hasLegacyCategory = rawCategories.some((value) => LEGACY_CATEGORY_KEYS.has(value.toLowerCase()));
  const hasLegacySubcategory = rawSubcategories.some((value) => LEGACY_SUBCATEGORY_KEYS.has(value.toLowerCase()));
  if (!hasLegacyCategory && !hasLegacySubcategory) return { params, changed: false };

  const subSet = new Set(rawSubcategories.map((value) => value.toLowerCase()));

  const nextCategories: string[] = [];
  for (const category of rawCategories) {
    const mapped = mapLegacyCategoryToCanonicalCategories(category, subSet);
    if (mapped) {
      nextCategories.push(...mapped);
    } else {
      // Keys are case-sensitive in DB filters; normalize to lowercase for robustness.
      nextCategories.push(category.toLowerCase());
    }
  }

  const nextSubcategories = rawSubcategories
    .map((value) => value.toLowerCase())
    .filter((value) => !LEGACY_SUBCATEGORY_KEYS.has(value));

  const next = new URLSearchParams(params.toString());
  next.delete("category");
  next.delete("subcategory");
  for (const value of dedupePreserveOrder(nextCategories)) next.append("category", value);
  for (const value of dedupePreserveOrder(nextSubcategories)) next.append("subcategory", value);

  return { params: next, changed: next.toString() !== params.toString() };
}
