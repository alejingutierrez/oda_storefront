import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { getCatalogAdapter } from "../src/lib/catalog/registry";
import { discoverFromSitemap, isLikelyProductUrl, normalizeUrl } from "../src/lib/catalog/utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL/NEON_DATABASE_URL in .env");
}

const client = new pg.Client({ connectionString: databaseUrl });

const platforms = ["shopify", "woocommerce", "magento", "vtex", "tiendanube", "wix", "custom"] as const;

const pickBrand = async (platform: typeof platforms[number]) => {
  if (platform === "custom") {
    const result = await client.query(
      `
      SELECT id, name, slug, "siteUrl", "ecommercePlatform"
      FROM brands
      WHERE "siteUrl" IS NOT NULL
        AND ("ecommercePlatform" IS NULL OR lower("ecommercePlatform") = 'custom')
        AND "siteUrl" NOT ILIKE '%linktr.ee%'
        AND "siteUrl" NOT ILIKE '%instagram.com%'
        AND "siteUrl" NOT ILIKE '%facebook.com%'
        AND "siteUrl" NOT ILIKE '%tiktok.com%'
      ORDER BY random()
      LIMIT 1
      `,
    );
    return result.rows[0] ?? null;
  }

  const result = await client.query(
    `
    SELECT id, name, slug, "siteUrl", "ecommercePlatform"
    FROM brands
    WHERE "siteUrl" IS NOT NULL
      AND lower("ecommercePlatform") = $1
    ORDER BY random()
    LIMIT 1
    `,
    [platform],
  );
  return result.rows[0] ?? null;
};

const run = async () => {
  await client.connect();
  try {
    for (const platform of platforms) {
      const brand = await pickBrand(platform);
      if (!brand) {
        console.log(`[${platform}] sin marcas disponibles`);
        continue;
      }

      const siteUrl = normalizeUrl(brand.siteUrl) ?? brand.siteUrl;
      console.log(`\n[${platform}] ${brand.name} (${siteUrl})`);

      const urls = await discoverFromSitemap(siteUrl, 5000, { productAware: true });
      const productUrls = urls.filter(isLikelyProductUrl);
      const sampleUrls = (productUrls.length ? productUrls : urls).slice(0, 10);

      console.log(`- sitemap urls: ${urls.length}`);
      console.log(`- product candidates: ${productUrls.length}`);
      console.log(`- sample urls: ${sampleUrls.length}`);

      const adapter = getCatalogAdapter(platform);
      const ctx = {
        brand: {
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          siteUrl: brand.siteUrl,
          ecommercePlatform: platform,
        },
      };

      const fetchTargets = sampleUrls.slice(0, 3);
      let ok = 0;
      for (const url of fetchTargets) {
        const raw = await adapter.fetchProduct(ctx, { url });
        if (raw) {
          ok += 1;
          console.log(`  ✓ ${raw.title ?? "sin titulo"} | variants: ${raw.variants?.length ?? 0}`);
        } else {
          console.log(`  ✗ ${url}`);
        }
      }
      console.log(`- fetch ok: ${ok}/${fetchTargets.length}`);
    }
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
