import "server-only";

import { revalidateTag } from "next/cache";

export const CATALOG_CACHE_TAG = "catalog-data";

export const invalidateCatalogCache = () => {
  revalidateTag(CATALOG_CACHE_TAG, "max");
};
