import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const deleteSignals = new Set([
  "social",
  "bot_protection",
  "unreachable",
  "parked_domain",
  "landing_no_store",
  "no_store",
  "no_pdp_candidates",
]);

const shouldDeleteForReview = (reason: string | null) =>
  ["manual_review_no_products", "manual_review_vtex_no_products"].includes(reason ?? "");

const run = async () => {
  const { profileBrandTechnology } = await import("../src/lib/brand-tech-profiler");

  const databaseUrl =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL* env");
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const limit = Math.max(1, Number(process.env.TECH_PROFILE_SWEEP_LIMIT ?? 50));
  const targetPlatform = (process.env.TECH_PROFILE_SWEEP_PLATFORM ?? "unknown").toLowerCase();

  const where: any = {
    isActive: true,
    siteUrl: { not: null },
  };

  if (targetPlatform !== "all") {
    where.ecommercePlatform = targetPlatform === "null" ? null : targetPlatform;
  }

  const whereSql = (() => {
    if (targetPlatform === "all") return `\"isActive\" = true AND \"siteUrl\" IS NOT NULL`;
    if (targetPlatform === "null") return `\"isActive\" = true AND \"siteUrl\" IS NOT NULL AND \"ecommercePlatform\" IS NULL`;
    return `\"isActive\" = true AND \"siteUrl\" IS NOT NULL AND lower(\"ecommercePlatform\") = $1`;
  })();
  const params: any[] = [];
  if (targetPlatform !== "all" && targetPlatform !== "null") params.push(targetPlatform);
  params.push(limit);

  const brandsResult = await client.query(
    `SELECT id, name, \"siteUrl\", \"ecommercePlatform\", \"manualReview\", metadata
     FROM brands
     WHERE ${whereSql}
     ORDER BY \"updatedAt\" ASC
     LIMIT $${params.length}`,
    params,
  );
  const brands = brandsResult.rows;

  let deleted = 0;
  let updated = 0;

  for (const brand of brands) {
    const profile = await profileBrandTechnology(brand as any);
    const existingMetadata =
      brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
        ? (brand.metadata as Record<string, unknown>)
        : {};
    const reviewReason =
      typeof existingMetadata.catalog_extract_review === "object" &&
      existingMetadata.catalog_extract_review &&
      !Array.isArray(existingMetadata.catalog_extract_review)
        ? (existingMetadata.catalog_extract_review as { reason?: string }).reason ?? null
        : null;

    const shouldDelete =
      profile.platform === "unknown" ||
      profile.risks?.some((risk) => deleteSignals.has(risk)) ||
      shouldDeleteForReview(reviewReason);

    if (shouldDelete) {
      await client.query(`DELETE FROM brands WHERE id = $1`, [brand.id]);
      deleted += 1;
      console.log(`[deleted] ${brand.name} | ${brand.siteUrl} | risks: ${profile.risks?.join(",") ?? "-"}`);
      continue;
    }

    const nextMetadata = {
      ...existingMetadata,
      tech_profile: {
        ...profile,
        capturedAt: new Date().toISOString(),
      },
    };
    const shouldManualReview = profile.risks?.some((risk) =>
      ["parked_domain", "unreachable", "missing_site_url"].includes(risk),
    );

    await client.query(
      `UPDATE brands
       SET \"ecommercePlatform\" = $2,
           metadata = $3::jsonb,
           \"manualReview\" = $4,
           \"updatedAt\" = NOW()
       WHERE id = $1`,
      [brand.id, profile.platform, JSON.stringify(nextMetadata), shouldManualReview ? true : brand.manualReview],
    );
    updated += 1;
    console.log(`[updated] ${brand.name} -> ${profile.platform} (${profile.confidence})`);
  }

  console.log(`\nSweep summary: updated=${updated}, deleted=${deleted}, total=${brands.length}`);
  await client.end();
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {});
