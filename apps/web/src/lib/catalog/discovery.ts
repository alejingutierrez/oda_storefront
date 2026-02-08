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
  combineSitemapAndAdapter,
}: {
  brand: { id: string; name: string; slug: string; siteUrl: string; ecommercePlatform: string | null };
  limit: number;
  forceSitemap?: boolean;
  combineSitemapAndAdapter?: boolean;
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

  const rawDiscoveryLimit = Number(process.env.CATALOG_EXTRACT_DISCOVERY_LIMIT ?? NaN);
  const rawMultiplier = Number(process.env.CATALOG_DISCOVERY_MULTIPLIER ?? 5);
  const multiplier = Number.isFinite(rawMultiplier) ? Math.max(1, rawMultiplier) : 5;
  const rawMaxDiscovery = Number(process.env.CATALOG_DISCOVERY_MAX_LIMIT ?? 0);
  const maxDiscoveryLimit = Number.isFinite(rawMaxDiscovery) ? Math.max(0, Math.floor(rawMaxDiscovery)) : 0;
  const discoveryBase =
    Number.isFinite(rawDiscoveryLimit) && rawDiscoveryLimit > 0
      ? rawDiscoveryLimit
      : limit * multiplier;
  const discoveryLimitUncapped = Math.max(limit, discoveryBase);
  const discoveryLimit =
    maxDiscoveryLimit > 0
      ? Math.min(discoveryLimitUncapped, Math.max(limit, maxDiscoveryLimit))
      : discoveryLimitUncapped;
  const rawSitemapLimit = Number(process.env.CATALOG_EXTRACT_SITEMAP_LIMIT ?? 5000);
  const normalizedSitemapLimit = Number.isFinite(rawSitemapLimit) ? rawSitemapLimit : 5000;
  const isVtex = adapter.platform === "vtex";
  const sitemapLimitUncapped = isVtex
    ? 0
    : normalizedSitemapLimit <= 0
      ? 0
      : Math.max(discoveryLimit, normalizedSitemapLimit);
  const rawMaxSitemap = Number(process.env.CATALOG_SITEMAP_MAX_LIMIT ?? maxDiscoveryLimit);
  const maxSitemapLimit = Number.isFinite(rawMaxSitemap) ? Math.max(0, Math.floor(rawMaxSitemap)) : 0;
  const sitemapLimit =
    maxSitemapLimit > 0
      ? Math.min(sitemapLimitUncapped, Math.max(discoveryLimit, maxSitemapLimit))
      : sitemapLimitUncapped;

  let refs: ProductRef[] = [];
  const combineSources = Boolean(combineSitemapAndAdapter);
  const allowVtexSitemap = process.env.CATALOG_TRY_SITEMAP_VTEX === "true";
  const trySitemap =
    forceSitemap ||
    (process.env.CATALOG_TRY_SITEMAP_FIRST !== "false" && (!isVtex || allowVtexSitemap));
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
  let adapterRefs: ProductRef[] = [];
  if (!sitemapRefs.length || combineSources) {
    adapterRefs = await adapter.discoverProducts(ctx, discoveryLimit);
  }
  if (combineSources) {
    refs = Array.from(new Map([...sitemapRefs, ...adapterRefs].map((ref) => [ref.url, ref])).values());
  } else {
    refs = sitemapRefs.length ? sitemapRefs : adapterRefs;
  }

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
    sitemapRefs,
    adapterRefs,
  };
};
