-- Guarded migration: normalize catalog/enrichment run/item timestamps to timestamptz.
-- Requires precheck script:
--   node scripts/precheck-refresh-timestamp-offset.mjs
--
-- Before applying, set:
--   SET app.catalog_refresh_timestamp_precheck_ok = 'true';
--   SET app.catalog_refresh_timestamp_offset_minutes = '<offset_in_minutes>';
--
-- If the offset is not consistent, DO NOT normalize data in this migration.

DO $$
DECLARE
  precheck_ok text := lower(coalesce(current_setting('app.catalog_refresh_timestamp_precheck_ok', true), ''));
  offset_text text := current_setting('app.catalog_refresh_timestamp_offset_minutes', true);
  offset_minutes integer;
BEGIN
  IF precheck_ok NOT IN ('1', 'true', 'on') THEN
    RAISE EXCEPTION 'catalog_refresh_timestamp_guard: precheck flag missing. Set app.catalog_refresh_timestamp_precheck_ok=true';
  END IF;

  IF offset_text IS NULL OR btrim(offset_text) = '' THEN
    RAISE EXCEPTION 'catalog_refresh_timestamp_guard: missing app.catalog_refresh_timestamp_offset_minutes';
  END IF;

  BEGIN
    offset_minutes := offset_text::integer;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'catalog_refresh_timestamp_guard: invalid offset minutes value: %', offset_text;
  END;

  IF abs(offset_minutes) > 840 THEN
    RAISE EXCEPTION 'catalog_refresh_timestamp_guard: offset out of allowed range: %', offset_minutes;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_runs'
      AND column_name = 'startedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "catalog_runs" ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING (("startedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'')',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_runs'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "catalog_runs" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING (("updatedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'')',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_runs'
      AND column_name = 'finishedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "catalog_runs" ALTER COLUMN "finishedAt" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "finishedAt" IS NULL THEN NULL ELSE (("finishedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'') END)',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_items'
      AND column_name = 'startedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "catalog_items" ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "startedAt" IS NULL THEN NULL ELSE (("startedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'') END)',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_items'
      AND column_name = 'completedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "catalog_items" ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "completedAt" IS NULL THEN NULL ELSE (("completedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'') END)',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_items'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "catalog_items" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING (("updatedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'')',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_enrichment_runs'
      AND column_name = 'startedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "product_enrichment_runs" ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING (("startedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'')',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_enrichment_runs'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "product_enrichment_runs" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING (("updatedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'')',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_enrichment_runs'
      AND column_name = 'finishedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "product_enrichment_runs" ALTER COLUMN "finishedAt" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "finishedAt" IS NULL THEN NULL ELSE (("finishedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'') END)',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_enrichment_items'
      AND column_name = 'startedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "product_enrichment_items" ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "startedAt" IS NULL THEN NULL ELSE (("startedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'') END)',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_enrichment_items'
      AND column_name = 'completedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "product_enrichment_items" ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "completedAt" IS NULL THEN NULL ELSE (("completedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'') END)',
      offset_minutes
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_enrichment_items'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "product_enrichment_items" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING (("updatedAt" + (%s * interval ''1 minute'')) AT TIME ZONE ''UTC'')',
      offset_minutes
    );
  END IF;
END $$;
