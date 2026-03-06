-- ---------------------------------------------------------------------------
-- Improve search relevance: redistribute tsvector weights, add description
-- & color names, create variant trigger for color changes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Drop existing product trigger (will be recreated with new column list)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS products_search_vector_trigger ON products;

-- ---------------------------------------------------------------------------
-- 2. Replace trigger function with new weight distribution
--    A = name (highest)
--    B = description, seoTags
--    C = category, subcategory, brand name, color names
--    D = gender, real_style, stylePrimary, materialTags, patternTags,
--        occasionTags, styleTags (lowest)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
DECLARE
  brand_name TEXT;
  color_names TEXT;
BEGIN
  -- Fetch brand name
  SELECT b.name INTO brand_name
  FROM brands b WHERE b.id = NEW."brandId";

  -- Aggregate distinct color family + name from variants → standard_colors
  SELECT string_agg(DISTINCT sc.name || ' ' || sc.family, ' ') INTO color_names
  FROM variants v
  JOIN standard_colors sc ON sc.id = v."standardColorId"
  WHERE v."productId" = NEW.id;

  NEW.search_vector :=
    -- A: product name (highest priority)
    setweight(to_tsvector('spanish', coalesce(NEW.name, '')), 'A') ||
    -- B: description + seoTags
    setweight(to_tsvector('spanish', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."seoTags", ' ')), 'B') ||
    -- C: category, subcategory, brand, colors
    setweight(to_tsvector('spanish', coalesce(NEW.category, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.subcategory, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(brand_name, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(color_names, '')), 'C') ||
    -- D: all attribute tags
    setweight(to_tsvector('spanish', coalesce(NEW.gender, '')), 'D') ||
    setweight(to_tsvector('spanish', coalesce(NEW.real_style, '')), 'D') ||
    setweight(to_tsvector('spanish', coalesce(NEW."stylePrimary", '')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."materialTags", ' ')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."patternTags", ' ')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."occasionTags", ' ')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(NEW."styleTags", ' ')), 'D');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. Recreate product trigger (now includes description in column list)
-- ---------------------------------------------------------------------------
CREATE TRIGGER products_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, description, "brandId", category, subcategory,
    gender, real_style, "stylePrimary", "seoTags", "materialTags", "patternTags",
    "occasionTags", "styleTags"
  ON products
  FOR EACH ROW
  EXECUTE FUNCTION products_search_vector_update();

-- ---------------------------------------------------------------------------
-- 4. Variant trigger: update product search_vector when color changes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION variants_color_update_search_vector() RETURNS trigger AS $$
DECLARE
  _brand_name TEXT;
  _color_names TEXT;
  _product RECORD;
BEGIN
  -- Fetch the parent product
  SELECT * INTO _product FROM products WHERE id = NEW."productId";
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT b.name INTO _brand_name
  FROM brands b WHERE b.id = _product."brandId";

  SELECT string_agg(DISTINCT sc.name || ' ' || sc.family, ' ') INTO _color_names
  FROM variants v
  JOIN standard_colors sc ON sc.id = v."standardColorId"
  WHERE v."productId" = NEW."productId";

  UPDATE products SET search_vector =
    setweight(to_tsvector('spanish', coalesce(_product.name, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(_product.description, '')), 'B') ||
    setweight(to_tsvector('spanish', array_to_string(_product."seoTags", ' ')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(_product.category, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(_product.subcategory, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(_brand_name, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(_color_names, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(_product.gender, '')), 'D') ||
    setweight(to_tsvector('spanish', coalesce(_product.real_style, '')), 'D') ||
    setweight(to_tsvector('spanish', coalesce(_product."stylePrimary", '')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(_product."materialTags", ' ')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(_product."patternTags", ' ')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(_product."occasionTags", ' ')), 'D') ||
    setweight(to_tsvector('spanish', array_to_string(_product."styleTags", ' ')), 'D')
  WHERE id = NEW."productId";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER variants_color_search_trigger
  AFTER INSERT OR UPDATE OF "standardColorId"
  ON variants
  FOR EACH ROW
  EXECUTE FUNCTION variants_color_update_search_vector();

-- ---------------------------------------------------------------------------
-- 5. Backfill all products with new weighted search_vector
-- ---------------------------------------------------------------------------
UPDATE products SET search_vector =
  setweight(to_tsvector('spanish', coalesce(products.name, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(products.description, '')), 'B') ||
  setweight(to_tsvector('spanish', array_to_string(products."seoTags", ' ')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(products.category, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(products.subcategory, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(b.name, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce((
    SELECT string_agg(DISTINCT sc.name || ' ' || sc.family, ' ')
    FROM variants v
    JOIN standard_colors sc ON sc.id = v."standardColorId"
    WHERE v."productId" = products.id
  ), '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(products.gender, '')), 'D') ||
  setweight(to_tsvector('spanish', coalesce(products.real_style, '')), 'D') ||
  setweight(to_tsvector('spanish', coalesce(products."stylePrimary", '')), 'D') ||
  setweight(to_tsvector('spanish', array_to_string(products."materialTags", ' ')), 'D') ||
  setweight(to_tsvector('spanish', array_to_string(products."patternTags", ' ')), 'D') ||
  setweight(to_tsvector('spanish', array_to_string(products."occasionTags", ' ')), 'D') ||
  setweight(to_tsvector('spanish', array_to_string(products."styleTags", ' ')), 'D')
FROM brands b
WHERE b.id = products."brandId";
