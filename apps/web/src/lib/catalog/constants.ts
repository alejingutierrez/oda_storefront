export const CATALOG_MAX_ATTEMPTS = 3;

export const getCatalogConsecutiveErrorLimit = () =>
  Math.max(2, Number(process.env.CATALOG_EXTRACT_CONSECUTIVE_ERROR_LIMIT ?? 5));
