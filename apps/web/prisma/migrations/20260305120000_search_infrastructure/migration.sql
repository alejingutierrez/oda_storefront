-- Enable trigram extension for fuzzy matching / typo tolerance
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable unaccent for accent-insensitive Spanish search
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------------
-- 1. Add search_vector column (tsvector) to products
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- ---------------------------------------------------------------------------
-- 2. Trigger function: maintain search_vector on every INSERT / UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
DECLARE
  brand_name TEXT;
BEGIN
  SELECT b.name INTO brand_name FROM brands b WHERE b.id = NEW."brandId";

  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(brand_name, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.category, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.subcategory, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.gender, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.real_style, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW."stylePrimary", '')), 'C') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."seoTags", ' ')), 'B') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."materialTags", ' ')), 'C') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."patternTags", ' ')), 'C') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."occasionTags", ' ')), 'C') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."styleTags", ' ')), 'D');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, "brandId", category, subcategory, gender,
    real_style, "stylePrimary", "seoTags", "materialTags", "patternTags",
    "occasionTags", "styleTags"
  ON products
  FOR EACH ROW
  EXECUTE FUNCTION products_search_vector_update();

-- ---------------------------------------------------------------------------
-- 3. Backfill search_vector for all existing products
-- ---------------------------------------------------------------------------
UPDATE products p SET search_vector =
  setweight(to_tsvector('spanish', coalesce(p.name, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(b.name, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(p.category, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(p.subcategory, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(p.gender, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(p.real_style, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(p."stylePrimary", '')), 'C') ||
  setweight(to_tsvector('spanish', array_to_string(p."seoTags", ' ')), 'B') ||
  setweight(to_tsvector('spanish', array_to_string(p."materialTags", ' ')), 'C') ||
  setweight(to_tsvector('spanish', array_to_string(p."patternTags", ' ')), 'C') ||
  setweight(to_tsvector('spanish', array_to_string(p."occasionTags", ' ')), 'C') ||
  setweight(to_tsvector('spanish', array_to_string(p."styleTags", ' ')), 'D')
FROM brands b
WHERE b.id = p."brandId";

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

-- GIN index on search_vector for full-text search
CREATE INDEX IF NOT EXISTS products_search_vector_gin_idx
  ON products USING gin(search_vector);

-- Trigram GIN index on product name for fuzzy prefix matching
CREATE INDEX IF NOT EXISTS products_name_trgm_gin_idx
  ON products USING gin(name gin_trgm_ops);

-- Trigram GIN index on brand name for fuzzy matching
CREATE INDEX IF NOT EXISTS brands_name_trgm_gin_idx
  ON brands USING gin(name gin_trgm_ops);
