const DEFAULT_CATALOG_MAX_VALID_PRICE = 100_000_000;

function parseCatalogMaxValidPrice(raw: string | undefined) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CATALOG_MAX_VALID_PRICE;
  return Math.floor(parsed);
}

export const CATALOG_MAX_VALID_PRICE = parseCatalogMaxValidPrice(process.env.CATALOG_PRICE_MAX_VALID);

export function isCatalogPriceInRange(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= CATALOG_MAX_VALID_PRICE;
}

export function sanitizeCatalogPrice(value: number | null | undefined) {
  return isCatalogPriceInRange(value ?? null) ? value! : null;
}

