export const CATALOG_MAX_ATTEMPTS = 3;

export const getCatalogConsecutiveErrorLimit = () =>
  Math.max(2, Number(process.env.CATALOG_EXTRACT_CONSECUTIVE_ERROR_LIMIT ?? 5));

export const isCatalogSoftError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("no se pudo obtener html") ||
    normalized.includes("no se pudo obtener producto") ||
    normalized.includes("llm_pdp_false") ||
    normalized.includes("no hay imágenes disponibles") ||
    normalized.includes("no hay imagenes disponibles")
  );
};
