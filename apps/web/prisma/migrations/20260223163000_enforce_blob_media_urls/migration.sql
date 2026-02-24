CREATE OR REPLACE FUNCTION is_blob_media_url(url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN url IS NULL THEN FALSE
      WHEN btrim(url) = '' THEN FALSE
      ELSE position('blob.vercel-storage.com' in lower(url)) > 0
    END;
$$;

CREATE OR REPLACE FUNCTION allow_external_media_write(metadata jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  allow_setting text := lower(coalesce(current_setting('app.allow_external_media_write', true), ''));
  allow_metadata text := lower(coalesce(metadata ->> 'allow_external_media_write', ''));
BEGIN
  RETURN allow_setting IN ('1', 'true', 'on')
    OR allow_metadata IN ('1', 'true', 'on');
END;
$$;

CREATE OR REPLACE FUNCTION enforce_product_blob_cover_url()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."imageCoverUrl" IS NOT DISTINCT FROM OLD."imageCoverUrl" THEN
    RETURN NEW;
  END IF;

  IF NEW."imageCoverUrl" IS NULL OR btrim(NEW."imageCoverUrl") = '' THEN
    RETURN NEW;
  END IF;

  IF allow_external_media_write(NEW.metadata) THEN
    RETURN NEW;
  END IF;

  IF NOT is_blob_media_url(NEW."imageCoverUrl") THEN
    RAISE EXCEPTION 'external_media_url_blocked:products.imageCoverUrl'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_enforce_blob_cover_url ON "products";
CREATE TRIGGER products_enforce_blob_cover_url
BEFORE INSERT OR UPDATE OF "imageCoverUrl", metadata
ON "products"
FOR EACH ROW
EXECUTE FUNCTION enforce_product_blob_cover_url();

CREATE OR REPLACE FUNCTION enforce_variant_blob_images()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.images IS NOT DISTINCT FROM OLD.images THEN
    RETURN NEW;
  END IF;

  IF coalesce(array_length(NEW.images, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF allow_external_media_write(NEW.metadata) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.images) AS img(url)
    WHERE url IS NOT NULL
      AND btrim(url) <> ''
      AND NOT is_blob_media_url(url)
  ) THEN
    RAISE EXCEPTION 'external_media_url_blocked:variants.images'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS variants_enforce_blob_images ON "variants";
CREATE TRIGGER variants_enforce_blob_images
BEFORE INSERT OR UPDATE OF images, metadata
ON "variants"
FOR EACH ROW
EXECUTE FUNCTION enforce_variant_blob_images();
