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
  return {
    q: getParamFromSearch(params, "q"),
    categories: getListFromSearch(params, "category"),
    subcategories: getListFromSearch(params, "subcategory"),
    genders: parseGenderList(getListFromSearch(params, "gender")),
    brandIds: getListFromSearch(params, "brandId"),
    priceMin: getNumberParamFromSearch(params, "price_min"),
    priceMax: getNumberParamFromSearch(params, "price_max"),
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

