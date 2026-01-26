import { getCatalogAdapter } from "@/lib/catalog/registry";
import { inferCatalogPlatform } from "@/lib/catalog/platform-detect";
import { discoverFromSitemap, isLikelyProductUrl, normalizeUrl, safeOrigin } from "@/lib/catalog/utils";
import type { AdapterContext, ProductRef } from "@/lib/catalog/types";

const discoverRefsFromSitemap = async (siteUrl: string, limit: number) => {
  const normalized = normalizeUrl(siteUrl);
  if (!normalized) return [];
  const urls = await discoverFromSitemap(normalized, limit, { productAware: true });
  if (!urls.length) return [];
  const origin = safeOrigin(normalized);
  const filtered = urls.filter((url) => {
    if (!isLikelyProductUrl(url)) return false;
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  });
  if (!filtered.length) return [];
  return filtered.map((url) => ({ url }));
};

export const discoverCatalogRefs = async ({
  brand,
  limit,
  forceSitemap,
}: {
  brand: { id: string; name: string; slug: string; siteUrl: string; ecommercePlatform: string | null };
  limit: number;
  forceSitemap?: boolean;
}) => {
  let platformForRun = brand.ecommercePlatform ?? null;
  let inferredPlatform: { platform: string; confidence: number } | null = null;
  if (!platformForRun || platformForRun.toLowerCase() === "unknown") {
    inferredPlatform = await inferCatalogPlatform(brand.siteUrl);
    if (inferredPlatform?.platform) {
      platformForRun = inferredPlatform.platform;
    }
  }

  const adapter = getCatalogAdapter(platformForRun);
  const ctx: AdapterContext = {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: platformForRun ?? brand.ecommercePlatform,
    },
  };

  const discoveryLimit = Math.max(
    limit,
    Math.min(Number(process.env.CATALOG_EXTRACT_DISCOVERY_LIMIT ?? limit * 5), 500),
  );
  const rawSitemapLimit = Number(process.env.CATALOG_EXTRACT_SITEMAP_LIMIT ?? 5000);
  const normalizedSitemapLimit = Number.isFinite(rawSitemapLimit) ? rawSitemapLimit : 5000;
  const sitemapLimit =
    normalizedSitemapLimit <= 0 ? 0 : Math.max(discoveryLimit, normalizedSitemapLimit);

  let refs: ProductRef[] = [];
  const trySitemap = forceSitemap || process.env.CATALOG_TRY_SITEMAP_FIRST !== "false";
  let sitemapRefs: ProductRef[] = [];
  if (trySitemap) {
    try {
      sitemapRefs = await discoverRefsFromSitemap(brand.siteUrl, sitemapLimit);
    } catch (error) {
      console.warn("catalog: sitemap discovery failed", {
        siteUrl: brand.siteUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      sitemapRefs = [];
    }
  }
  refs = sitemapRefs.length ? sitemapRefs : await adapter.discoverProducts(ctx, discoveryLimit);

  if (!refs.length && (adapter.platform === "custom" || (platformForRun ?? "").toLowerCase() === "unknown")) {
    const broadUrls = await discoverFromSitemap(brand.siteUrl, discoveryLimit, { productAware: false });
    const origin = safeOrigin(normalizeUrl(brand.siteUrl) ?? brand.siteUrl);
    refs = broadUrls
      .filter((url) => {
        try {
          return new URL(url).origin === origin;
        } catch {
          return false;
        }
      })
      .slice(0, discoveryLimit)
      .map((url) => ({ url }));
  }

  return {
    refs,
    platformForRun,
    adapterPlatform: adapter.platform,
    inferredPlatform,
  };
};
