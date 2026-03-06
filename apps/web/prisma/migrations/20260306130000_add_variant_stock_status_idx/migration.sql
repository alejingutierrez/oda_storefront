-- RC-6: Expression index on variant metadata timestamp to avoid full table scan
-- The cast ::timestamptz is not IMMUTABLE (depends on timezone), so we create
-- an IMMUTABLE wrapper that parses ISO 8601 strings (always UTC with 'Z' suffix).
CREATE OR REPLACE FUNCTION immutable_iso_to_timestamp(text)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT $1::timestamp $$;

CREATE INDEX IF NOT EXISTS "variants_stock_status_changed_at_idx"
ON "variants" (immutable_iso_to_timestamp(metadata ->> 'last_stock_status_changed_at'))
WHERE (metadata ->> 'last_stock_status_changed_at') IS NOT NULL;
