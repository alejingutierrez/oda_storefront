-- Create style profiles catalog
CREATE TABLE IF NOT EXISTS "style_profiles" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "style_profiles_pkey" PRIMARY KEY ("key")
);

-- Extend products with primary/secondary style assignments
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "stylePrimary" TEXT,
  ADD COLUMN IF NOT EXISTS "styleSecondary" TEXT,
  ADD COLUMN IF NOT EXISTS "stylePrimaryCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "styleSecondaryCount" INTEGER;

CREATE INDEX IF NOT EXISTS "products_stylePrimary_idx" ON "products"("stylePrimary");
CREATE INDEX IF NOT EXISTS "products_styleSecondary_idx" ON "products"("styleSecondary");

-- Helper to pick the top-2 styles based on tag overlap
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

-- Trigger to keep assignments updated
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

DROP TRIGGER IF EXISTS products_style_assignments_trigger ON "products";
CREATE TRIGGER products_style_assignments_trigger
BEFORE INSERT OR UPDATE OF "styleTags"
ON "products"
FOR EACH ROW
EXECUTE FUNCTION set_product_style_assignments();
