import "server-only";

import { revalidateTag } from "next/cache";
import { isRedisEnabled, getRedis } from "@/lib/redis";

export const CATALOG_CACHE_TAG = "catalog-data";

export const invalidateCatalogCache = async () => {
  revalidateTag(CATALOG_CACHE_TAG, "max");

  // RC-4: Flush Redis-cached facets so the next request recomputes them.
  if (isRedisEnabled()) {
    try {
      const client = getRedis();
      const keys = await client.keys("facets:lite:*");
      if (keys.length > 0) await client.del(...keys);
    } catch {
      /* ignore — Redis failure should not block invalidation */
    }
  }
};
