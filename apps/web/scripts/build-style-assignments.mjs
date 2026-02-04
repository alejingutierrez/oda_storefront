import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(process.cwd(), "..", "..", ".env");
const content = fs.readFileSync(envPath, "utf8");
let neon = "";
let db = "";
for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const idx = line.indexOf("=");
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (key === "NEON_DATABASE_URL") neon = value;
  if (key === "DATABASE_URL") db = value;
}
const connectionString = neon || db;
if (!connectionString) {
  throw new Error("Missing NEON_DATABASE_URL or DATABASE_URL in .env");
}

const profilesPath = path.resolve(__dirname, "..", "src", "lib", "product-enrichment", "style-profiles.json");
const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf8"));

const client = new Client({ connectionString });

const ensureSchema = async () => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "style_profiles" (
      "key" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "tags" TEXT[] NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "style_profiles_pkey" PRIMARY KEY ("key")
    );
  `);

  await client.query(`
    ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "stylePrimary" TEXT,
      ADD COLUMN IF NOT EXISTS "styleSecondary" TEXT,
      ADD COLUMN IF NOT EXISTS "stylePrimaryCount" INTEGER,
      ADD COLUMN IF NOT EXISTS "styleSecondaryCount" INTEGER;
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS "products_stylePrimary_idx" ON "products"("stylePrimary");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "products_styleSecondary_idx" ON "products"("styleSecondary");`);

  await client.query(`
    CREATE OR REPLACE FUNCTION pick_style_assignments(style_tags TEXT[])
    RETURNS TABLE(primary_key TEXT, secondary_key TEXT, primary_count INT, secondary_count INT)
    LANGUAGE SQL
    STABLE
    AS $$
      WITH counts AS (
        SELECT sp.key,
               (SELECT count(*) FROM unnest(sp.tags) t WHERE t = ANY(style_tags)) AS cnt
        FROM style_profiles sp
      ),
      ordered AS (
        SELECT * FROM counts WHERE cnt > 0 ORDER BY cnt DESC, key ASC
      )
      SELECT
        (SELECT key FROM ordered LIMIT 1) AS primary_key,
        (SELECT key FROM ordered OFFSET 1 LIMIT 1) AS secondary_key,
        (SELECT cnt FROM ordered LIMIT 1) AS primary_count,
        (SELECT cnt FROM ordered OFFSET 1 LIMIT 1) AS secondary_count;
    $$;
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION set_product_style_assignments()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."styleTags" IS NULL OR array_length(NEW."styleTags", 1) IS NULL THEN
        NEW."stylePrimary" := NULL;
        NEW."styleSecondary" := NULL;
        NEW."stylePrimaryCount" := NULL;
        NEW."styleSecondaryCount" := NULL;
        RETURN NEW;
      END IF;

      SELECT primary_key, secondary_key, primary_count, secondary_count
        INTO NEW."stylePrimary", NEW."styleSecondary", NEW."stylePrimaryCount", NEW."styleSecondaryCount"
      FROM pick_style_assignments(NEW."styleTags");

      RETURN NEW;
    END;
    $$;
  `);

  await client.query(`DROP TRIGGER IF EXISTS products_style_assignments_trigger ON "products";`);
  await client.query(`
    CREATE TRIGGER products_style_assignments_trigger
    BEFORE INSERT OR UPDATE OF "styleTags"
    ON "products"
    FOR EACH ROW
    EXECUTE FUNCTION set_product_style_assignments();
  `);
};

const upsertProfiles = async () => {
  const values = [];
  const placeholders = profiles.map((profile, index) => {
    const base = index * 3;
    values.push(profile.key, profile.label, profile.tags);
    return `($${base + 1}, $${base + 2}, $${base + 3}, CURRENT_TIMESTAMP)`;
  });

  await client.query(
    `
      INSERT INTO "style_profiles" ("key", "label", "tags", "updatedAt")
      VALUES ${placeholders.join(", ")}
      ON CONFLICT ("key") DO UPDATE
      SET "label" = EXCLUDED."label",
          "tags" = EXCLUDED."tags",
          "updatedAt" = CURRENT_TIMESTAMP;
    `,
    values,
  );
};

const backfillAssignments = async () => {
  const result = await client.query(`
    WITH computed AS (
      SELECT p.id,
             res.primary_key,
             res.secondary_key,
             res.primary_count,
             res.secondary_count
      FROM "products" p
      LEFT JOIN LATERAL pick_style_assignments(p."styleTags") AS res ON true
    )
    UPDATE "products" p
    SET "stylePrimary" = computed.primary_key,
        "styleSecondary" = computed.secondary_key,
        "stylePrimaryCount" = computed.primary_count,
        "styleSecondaryCount" = computed.secondary_count
    FROM computed
    WHERE p.id = computed.id
      AND (
        p."stylePrimary" IS DISTINCT FROM computed.primary_key OR
        p."styleSecondary" IS DISTINCT FROM computed.secondary_key OR
        p."stylePrimaryCount" IS DISTINCT FROM computed.primary_count OR
        p."styleSecondaryCount" IS DISTINCT FROM computed.secondary_count
      );
  `);
  return result.rowCount ?? 0;
};

const fetchCounts = async () => {
  const total = await client.query(`SELECT COUNT(*)::int AS count FROM "products";`);
  const withTags = await client.query(
    `SELECT COUNT(*)::int AS count FROM "products" WHERE array_length("styleTags", 1) IS NOT NULL;`,
  );
  const withPrimary = await client.query(
    `SELECT COUNT(*)::int AS count FROM "products" WHERE "stylePrimary" IS NOT NULL;`,
  );
  const withSecondary = await client.query(
    `SELECT COUNT(*)::int AS count FROM "products" WHERE "styleSecondary" IS NOT NULL;`,
  );
  return {
    total: total.rows[0]?.count ?? 0,
    withTags: withTags.rows[0]?.count ?? 0,
    withPrimary: withPrimary.rows[0]?.count ?? 0,
    withSecondary: withSecondary.rows[0]?.count ?? 0,
  };
};

const run = async () => {
  await client.connect();
  try {
    await ensureSchema();
    await upsertProfiles();
    const updated = await backfillAssignments();
    const counts = await fetchCounts();

    console.log("style_profiles.upserted", profiles.length);
    console.log("style_assignments.updated", updated);
    console.log("products.total", counts.total);
    console.log("products.with_style_tags", counts.withTags);
    console.log("products.with_primary", counts.withPrimary);
    console.log("products.with_secondary", counts.withSecondary);
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error("style_assignments.failed", error);
  process.exit(1);
});
