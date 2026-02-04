import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { classifyPdpWithOpenAI, extractHtmlSignals, extractRawProductWithOpenAI } from "@/lib/catalog/llm-pdp";
import { discoverFromSitemap, fetchText, normalizeUrl, safeOrigin } from "@/lib/catalog/utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL* env");
}

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });

const sampleBrands = async (limit = 10) => {
  const result = await client.query(
    `
    SELECT id, name, slug, "siteUrl", "ecommercePlatform"
    FROM brands
    WHERE "isActive" = true
      AND lower("ecommercePlatform") = 'unknown'
      AND "siteUrl" IS NOT NULL
    ORDER BY "updatedAt" ASC
    LIMIT $1
    `,
    [limit],
  );
  return result.rows;
};

const pickCandidates = async (siteUrl: string, limit = 40) => {
  const normalized = normalizeUrl(siteUrl);
  if (!normalized) return [];
  const origin = safeOrigin(normalized);
  const urls = await discoverFromSitemap(normalized, limit, { productAware: false });
  return urls
    .filter((url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    })
    .slice(0, limit);
};

const run = async () => {
  await client.connect();
  try {
    const limit = Math.max(1, Number(process.env.UNKNOWN_LLM_DRY_RUN_LIMIT ?? 10));
    const candidateLimit = Math.max(5, Number(process.env.UNKNOWN_LLM_DRY_RUN_CANDIDATES ?? 40));
    const brands = await sampleBrands(limit);
    const results: any[] = [];

    for (const brand of brands) {
      const siteUrl = normalizeUrl(brand.siteUrl) ?? brand.siteUrl;
      const candidates = await pickCandidates(siteUrl, candidateLimit);
      let picked = null;
      let decision = null;
      let extracted = null;

      for (const url of candidates.slice(0, 6)) {
        const htmlResponse = await fetchText(url, { method: "GET" }, 15000);
        if (htmlResponse.status >= 400 || !htmlResponse.text) continue;
        const signals = extractHtmlSignals(htmlResponse.text, htmlResponse.finalUrl ?? url);
        decision = await classifyPdpWithOpenAI({
          url,
          html: htmlResponse.text,
          text: signals.text,
          images: signals.images,
        });
        if (decision.is_pdp) {
          picked = url;
          extracted = await extractRawProductWithOpenAI({
            url,
            html: htmlResponse.text,
            text: signals.text,
            images: signals.images,
          });
          break;
        }
      }

      results.push({
        brand: brand.name,
        siteUrl,
        candidates: candidates.length,
        pdpUrl: picked,
        pdpConfidence: decision?.confidence ?? null,
        pdpReason: decision?.reason ?? null,
        title: extracted?.title ?? null,
        variants: extracted?.variants?.length ?? null,
        images: extracted?.images?.length ?? null,
      });
    }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
